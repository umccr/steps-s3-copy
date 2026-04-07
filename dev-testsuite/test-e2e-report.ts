import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";
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

// This is a test of the whole end-to-end flow, from copy to report generation,
//  but with a focus on testing the report generation in the different cases considered:

const TEST_EXPECTED_SECONDS = 7 * 60;

let state: TestSetupState;

beforeAll(async () => {
  state = await testSetup();
});

test(
  "report",
  async () => {
    const sfnClient = new SFNClient({});

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

    console.info("Triggering copy");

    const executionStartResult = await sfnClient.send(
      new StartExecutionCommand({
        stateMachineArn: state.smArn,
        name: state.uniqueTestId,
        input: JSON.stringify({
          copyInstructionsKey: state.testInstructionsRelative,
          destinationBucket: state.workingBucket,
          destinationFolderKey: state.testDestPrefix,
          includeCopyReport: true,
          retainCopyReport: true,
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
      testObjects,
    );
  },
  TEST_EXPECTED_SECONDS * 1000,
);
