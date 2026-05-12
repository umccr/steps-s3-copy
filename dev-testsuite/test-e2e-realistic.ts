import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";
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
import { waitUntilStateMachineFinishes } from "./lib/steps-waiter.mjs";
import assert from "node:assert";
import { dirname } from "node:path/posix";
import { assertDestinations } from "./lib/assert-destinations.mjs";
import {
  REALISTIC_SOURCE_OBJECTS,
  REALISTIC_WILDCARD_PREFIX,
} from "./lib/realistic-source-objects";

// we have a few large objects so this can take a few minutes
const TEST_EXPECTED_SECONDS = 60 * 10;

let state: TestSetupState;

beforeAll(async () => {
  state = await testSetup();
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
          copyInstructionsKey: state.testInstructionsRelative,
          destinationBucket: state.workingBucket,
          destinationFolderKey: `${state.testDestPrefix}${DEST}`,
          maxItemsPerBatch: 3,
          retainCopyReport: true,
          retainCopyCsv: true,
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
    const retainPrefix = dirname(state.testInstructionsRelative) + "/";

    const csvObject = await s3Client.send(
      new GetObjectCommand({
        Bucket: state.workingBucket,
        Key: `${state.testDestPrefix}${DEST}ENDED_COPY.csv`,
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
        Key: `${retainPrefix}ENDED_COPY.csv`,
      }),
    );
    await s3Client.send(
      new HeadObjectCommand({
        Bucket: state.workingBucket,
        Key: `${retainPrefix}ENDED_COPY_REPORT.html`,
      }),
    );
  },
  TEST_EXPECTED_SECONDS * 1000,
);
