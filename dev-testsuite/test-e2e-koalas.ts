import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";
import { makeInstructionsJsonl } from "./util.mjs";
import { WaiterState } from "@smithy/util-waiter";
import { testSetup, type TestSetupState } from "./setup";
import { beforeAll, test } from "bun:test";
import { waitUntilStateMachineFinishes } from "./lib/steps-waiter.mjs";
import assert from "node:assert";
import { assertCopiedObject } from "./lib/assert-destinations.mjs";

// this copy does not have many objects, and they are reasonable sized - 5 minutes should be plenty
// (we do need to take into account potential jitter delays before each large object)
const TEST_EXPECTED_SECONDS = 5 * 60;

let state: TestSetupState;

beforeAll(async () => {
  state = await testSetup();
});

/**
 * A test of copying from a public open data bucket of a smallish set of somewhat small files.
 * Uses koalagenomes as they are opendata located in Sydney - and therefore we do not have to create/store
 * the test files ourselves.
 *
 * Aims to exercise:
 *   - lambda copies
 *   - fargate copies
 *   - copy sets (correct splitting between lambda and fargate)
 *   - source wildcards
 *   - destination directory refactor
 *   - basic copy stats
 *
 * Note:
 *    takes between 4-5 minutes in practice
 */
test(
  "koalas",
  async () => {
    const sfnClient = new SFNClient({});

    console.info("Creating copy instruction JSONL");

    // create the JSONL defining the copies to make
    await makeInstructionsJsonl(
      // note these are just some appropriately sized index files (above 5 mib, but not too large)
      // in a real copy we normally wouldn't want *only* the indexes - but the genomes are 50Gib+!
      [
        {
          sourceBucket: "koalagenomes",
          sourceKey: "NSW_Armidale/bam/Armidale_F_M50273.bam.bai",
        },
        {
          sourceBucket: "koalagenomes",
          sourceKey: "NSW_Armidale/bam/Armidale_M_M7070.bam.bai",
        },
        // tests out the folder wildcarding - these are all relatively small files
        {
          sourceBucket: "koalagenomes",
          sourceKey: "Captive/multiqc/*",
        },
      ],
      state.workingBucket,
      state.testInstructionsAbsolute,
    );

    console.info("Triggering copy");

    // trigger the copy
    const executionStartResult = await sfnClient.send(
      new StartExecutionCommand({
        stateMachineArn: state.smArn,
        name: state.uniqueTestId,
        input: JSON.stringify({
          copyInstructionsKey: state.testInstructionsRelative,
          destinationBucket: state.workingBucket,
          destinationFolderKey: state.testDestPrefix,
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

    await assertCopiedObject(
      state.workingBucket,
      `${state.testDestPrefix}Armidale_F_M50273.bam.bai`,
      9964456,
    );
    await assertCopiedObject(
      state.workingBucket,
      `${state.testDestPrefix}Armidale_M_M7070.bam.bai`,
      9852480,
    );
    await assertCopiedObject(
      state.workingBucket,
      `${state.testDestPrefix}Featherdale_F_46850.mapping_metrics.csv`,
      18858,
    );
    await assertCopiedObject(
      state.workingBucket,
      `${state.testDestPrefix}Featherdale_F_46850.multiqc_report.html`,
      1600389,
    );
  },
  TEST_EXPECTED_SECONDS * 1000,
);
