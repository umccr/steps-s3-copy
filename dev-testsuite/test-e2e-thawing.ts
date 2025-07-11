import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";
import { getPaths, makeObjectDictionaryJsonl } from "./util.mjs";
import { waitUntilStateMachineFinishes } from "./lib/steps-waiter.mjs";
import { WaiterState } from "@smithy/util-waiter";
import { before, test } from "node:test";
import { testSetup, TestSetupState } from "./setup.js";
import assert from "node:assert";
import { assertDestinations } from "./lib/assert-destinations.mjs";
import { KiB, MiB } from "./lib/suffixes.js";
import {
  createTestObject,
  TestObject,
  TestObjectParams,
} from "./lib/create-test-object.js";

// we have at least one "thaw" steps loop that we have to go through - so that adds a minimum
// of one minute of wait - and if the objects are in fact not thawed straight away - more minutes!
// so give ourselves 5 minutes before we abort
const TEST_EXPECTED_SECONDS = 7 * 60;

let state: TestSetupState;

before(async () => {
  state = await testSetup();
});

test('thawing"', { timeout: TEST_EXPECTED_SECONDS * 1000 }, async (t) => {
  const sfnClient = new SFNClient({});

  const {
    testFolderSrc,
    testFolderDest,
    testFolderObjectsTsvAbsolute,
    testFolderObjectsTsvRelative,
  } = getPaths(state.workingBucketPrefixKey, state.uniqueTestId);

  console.info("Creating test objects");

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
  };

  const testObjects: Record<string, TestObject> = {};

  for (const [n, params] of Object.entries(sourceObjectParams)) {
    testObjects[n] = await createTestObject(
      state.sourceBucket,
      `${testFolderSrc}${n}`,
      params.sizeInBytes,
      0,
      params.partSizeInBytes,
      params.storageClass,
    );
  }

  const testObjectKeys = Object.keys(sourceObjectParams).map(
    (n) => `${testFolderSrc}${n}`,
  );

  console.info("Creating copy instruction JSONL");

  await makeObjectDictionaryJsonl(
    {
      [state.sourceBucket]: testObjectKeys,
    },
    state.workingBucket,
    testFolderObjectsTsvAbsolute,
  );

  console.info("Triggering copy");

  const executionStartResult = await sfnClient.send(
    new StartExecutionCommand({
      stateMachineArn: state.smArn,
      name: state.uniqueTestId,
      input: JSON.stringify({
        sourceFilesCsvKey: testFolderObjectsTsvRelative,
        destinationBucket: state.destinationBucket,
        destinationFolderKey: testFolderDest,
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
  console.log(executionResult);

  assert(
    executionResult.state === WaiterState.SUCCESS,
    `Orchestration did not succeed as expected - it got ${executionResult.state} rather than ${WaiterState.SUCCESS}`,
  );

  await assertDestinations(
    state.uniqueTestId,
    state.destinationBucket,
    testObjects,
  );
});
