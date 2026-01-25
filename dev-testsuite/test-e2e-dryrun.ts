import { StorageClass } from "@aws-sdk/client-s3";
import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";
import { WaiterState } from "@smithy/util-waiter";
import { beforeAll, expect, test } from "bun:test";
import { makeObjectDictionaryJsonl } from "./util.mjs";
import { testSetup, type TestSetupState } from "./setup";
import {
  createTestObject,
  type TestObject,
  type TestObjectParams,
} from "./lib/create-test-object";
import { waitUntilStateMachineFinishes } from "./lib/steps-waiter.mjs";

// this does no copying so should finish quick
const TEST_EXPECTED_SECONDS = 60;

let state: TestSetupState;

beforeAll(async () => {
  state = await testSetup();
});

test(
  "dryrun",
  async () => {
    const sfnClient = new SFNClient({});

    const SMALL_SIZE = 1024; // 1 KiB
    const PREFIX1 = "production/primary_data/ABCDEFGHIJ";
    const PREFIX2 = "production/analysis_data/SBJ12345";
    const ACTUAL3 = "production/analysis_data/object";

    const sourceObjects: Record<string, TestObjectParams> = {
      [`${PREFIX1}/20250127933c0a00/WGS_TsqNano/MDX654321_L2401303_S4_L002_R1_001.fastq.gz`]:
        { sizeInBytes: SMALL_SIZE, storageClass: StorageClass.GLACIER },
      [`${PREFIX1}/20250127933c0a00/WGS_TsqNano/MDX654321_L2401303_S4_L002_R2_001.fastq.gz`]:
        {
          sizeInBytes: SMALL_SIZE,
          storageClass: StorageClass.INTELLIGENT_TIERING,
        },
      [`${PREFIX2}/wgs_tumor_normal/2025012738bf62ad/L2401304_L2401303_dragen_somatic/MDX654321_normal.bam`]:
        { sizeInBytes: SMALL_SIZE },
      [`${PREFIX2}/wgs_tumor_normal/2025012738bf62ad/L2401304_L2401303_dragen_somatic/MDX654326_tumor.bam`]:
        { sizeInBytes: SMALL_SIZE },
      [`${PREFIX2}/wgs_tumor_normal/2025012738bf62ad/L2401304_L2401303_dragen_somatic/MDX654321_normal.bam.bai`]:
        { sizeInBytes: SMALL_SIZE },
      [`${PREFIX2}/wgs_tumor_normal/2025012738bf62ad/L2401304_L2401303_dragen_somatic/MDX654326_tumor.bam.bai`]:
        { sizeInBytes: SMALL_SIZE },
      [`${PREFIX1}/20250127933c0a00/WGS_TsqNano/MDX654321_L2401303_S4_L003_R1_001.fastq.gz`]:
        { sizeInBytes: SMALL_SIZE },
      [`${PREFIX1}/20250127933c0a00/WGS_TsqNano/MDX654321_L2401303_S4_L003_R2_001.fastq.gz`]:
        { sizeInBytes: SMALL_SIZE },
      [`${PREFIX1}/20250127933c0a00/WGS_TsqNano/MDX654326_L2401304_S5_L002_R1_001.fastq.gz`]:
        { sizeInBytes: SMALL_SIZE },
      [`${PREFIX1}/20250127933c0a00/WGS_TsqNano/MDX654326_L2401304_S5_L002_R2_001.fastq.gz`]:
        { sizeInBytes: SMALL_SIZE },
      [`${PREFIX1}/20250127933c0a00/WGS_TsqNano/MDX654326_L2401304_S5_L003_R1_001.fastq.gz`]:
        { sizeInBytes: SMALL_SIZE },
      [`${PREFIX1}/20250127933c0a00/WGS_TsqNano/MDX654326_L2401304_S5_L003_R2_001.fastq.gz`]:
        { sizeInBytes: SMALL_SIZE },
      [`${ACTUAL3}`]: { sizeInBytes: SMALL_SIZE },
    };

    console.info("Creating test objects");

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

    console.info("Creating copy instruction JSONL");

    await makeObjectDictionaryJsonl(
      {
        [state.workingBucket]: [
          `${state.testSrcPrefix}${PREFIX1}/*`,
          `${state.testSrcPrefix}${PREFIX2}/*`,
          `${state.testSrcPrefix}${ACTUAL3}`,
        ],
      },
      state.workingBucket,
      state.testInstructionsAbsolute,
    );

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
          dryRun: true,
        }),
      }),
    );

    const executionResult = await waitUntilStateMachineFinishes(
      { client: sfnClient, maxWaitTime: TEST_EXPECTED_SECONDS },
      {
        executionArn: executionStartResult.executionArn!,
      },
    );

    expect(
      executionResult.state === WaiterState.SUCCESS,
      "Orchestration did not succeed as expected",
    );

    console.info(`✅ Dry run completed`);

    // TODO: assert on stats results
  },
  TEST_EXPECTED_SECONDS * 1000,
);
