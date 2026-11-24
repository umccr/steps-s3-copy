import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";
import {
  HeadObjectCommand,
  RestoreObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { makeObjectDictionaryJsonl } from "./util.mjs";
import { waitUntilStateMachineFinishes } from "./lib/steps-waiter.mjs";
import { WaiterState } from "@smithy/util-waiter";
import { beforeAll, test } from "bun:test";
import { testSetup, type TestSetupState } from "./setup.js";
import assert from "node:assert";
import { assertDestinations } from "./lib/assert-destinations.mjs";
import { KiB, MiB } from "./lib/suffixes.js";
import {
  createTestObject,
  type TestObject,
  type TestObjectParams,
} from "./lib/create-test-object.js";

// we have at least one "thaw" steps loop that we have to go through - so that adds a minimum
// of one minute of wait - and if the objects are in fact not thawed straight away - more minutes!
// so give ourselves 5 minutes before we abort
const TEST_EXPECTED_SECONDS = 7 * 60;

// extra time (before the copy starts) to pre-thaw the objects used for the
// "already thawed" cases, as even Expedited restores can take up to 5 minutes
const PRE_THAW_EXPECTED_SECONDS = 10 * 60;

// the thaw days the copy will use for GLACIER objects
const COPY_THAW_DAYS = 3;

// pre-thaw windows for the "already thawed" objects. S3 rounds the expiry to midnight UTC
// so a 1 day restore expires between ~1 and ~2 days from now: always less than COPY_THAW_DAYS
const SHORT_WINDOW_DAYS = 1;
// a long window is always more than COPY_THAW_DAYS from now
const LONG_WINDOW_DAYS = 7;

let state: TestSetupState;

/**
 * Restores (thaws) an object and waits until the restore is finished.
 * Returns the expiry of the restored copy.
 */
async function preThaw(
  s3: S3Client,
  bucket: string,
  key: string,
  days: number,
): Promise<number> {
  await s3.send(
    new RestoreObjectCommand({
      Bucket: bucket,
      Key: key,
      RestoreRequest: {
        Days: days,
        GlacierJobParameters: { Tier: "Expedited" },
      },
    }),
  );

  const deadline = Date.now() + PRE_THAW_EXPECTED_SECONDS * 1000;

  while (Date.now() < deadline) {
    const expiry = await getRestoreExpiryMs(s3, bucket, key);
    if (expiry !== undefined) return expiry;
    await new Promise((r) => setTimeout(r, 15 * 1000));
  }

  throw new Error(`Pre-thaw of ${key} did not finish in time`);
}

/**
 * Returns the expiry (ms since epoch) of a finished restore, or undefined
 * if the object is not restored (yet).
 */
async function getRestoreExpiryMs(
  s3: S3Client,
  bucket: string,
  key: string,
): Promise<number | undefined> {
  const head = await s3.send(
    new HeadObjectCommand({ Bucket: bucket, Key: key }),
  );
  const match = head.Restore?.match(
    /ongoing-request="false", expiry-date="([^"]+)"/,
  );
  return match ? Date.parse(match[1]!) : undefined;
}

beforeAll(async () => {
  state = await testSetup();
});

test(
  "thawing",
  async () => {
    const sfnClient = new SFNClient({});

    // these are the templates for the objects we are going to create as source objects
    const sourceObjectParams: Record<string, TestObjectParams> = {
      [`glacier-single-part.bin`]: {
        sizeInBytes: 256 * KiB,
        storageClass:
          "GLACIER" /* this is now Glacier Flexible Retrieval - the enum name is still the original name */,
      },
      [`glacier-multi-part.bin`]: {
        sizeInBytes: 6 * MiB,
        partSizeInBytes: 5 * MiB,
        storageClass:
          "GLACIER" /* this is now Glacier Flexible Retrieval - the enum name is still the original name */,
      },
      //
      // these are thawed by the test *before* the copy starts, to test the case of
      // already thawed objects: one with a window longer than the copy thaw days (must not be
      // touched) and one shorter (must be extended)
      //
      [`glacier-already-thawed-long-window.bin`]: {
        sizeInBytes: 256 * KiB,
        storageClass: "GLACIER",
      },
      [`glacier-already-thawed-short-window.bin`]: {
        sizeInBytes: 256 * KiB,
        storageClass: "GLACIER",
      },
      //
      // the following 3 *will* work even without any actual thawing code - as IR is just like regular S3
      // we do this just to confirm this code path
      //
      [`standard-single-part.bin`]: {
        sizeInBytes: 256 * KiB,
      },
      [`glacier-ir-single-part.bin`]: {
        sizeInBytes: 256 * KiB,
        storageClass:
          "GLACIER_IR" /* Glacier IR should behave like normal S3, but we want to ensure that it works */,
      },
      [`glacier-ir-multi-part.bin`]: {
        sizeInBytes: 6 * MiB,
        partSizeInBytes: 5 * MiB,
        storageClass:
          "GLACIER_IR" /* Glacier IR should behave like normal S3, but we want to ensure that it works */,
      },
      //
      // INTELLIGENT_TIERING objects that are NOT in an archive tier should be copied
      // directly without thawing — confirming they are not incorrectly classified as cold
      //
      [`intelligent-tiering-single-part.bin`]: {
        sizeInBytes: 256 * KiB,
        storageClass: "INTELLIGENT_TIERING",
      },
      [`intelligent-tiering-multi-part.bin`]: {
        sizeInBytes: 6 * MiB,
        partSizeInBytes: 5 * MiB,
        storageClass: "INTELLIGENT_TIERING",
      },
    };

    console.info("Creating test objects");

    const testObjects: Record<string, TestObject> = {};

    for (const [n, params] of Object.entries(sourceObjectParams)) {
      testObjects[n] = await createTestObject(
        state.workingBucket,
        `${state.testSrcPrefix}${n}`,
        params.sizeInBytes,
        0,
        params.partSizeInBytes,
        params.storageClass,
      );
    }

    console.info("Pre-thawing the already thawed test objects");

    const s3 = new S3Client({});
    const longKey = `${state.testSrcPrefix}glacier-already-thawed-long-window.bin`;
    const shortKey = `${state.testSrcPrefix}glacier-already-thawed-short-window.bin`;

    const [longExpiryBefore, shortExpiryBefore] = await Promise.all([
      preThaw(s3, state.workingBucket, longKey, LONG_WINDOW_DAYS),
      preThaw(s3, state.workingBucket, shortKey, SHORT_WINDOW_DAYS),
    ]);

    console.info("Creating copy instruction JSONL");

    {
      const testObjectKeys = Object.keys(sourceObjectParams).map(
        (n) => `${state.testSrcPrefix}${n}`,
      );

      await makeObjectDictionaryJsonl(
        {
          [state.workingBucket]: testObjectKeys,
        },
        state.workingBucket,
        state.testInstructionsAbsolute,
      );
    }

    console.info("Triggering copy");

    const executionStartResult = await sfnClient.send(
      new StartExecutionCommand({
        stateMachineArn: state.smArn,
        name: state.uniqueTestId,
        input: JSON.stringify({
          instructionsPrefix: state.testInstructionsFolder,
          instructionsKey: state.testInstructionsKey,
          destinationBucket: state.workingBucket,
          destinationPrefix: state.testDestPrefix,
          thawParams: {
            // Glacier Flexible Retrieval  -->  Expedited
            glacierFlexibleRetrievalThawDays: COPY_THAW_DAYS,
            glacierFlexibleRetrievalThawSpeed: "Expedited",
            // Glacier Deep Archive  -->  Standard
            glacierDeepArchiveThawDays: 1,
            glacierDeepArchiveThawSpeed: "Standard",
            // Intelligent Tiering Archive  -->  Expedited
            intelligentTieringArchiveThawDays: 1,
            intelligentTieringArchiveThawSpeed: "Expedited",
            // Intelligent Tiering Deep Archive  -->  Standard
            intelligentTieringDeepArchiveThawDays: 1,
            intelligentTieringDeepArchiveThawSpeed: "Standard",
          },
        }),
      }),
    );

    console.info("Waiting for copy...");

    const executionResult = await waitUntilStateMachineFinishes(
      { client: sfnClient, maxWaitTime: TEST_EXPECTED_SECONDS },
      {
        executionArn: executionStartResult.executionArn!,
      },
    );

    console.info("Copy finished");

    // debug
    // console.log(executionResult);

    assert(
      executionResult.state === WaiterState.SUCCESS,
      `Orchestration did not succeed as expected - it got ${executionResult.state} rather than ${WaiterState.SUCCESS}`,
    );

    await assertDestinations(
      state.workingBucket,
      state.testDestPrefix,
      sourceObjectParams,
    );

    // already thawed with a long window: must be left untouched
    const longExpiryAfter = await getRestoreExpiryMs(
      s3,
      state.workingBucket,
      longKey,
    );
    assert.strictEqual(
      longExpiryAfter,
      longExpiryBefore,
      "Object thawed for longer than the thaw days should not have been re-thawed",
    );

    // already thawed with a short window: must have been extended
    const shortExpiryAfter = await getRestoreExpiryMs(
      s3,
      state.workingBucket,
      shortKey,
    );
    assert(
      shortExpiryAfter !== undefined && shortExpiryAfter > shortExpiryBefore,
      "Object thawed for less than the thaw days should have had its thaw extended",
    );
  },
  (TEST_EXPECTED_SECONDS + PRE_THAW_EXPECTED_SECONDS) * 1000,
);
