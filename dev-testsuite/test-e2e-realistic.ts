import {
  SFNClient,
  StartExecutionCommand,
  type DescribeExecutionOutput,
} from "@aws-sdk/client-sfn";
import {
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { WaiterState } from "@smithy/util-waiter";
import { makeObjectDictionaryJsonl } from "./util.mjs";
import { testSetup, type TestSetupState } from "./setup";
import { beforeAll, test } from "bun:test";
import { createTestObject, type TestObject } from "./lib/create-test-object";
import { KiB } from "./lib/suffixes.js";
import { waitUntilStateMachineFinishes } from "./lib/steps-waiter.mjs";
import assert from "node:assert";
import { assertDestinations } from "./lib/assert-destinations.mjs";
import {
  REALISTIC_SOURCE_OBJECTS,
  REALISTIC_WILDCARD_PREFIX,
} from "./lib/realistic-source-objects";
import {
  DEFAULT_HTML_REPORT_KEY,
  DEFAULT_SUMMARY_CSV_KEY,
} from "../packages/steps-s3-copy/src/steps-s3-copy-input";

// we have a few large objects so this can take a few minutes
const TEST_EXPECTED_SECONDS = 60 * 10;

// A separate instructions list that references one object never created.
const missingInstructionsKey = "objects-to-copy-with-missing.jsonl";
const missingObjectKey = "does-not-exist";

let state: TestSetupState;

beforeAll(async () => {
  state = await testSetup();

  // create a small batch of real source objects plus one object never created.
  const presentKey0 = `${state.testSrcPrefix}missing-batch-present_0.bin`;
  const presentKey1 = `${state.testSrcPrefix}missing-batch-present_1.bin`;

  await createTestObject(state.workingBucket, presentKey0, 256 * KiB, 0);
  await createTestObject(state.workingBucket, presentKey1, 256 * KiB, 0);

  const missingBatchKeys = [
    presentKey0,
    presentKey1,
    `${state.testSrcPrefix}${missingObjectKey}`,
  ];

  await makeObjectDictionaryJsonl(
    { [state.workingBucket]: missingBatchKeys },
    state.workingBucket,
    `${state.workingBucketPrefix}${state.testInstructionsFolder}${missingInstructionsKey}`,
  );
});

test(
  "realistic",
  async () => {
    const sfnClient = new SFNClient({});

    const sourceObjects = REALISTIC_SOURCE_OBJECTS;

    // create the objects in S3
    const testObjects: Record<string, TestObject> = {};

    for (const [n, params] of Object.entries(sourceObjects)) {
      testObjects[n] = await createTestObject(
        state.workingBucket,
        `${state.testSrcPrefix}${n}`,
        params.sizeInBytes,
        0,
        params.partSizeInBytes,
        params.storageClass,
      );
    }

    // make some instructions for this copy
    // noting that the instructions in this case are not 1 to 1
    // with the test objects because we want to try out
    // wildcards
    {
      const testObjectKeys = Object.keys(sourceObjects)
        // remove all objects that we are going to copy using wildcards
        .filter((n) => !n.startsWith(REALISTIC_WILDCARD_PREFIX))
        // handle turning them into keys in our test directory
        .map((n) => `${state.testSrcPrefix}${n}`);

      // add a wildcard instructions
      testObjectKeys.push(
        `${state.testSrcPrefix}${REALISTIC_WILDCARD_PREFIX}*`,
      );

      await makeObjectDictionaryJsonl(
        {
          [state.workingBucket]: testObjectKeys,
        },
        state.workingBucket,
        state.testInstructionsAbsolute,
      );
    }

    const DEST = "a-destination-folder/";

    const executionStartResult = await sfnClient.send(
      new StartExecutionCommand({
        stateMachineArn: state.smArn,
        name: state.uniqueTestId,
        input: JSON.stringify({
          instructionsPrefix: state.testInstructionsFolder,
          instructionsKey: state.testInstructionsKey,
          destinationBucket: state.workingBucket,
          destinationPrefix: `${state.testDestPrefix}${DEST}`,
          maxItemsPerBatch: 3,
          retainHtmlReport: true,
          retainSummaryCsv: true,
        }),
      }),
    );

    const executionResult = await waitUntilStateMachineFinishes(
      { client: sfnClient, maxWaitTime: TEST_EXPECTED_SECONDS },
      {
        executionArn: executionStartResult.executionArn!,
      },
    );

    assert(
      executionResult.state === WaiterState.SUCCESS,
      "Orchestration did not succeed as expected",
    );

    await assertDestinations(
      state.workingBucket,
      `${state.testDestPrefix}${DEST}`,
      sourceObjects,
    );

    const s3Client = new S3Client({});
    const retainPrefix = state.testInstructionsFolder;

    const csvObject = await s3Client.send(
      new GetObjectCommand({
        Bucket: state.workingBucket,
        Key: `${state.testDestPrefix}${DEST}${DEFAULT_SUMMARY_CSV_KEY}`,
      }),
    );
    const csvContent = await csvObject.Body!.transformToString();
    assert.equal(
      csvContent.trim().split("\n").length,
      Object.keys(sourceObjects).length + 1,
      "CSV row count does not match source objects length + header",
    );

    await s3Client.send(
      new HeadObjectCommand({
        Bucket: state.workingBucket,
        Key: `${retainPrefix}${DEFAULT_SUMMARY_CSV_KEY}`,
      }),
    );
    await s3Client.send(
      new HeadObjectCommand({
        Bucket: state.workingBucket,
        Key: `${retainPrefix}${DEFAULT_HTML_REPORT_KEY}`,
      }),
    );
  },
  TEST_EXPECTED_SECONDS * 1000,
);

test(
  "copy fails when a source object is missing",
  async () => {
    const sfnClient = new SFNClient({});

    console.info("Triggering copy with a missing source object");

    const executionStartResult = await sfnClient.send(
      new StartExecutionCommand({
        stateMachineArn: state.smArn,
        name: `${state.uniqueTestId}-missing-object`,
        input: JSON.stringify({
          instructionsPrefix: state.testInstructionsFolder,
          instructionsKey: missingInstructionsKey,
          destinationBucket: state.workingBucket,
          destinationPrefix: state.testDestPrefix,
        }),
      }),
    );

    console.info("Waiting for copy to fail...");

    const executionResult = await waitUntilStateMachineFinishes(
      { client: sfnClient, maxWaitTime: TEST_EXPECTED_SECONDS },
      {
        executionArn: executionStartResult.executionArn!,
      },
    );

    const reason = executionResult.reason as DescribeExecutionOutput;

    assert(
      executionResult.state === WaiterState.FAILURE,
      `Orchestration was expected to FAIL because a source object is missing, but it got ${executionResult.state} (error=${reason?.error}, cause=${reason?.cause})`,
    );
  },
  TEST_EXPECTED_SECONDS * 1000,
);

test(
  "copy fails on a missing object with continueOnError",
  async () => {
    const sfnClient = new SFNClient({});

    console.info(
      "Triggering copy with a missing source object and continueOnError",
    );

    const executionStartResult = await sfnClient.send(
      new StartExecutionCommand({
        stateMachineArn: state.smArn,
        name: `${state.uniqueTestId}-missing-object-continue`,
        input: JSON.stringify({
          instructionsPrefix: state.testInstructionsFolder,
          instructionsKey: missingInstructionsKey,
          destinationBucket: state.workingBucket,
          destinationPrefix: state.testDestPrefix,
          continueOnError: true,
        }),
      }),
    );

    console.info("Waiting for copy to fail...");

    const executionResult = await waitUntilStateMachineFinishes(
      { client: sfnClient, maxWaitTime: TEST_EXPECTED_SECONDS },
      {
        executionArn: executionStartResult.executionArn!,
      },
    );

    const reason = executionResult.reason as DescribeExecutionOutput;

    assert(
      executionResult.state === WaiterState.FAILURE,
      `Orchestration was expected to FAIL at the HeadObjects gate, but it got ${executionResult.state} (error=${reason?.error}, cause=${reason?.cause})`,
    );
  },
  TEST_EXPECTED_SECONDS * 1000,
);
