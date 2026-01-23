import { ChecksumAlgorithm, StorageClass } from "@aws-sdk/client-s3";
import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";
import { WaiterState } from "@smithy/util-waiter";
import { makeObjectDictionaryJsonl } from "./util.mjs";
import { testSetup, type TestSetupState } from "./setup";
import { beforeAll, test } from "bun:test";
import {
  createTestObject,
  type TestObject,
  type TestObjectParams,
} from "./lib/create-test-object";
import { waitUntilStateMachineFinishes } from "./lib/steps-waiter.mjs";
import assert from "node:assert";
import { assertDestinations } from "./lib/assert-destinations.mjs";

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

    const REAL_LARGE_SIZE = 50 * 1024 * 1024; // 50 MiB
    const FAKE_LARGE_SIZE = 256 * 1024; // 256 KiB
    const SMALL_SIZE = 1024; // 1 KiB

    // a complex folder structure that is realistic
    const sourceObjects: Record<string, TestObjectParams> = {
      // NOTE: we only have two real large objects - as uploading the "real" large objects is actually the slow bit of the test
      ["production/primary_data/240823_A98765_4321_ABCDEFGHIJ/20250127933c0a00/WGS_TsqNano/MDX654321_L2401303_S4_L002_R1_001.fastq.gz"]:
        { sizeInBytes: REAL_LARGE_SIZE },
      ["production/primary_data/240823_A98765_4321_ABCDEFGHIJ/20250127933c0a00/WGS_TsqNano/MDX654321_L2401303_S4_L002_R2_001.fastq.gz"]:
        { sizeInBytes: REAL_LARGE_SIZE },
      ["production/analysis_data/SBJ12345/wgs_tumor_normal/2025012738bf62ad/L2401304_L2401303_dragen_somatic/MDX654321_normal.bam"]:
        { sizeInBytes: FAKE_LARGE_SIZE },
      ["production/analysis_data/SBJ12345/wgs_tumor_normal/2025012738bf62ad/L2401304_L2401303_dragen_somatic/MDX654326_tumor.bam"]:
        { sizeInBytes: FAKE_LARGE_SIZE },
      ["production/analysis_data/SBJ12345/wgs_tumor_normal/2025012738bf62ad/L2401304_L2401303_dragen_somatic/MDX654321_normal.bam.bai"]:
        { sizeInBytes: SMALL_SIZE },
      ["production/analysis_data/SBJ12345/wgs_tumor_normal/2025012738bf62ad/L2401304_L2401303_dragen_somatic/MDX654326_tumor.bam.bai"]:
        { sizeInBytes: SMALL_SIZE },
      ["production/primary_data/240823_A98765_4321_ABCDEFGHIJ/20250127933c0a00/WGS_TsqNano/MDX654321_L2401303_S4_L003_R1_001.fastq.gz"]:
        { sizeInBytes: FAKE_LARGE_SIZE },
      ["production/primary_data/240823_A98765_4321_ABCDEFGHIJ/20250127933c0a00/WGS_TsqNano/MDX654321_L2401303_S4_L003_R2_001.fastq.gz"]:
        { sizeInBytes: FAKE_LARGE_SIZE },
      ["production/primary_data/240823_A98765_4321_ABCDEFGHIJ/20250127933c0a00/WGS_TsqNano/MDX654326_L2401304_S5_L002_R1_001.fastq.gz"]:
        { sizeInBytes: FAKE_LARGE_SIZE },
      ["production/primary_data/240823_A98765_4321_ABCDEFGHIJ/20250127933c0a00/WGS_TsqNano/MDX654326_L2401304_S5_L002_R2_001.fastq.gz"]:
        { sizeInBytes: FAKE_LARGE_SIZE },
      ["production/primary_data/240823_A98765_4321_ABCDEFGHIJ/20250127933c0a00/WGS_TsqNano/MDX654326_L2401304_S5_L003_R1_001.fastq.gz"]:
        { sizeInBytes: FAKE_LARGE_SIZE },
      ["production/primary_data/240823_A98765_4321_ABCDEFGHIJ/20250127933c0a00/WGS_TsqNano/MDX654326_L2401304_S5_L003_R2_001.fastq.gz"]:
        { sizeInBytes: FAKE_LARGE_SIZE },
      ["production/analysis_data/SBJ12345/superpipeline/2025012790265f5d/L2401304__L2401303/SBJ12345__MDX654326/SBJ12345__MDX654326-normal.cpsr.html"]:
        { sizeInBytes: SMALL_SIZE },
      ["production/analysis_data/SBJ12345/superpipeline/2025012790265f5d/L2401304__L2401303/SBJ12345__MDX654326/SBJ12345__MDX654326_cancer_report.html"]:
        { sizeInBytes: SMALL_SIZE },
      ["production/analysis_data/SBJ12345/superpipeline/2025012790265f5d/L2401304__L2401303/SBJ12345__MDX654326/SBJ12345__MDX654326-multiqc_report.html"]:
        { sizeInBytes: SMALL_SIZE },
      ["production/analysis_data/SBJ12345/superpipeline/2025012790265f5d/L2401304__L2401303/SBJ12345__MDX654326/SBJ12345__MDX654326-somatic.pcgr.html"]:
        { sizeInBytes: SMALL_SIZE },
      ["production/analysis_data/SBJ12345/superpipeline/2025012790265f5d/L2401304__L2401303/SBJ12345__MDX654326/purple/SBJ12345__MDX654326.purple.cnv.gene.tsv"]:
        { sizeInBytes: SMALL_SIZE },
      ["production/analysis_data/SBJ12345/superpipeline/2025012790265f5d/L2401304__L2401303/SBJ12345__MDX654326/purple/SBJ12345__MDX654326.purple.cnv.somatic.tsv"]:
        { sizeInBytes: SMALL_SIZE },
      ["production/analysis_data/SBJ12345/superpipeline/2025012790265f5d/L2401304__L2401303/SBJ12345__MDX654326/small_variants/SBJ12345__MDX654326-somatic.pcgr.snvs_indels.tiers.tsv"]:
        { sizeInBytes: SMALL_SIZE },
      ["production/analysis_data/SBJ12345/superpipeline/2025012790265f5d/L2401304__L2401303/SBJ12345__MDX654326/structural/SBJ12345__MDX654326-manta.tsv"]:
        { sizeInBytes: SMALL_SIZE },
      ["production/analysis_data/SBJ12345/superpipeline/2025012790265f5d/L2401304__L2401303/SBJ12345__MDX654326/small_variants/SBJ12345__MDX654321-germline.predispose_genes.vcf.gz"]:
        { sizeInBytes: SMALL_SIZE },
      ["production/analysis_data/SBJ12345/superpipeline/2025012790265f5d/L2401304__L2401303/SBJ12345__MDX654326/small_variants/SBJ12345__MDX654326-somatic-PASS.vcf.gz"]:
        { sizeInBytes: SMALL_SIZE },
      ["production/analysis_data/SBJ12345/superpipeline/2025012790265f5d/L2401304__L2401303/SBJ12345__MDX654326/structural/SBJ12345__MDX654326-manta.vcf.gz"]:
        { sizeInBytes: SMALL_SIZE },
      ["production/analysis_data/SBJ12345/superpipeline/2025012790265f5d/L2401304__L2401303/SBJ12345__MDX654326/small_variants/SBJ12345__MDX654321-germline.predispose_genes.vcf.gz.tbi"]:
        { sizeInBytes: SMALL_SIZE },
      ["production/analysis_data/SBJ12345/superpipeline/2025012790265f5d/L2401304__L2401303/SBJ12345__MDX654326/small_variants/SBJ12345__MDX654326-somatic-PASS.vcf.gz.tbi"]:
        { sizeInBytes: SMALL_SIZE },
      ["production/analysis_data/SBJ12345/superpipeline/2025012790265f5d/L2401304__L2401303/SBJ12345__MDX654326/structural/SBJ12345__MDX654326-manta.vcf.gz.tbi"]:
        { sizeInBytes: SMALL_SIZE },
      ["production/analysis_data/SBJ12345/superpipeline/2025012790265f5d/L2401304__L2401303/work/SBJ12345__MDX654326/purple/amber/MDX654321.amber.snp.vcf.gz"]:
        { sizeInBytes: SMALL_SIZE },
      ["production/analysis_data/SBJ12345/superpipeline/2025012790265f5d/L2401304__L2401303/work/SBJ12345__MDX654326/purple/amber/MDX654321.amber.snp.vcf.gz.tbi"]:
        { sizeInBytes: SMALL_SIZE },
      ["production/analysis_data/SBJ12345/superpipeline/2025012790265f5d/L2401304__L2401303/work/SBJ12345__MDX654326/purple/amber/SBJ12345__MDX654326.amber.baf.pcf"]:
        { sizeInBytes: SMALL_SIZE },
      ["production/analysis_data/SBJ12345/superpipeline/2025012790265f5d/L2401304__L2401303/work/SBJ12345__MDX654326/purple/amber/SBJ12345__MDX654326.amber.baf.tsv"]:
        { sizeInBytes: SMALL_SIZE },
      ["production/analysis_data/SBJ12345/superpipeline/2025012790265f5d/L2401304__L2401303/work/SBJ12345__MDX654326/purple/amber/SBJ12345__MDX654326.amber.baf.vcf.gz"]:
        { sizeInBytes: SMALL_SIZE },
      ["production/analysis_data/SBJ12345/superpipeline/2025012790265f5d/L2401304__L2401303/work/SBJ12345__MDX654326/purple/amber/SBJ12345__MDX654326.amber.baf.vcf.gz.tbi"]:
        { sizeInBytes: SMALL_SIZE },
      ["production/analysis_data/SBJ12345/superpipeline/2025012790265f5d/L2401304__L2401303/work/SBJ12345__MDX654326/purple/amber/SBJ12345__MDX654326.amber.contamination.tsv"]:
        { sizeInBytes: SMALL_SIZE },
      ["production/analysis_data/SBJ12345/superpipeline/2025012790265f5d/L2401304__L2401303/work/SBJ12345__MDX654326/purple/amber/SBJ12345__MDX654326.amber.contamination.vcf.gz"]:
        { sizeInBytes: SMALL_SIZE },
      ["production/analysis_data/SBJ12345/superpipeline/2025012790265f5d/L2401304__L2401303/work/SBJ12345__MDX654326/purple/amber/SBJ12345__MDX654326.amber.contamination.vcf.gz.tbi"]:
        { sizeInBytes: SMALL_SIZE },
      ["production/analysis_data/SBJ12345/superpipeline/2025012790265f5d/L2401304__L2401303/work/SBJ12345__MDX654326/purple/amber/SBJ12345__MDX654326.amber.qc"]:
        { sizeInBytes: SMALL_SIZE },
      ["production/analysis_data/SBJ12345/superpipeline/2025012790265f5d/L2401304__L2401303/work/SBJ12345__MDX654326/purple/amber/amber.version"]:
        { sizeInBytes: SMALL_SIZE },
      ["production/analysis_data/SBJ12345/superpipeline/2025012790265f5d/L2401304__L2401303/work/SBJ12345__MDX654326/purple/cobalt/MDX654321.cobalt.gc.median.tsv"]:
        { sizeInBytes: SMALL_SIZE },
      ["production/analysis_data/SBJ12345/superpipeline/2025012790265f5d/L2401304__L2401303/work/SBJ12345__MDX654326/purple/cobalt/MDX654321.cobalt.ratio.median.tsv"]:
        { sizeInBytes: SMALL_SIZE },
      ["production/analysis_data/SBJ12345/superpipeline/2025012790265f5d/L2401304__L2401303/work/SBJ12345__MDX654326/purple/cobalt/MDX654321.cobalt.ratio.pcf"]:
        { sizeInBytes: SMALL_SIZE },
      ["production/analysis_data/SBJ12345/superpipeline/2025012790265f5d/L2401304__L2401303/work/SBJ12345__MDX654326/purple/cobalt/SBJ12345__MDX654326.chr.len"]:
        { sizeInBytes: SMALL_SIZE },
      ["production/analysis_data/SBJ12345/superpipeline/2025012790265f5d/L2401304__L2401303/work/SBJ12345__MDX654326/purple/cobalt/SBJ12345__MDX654326.cobalt.gc.median.tsv"]:
        { sizeInBytes: SMALL_SIZE },
      ["production/analysis_data/SBJ12345/superpipeline/2025012790265f5d/L2401304__L2401303/work/SBJ12345__MDX654326/purple/cobalt/SBJ12345__MDX654326.cobalt.ratio.pcf"]:
        { sizeInBytes: SMALL_SIZE },
      ["production/analysis_data/SBJ12345/superpipeline/2025012790265f5d/L2401304__L2401303/work/SBJ12345__MDX654326/purple/cobalt/SBJ12345__MDX654326.cobalt.ratio.tsv"]:
        { sizeInBytes: SMALL_SIZE },
      ["production/analysis_data/SBJ12345/superpipeline/2025012790265f5d/L2401304__L2401303/work/SBJ12345__MDX654326/purple/cobalt/cobalt.version"]:
        { sizeInBytes: SMALL_SIZE },
      ["production/analysis_data/SBJ12345/superpipeline/2025012790265f5d/L2401304__L2401303/SBJ12345__MDX654326/cancer_report_tables/sigs/SBJ12345__MDX654326-dbs.tsv.gz"]:
        { sizeInBytes: SMALL_SIZE },
      ["production/analysis_data/SBJ12345/superpipeline/2025012790265f5d/L2401304__L2401303/SBJ12345__MDX654326/cancer_report_tables/sigs/SBJ12345__MDX654326-indel.tsv.gz"]:
        { sizeInBytes: SMALL_SIZE },
      ["production/analysis_data/SBJ12345/superpipeline/2025012790265f5d/L2401304__L2401303/SBJ12345__MDX654326/cancer_report_tables/sigs/SBJ12345__MDX654326-snv_2015.tsv.gz"]:
        { sizeInBytes: SMALL_SIZE },
      ["production/analysis_data/SBJ12345/superpipeline/2025012790265f5d/L2401304__L2401303/SBJ12345__MDX654326/cancer_report_tables/sigs/SBJ12345__MDX654326-snv_2020.tsv.gz"]:
        { sizeInBytes: SMALL_SIZE },
      ["production/analysis_data/SBJ12345/wts_tumor_only/2025012721696397/L2401295_dragen/MDX240300.bam"]:
        {
          sizeInBytes: SMALL_SIZE,
          overrideExpectedDestinationRelativeKey:
            "2025012721696397/L2401295_dragen/MDX240300.bam",
        },
      ["production/analysis_data/SBJ12345/wts_tumor_only/2025012721696397/L2401295_dragen/MDX240300.bam.bai"]:
        {
          sizeInBytes: SMALL_SIZE,
          overrideExpectedDestinationRelativeKey:
            "2025012721696397/L2401295_dragen/MDX240300.bam.bai",
        },
      ["production/analysis_data/SBJ12345/wts_tumor_only/2025012721696397/arriba/fusions.pdf"]:
        {
          sizeInBytes: SMALL_SIZE,
          overrideExpectedDestinationRelativeKey:
            "2025012721696397/arriba/fusions.pdf",
        },
      ["production/analysis_data/SBJ12345/wts_tumor_only/2025012721696397/L2401295_dragen/MDX240300.fusion_candidates.final"]:
        {
          sizeInBytes: SMALL_SIZE,
          overrideExpectedDestinationRelativeKey:
            "2025012721696397/L2401295_dragen/MDX240300.fusion_candidates.final",
        },
      ["production/analysis_data/SBJ12345/wts_tumor_only/2025012721696397/arriba/fusions.tsv"]:
        {
          sizeInBytes: SMALL_SIZE,
          overrideExpectedDestinationRelativeKey:
            "2025012721696397/arriba/fusions.tsv",
        },
      ["production/analysis_data/SBJ12345/wts_tumor_only/2025012721696397/L2401295_dragen/MDX240300.quant.sf"]:
        {
          sizeInBytes: SMALL_SIZE,
          overrideExpectedDestinationRelativeKey:
            "2025012721696397/L2401295_dragen/MDX240300.quant.sf",
        },
      ["production/analysis_data/SBJ12345/wts_tumor_only/2025012721696397/L2401295_dragen/MDX240300.quant.genes.sf"]:
        {
          sizeInBytes: SMALL_SIZE,
          overrideExpectedDestinationRelativeKey:
            "2025012721696397/L2401295_dragen/MDX240300.quant.genes.sf",
        },
    };

    const WILDCARD_PREFIX = "production/analysis_data/SBJ12345/wts_tumor_only/";

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
        .filter((n) => !n.startsWith(WILDCARD_PREFIX))
        // handle turning them into keys in our test directory
        .map((n) => `${state.testSrcPrefix}${n}`);

      // add a wildcard instructions
      testObjectKeys.push(`${state.testSrcPrefix}${WILDCARD_PREFIX}*`);

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
          sourceFilesKey: state.testInstructionsRelative,
          destinationBucket: state.workingBucket,
          destinationFolderKey: `${state.testDestPrefix}${DEST}`,
          maxItemsPerBatch: 3,
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
      testObjects,
    );
  },
  TEST_EXPECTED_SECONDS * 1000,
);
