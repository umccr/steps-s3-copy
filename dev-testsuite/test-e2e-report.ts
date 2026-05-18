import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";
import { S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";
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

// This is a test of the end-to-end flow, from copy to report generation,
//  but with a focus on testing the report generation in the different cases considered:

const TEST_EXPECTED_SECONDS = 2 * 60;

const copyReportFileName = "COPY_REPORT.html";
const dryRunReportFileName = "DRY_RUN_REPORT.html";

let state: TestSetupState;

beforeAll(async () => {
  state = await testSetup();

  // these are the templates for the objects we are going to create as source objects
  const sourceObjectParams: Record<string, TestObjectParams> = {
    [`standard-single-part_1.bin`]: {
      sizeInBytes: 256 * KiB,
    },
    [`standard-single-part_2.bin`]: {
      sizeInBytes: 256 * KiB,
    },
    [`standard-single-part_3.bin`]: {
      sizeInBytes: 256 * KiB,
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
});

// Copy report for an actual copy
test(
  "copy report generation",
  async () => {
    const sfnClient = new SFNClient({});
    const s3Client = new S3Client({});

    console.info("Triggering copy");

    const executionStartResult = await sfnClient.send(
      new StartExecutionCommand({
        stateMachineArn: state.smArn,
        name: `${state.uniqueTestId}-copy`,
        input: JSON.stringify({
          instructionsPrefix: state.testInstructionsFolder,
          instructionsKey: state.testInstructionsKey,
          destinationBucket: state.workingBucket,
          destinationPrefix: state.testDestPrefix,
          htmlReport: true,
          htmlReportKey: copyReportFileName,
          retainHtmlReport: true,
          retainSummaryCsv: true,
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

    assert(
      executionResult.state === WaiterState.SUCCESS,
      `Orchestration did not succeed as expected - it got ${executionResult.state} rather than ${WaiterState.SUCCESS}`,
    );

    // Assert copyReportFileName exists in destination and working bucket expected
    const destReportKey = `${state.testDestPrefix}${copyReportFileName}`;
    const retainedReportKey = `${state.uniqueTestId}/${copyReportFileName}`;

    // Check destination
    await s3Client.send(
      new HeadObjectCommand({
        Bucket: state.workingBucket,
        Key: destReportKey,
      }),
    );

    // Check source
    await s3Client.send(
      new HeadObjectCommand({
        Bucket: state.workingBucket,
        Key: retainedReportKey,
      }),
    );
  },
  TEST_EXPECTED_SECONDS * 1000,
);

// Ended copy report for a dry run copy
test(
  "estimation report generation",
  async () => {
    const sfnClient = new SFNClient({});
    const s3Client = new S3Client({});

    console.info("Triggering dry-run copy");

    const executionStartResult = await sfnClient.send(
      new StartExecutionCommand({
        stateMachineArn: state.smArn,
        name: `${state.uniqueTestId}-dry-run`,
        input: JSON.stringify({
          instructionsPrefix: state.testInstructionsFolder,
          instructionsKey: state.testInstructionsKey,
          destinationBucket: state.workingBucket,
          destinationPrefix: state.testDestPrefix,
          htmlReport: true,
          htmlReportKey: dryRunReportFileName,
          retainHtmlReport: true,
          retainSummaryCsv: true,
          dryRun: true,
        }),
      }),
    );

    console.info("Waiting for dry-run copy to finish...");

    const executionResult = await waitUntilStateMachineFinishes(
      { client: sfnClient, maxWaitTime: TEST_EXPECTED_SECONDS },
      {
        executionArn: executionStartResult.executionArn!,
      },
    );

    console.info("Dry-run copy finished");

    assert(
      executionResult.state === WaiterState.SUCCESS,
      `Orchestration did not succeed as expected - it got ${executionResult.state} rather than ${WaiterState.SUCCESS}`,
    );

    // Assert dryRunReportFileName exists in destination and working bucket expected
    const destReportKey = `${state.testDestPrefix}${dryRunReportFileName}`;
    const retainedReportKey = `${state.uniqueTestId}/${dryRunReportFileName}`;

    // Check destination
    await s3Client.send(
      new HeadObjectCommand({
        Bucket: state.workingBucket,
        Key: destReportKey,
      }),
    );

    // Check source
    await s3Client.send(
      new HeadObjectCommand({
        Bucket: state.workingBucket,
        Key: retainedReportKey,
      }),
    );
  },
  TEST_EXPECTED_SECONDS * 1000,
);
