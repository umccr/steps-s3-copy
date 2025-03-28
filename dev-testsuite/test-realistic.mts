import { ChecksumAlgorithm, StorageClass } from "@aws-sdk/client-s3";
import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";
import { TEST_BUCKET_WORKING_PREFIX } from "./constants.mjs";
import {
  createTestObject,
  getPaths,
  makeObjectDictionaryCsv,
  TestObject,
} from "./test-util.mjs";
import path from "node:path/posix";
import { triggerAndReturnErrorReport } from "./lib/error-reporter.js";
import { WaiterState } from "@smithy/util-waiter";

const TEST_NAME = "realistic";

const sfnClient = new SFNClient({});

type TestObjectParams = {
  sizeInBytes: number;
  partSizeInBytes?: number;
  checksumAlgorithm?: ChecksumAlgorithm;
  storageClass?: StorageClass;
};

/**
 * Execute a test on the given state machine, copying newly created objects from
 * sourceBucket to destinationBucket, and using workingBucket for working artifacts.
 *
 * @param uniqueTestId a unique string for this particular test invocation
 * @param stateMachineArn the state machine under test
 * @param sourceBucket the sourceBucket in which to place test objects
 * @param workingBucket the working sourceBucket to use
 * @param destinationBucket the destination sourceBucket in which to find copied test objects
 */
export async function testRealistic(
  uniqueTestId: string,
  stateMachineArn: string,
  sourceBucket: string,
  workingBucket: string,
  destinationBucket: string,
) {
  console.log(`Test "${TEST_NAME}" (${uniqueTestId})`);

  const {
    testFolderSrc,
    testFolderDest,
    testFolderObjectsTsvAbsolute,
    testFolderObjectsTsvRelative,
  } = getPaths(
    sourceBucket,
    workingBucket,
    TEST_BUCKET_WORKING_PREFIX,
    destinationBucket,
    uniqueTestId,
  );

  const REAL_LARGE_SIZE = 256 * 1024 * 1024;
  const FAKE_LARGE_SIZE = 256 * 1024;
  const SMALL_SIZE = 1024;

  // a complex folder structure that is realistic
  const sourceObjects: Record<string, TestObjectParams> = {
    ["production/analysis_data/SBJ12345/wgs_tumor_normal/2024082738bf62ad/L2401304_L2401303_dragen_somatic/MDX654321_normal.bam"]:
      { sizeInBytes: FAKE_LARGE_SIZE },
    ["production/analysis_data/SBJ12345/wgs_tumor_normal/2024082738bf62ad/L2401304_L2401303_dragen_somatic/MDX654326_tumor.bam"]:
      { sizeInBytes: FAKE_LARGE_SIZE },
    ["production/analysis_data/SBJ12345/wgs_tumor_normal/2024082738bf62ad/L2401304_L2401303_dragen_somatic/MDX654321_normal.bam.bai"]:
      { sizeInBytes: SMALL_SIZE },
    ["production/analysis_data/SBJ12345/wgs_tumor_normal/2024082738bf62ad/L2401304_L2401303_dragen_somatic/MDX654326_tumor.bam.bai"]:
      { sizeInBytes: SMALL_SIZE },
    ["production/primary_data/240823_A98765_4321_ABCDEFGHIJ/20240827933c0a00/WGS_TsqNano/MDX654321_L2401303_S4_L002_R1_001.fastq.gz"]:
      { sizeInBytes: REAL_LARGE_SIZE },
    ["production/primary_data/240823_A98765_4321_ABCDEFGHIJ/20240827933c0a00/WGS_TsqNano/MDX654321_L2401303_S4_L002_R2_001.fastq.gz"]:
      { sizeInBytes: REAL_LARGE_SIZE },
    ["production/primary_data/240823_A98765_4321_ABCDEFGHIJ/20240827933c0a00/WGS_TsqNano/MDX654321_L2401303_S4_L003_R1_001.fastq.gz"]:
      { sizeInBytes: FAKE_LARGE_SIZE },
    ["production/primary_data/240823_A98765_4321_ABCDEFGHIJ/20240827933c0a00/WGS_TsqNano/MDX654321_L2401303_S4_L003_R2_001.fastq.gz"]:
      { sizeInBytes: FAKE_LARGE_SIZE },
    ["production/primary_data/240823_A98765_4321_ABCDEFGHIJ/20240827933c0a00/WGS_TsqNano/MDX654326_L2401304_S5_L002_R1_001.fastq.gz"]:
      { sizeInBytes: FAKE_LARGE_SIZE },
    ["production/primary_data/240823_A98765_4321_ABCDEFGHIJ/20240827933c0a00/WGS_TsqNano/MDX654326_L2401304_S5_L002_R2_001.fastq.gz"]:
      { sizeInBytes: FAKE_LARGE_SIZE },
    ["production/primary_data/240823_A98765_4321_ABCDEFGHIJ/20240827933c0a00/WGS_TsqNano/MDX654326_L2401304_S5_L003_R1_001.fastq.gz"]:
      { sizeInBytes: FAKE_LARGE_SIZE },
    ["production/primary_data/240823_A98765_4321_ABCDEFGHIJ/20240827933c0a00/WGS_TsqNano/MDX654326_L2401304_S5_L003_R2_001.fastq.gz"]:
      { sizeInBytes: FAKE_LARGE_SIZE },
    ["production/analysis_data/SBJ12345/umccrise/2024082790265f5d/L2401304__L2401303/SBJ12345__MDX654326/SBJ12345__MDX654326-normal.cpsr.html"]:
      { sizeInBytes: SMALL_SIZE },
    ["production/analysis_data/SBJ12345/umccrise/2024082790265f5d/L2401304__L2401303/SBJ12345__MDX654326/SBJ12345__MDX654326_cancer_report.html"]:
      { sizeInBytes: SMALL_SIZE },
    ["production/analysis_data/SBJ12345/umccrise/2024082790265f5d/L2401304__L2401303/SBJ12345__MDX654326/SBJ12345__MDX654326-multiqc_report.html"]:
      { sizeInBytes: SMALL_SIZE },
    ["production/analysis_data/SBJ12345/umccrise/2024082790265f5d/L2401304__L2401303/SBJ12345__MDX654326/SBJ12345__MDX654326-somatic.pcgr.html"]:
      { sizeInBytes: SMALL_SIZE },
    ["production/analysis_data/SBJ12345/umccrise/2024082790265f5d/L2401304__L2401303/SBJ12345__MDX654326/purple/SBJ12345__MDX654326.purple.cnv.gene.tsv"]:
      { sizeInBytes: SMALL_SIZE },
    ["production/analysis_data/SBJ12345/umccrise/2024082790265f5d/L2401304__L2401303/SBJ12345__MDX654326/purple/SBJ12345__MDX654326.purple.cnv.somatic.tsv"]:
      { sizeInBytes: SMALL_SIZE },
    ["production/analysis_data/SBJ12345/umccrise/2024082790265f5d/L2401304__L2401303/SBJ12345__MDX654326/small_variants/SBJ12345__MDX654326-somatic.pcgr.snvs_indels.tiers.tsv"]:
      { sizeInBytes: SMALL_SIZE },
    ["production/analysis_data/SBJ12345/umccrise/2024082790265f5d/L2401304__L2401303/SBJ12345__MDX654326/structural/SBJ12345__MDX654326-manta.tsv"]:
      { sizeInBytes: SMALL_SIZE },
    ["production/analysis_data/SBJ12345/umccrise/2024082790265f5d/L2401304__L2401303/SBJ12345__MDX654326/small_variants/SBJ12345__MDX654321-germline.predispose_genes.vcf.gz"]:
      { sizeInBytes: SMALL_SIZE },
    ["production/analysis_data/SBJ12345/umccrise/2024082790265f5d/L2401304__L2401303/SBJ12345__MDX654326/small_variants/SBJ12345__MDX654326-somatic-PASS.vcf.gz"]:
      { sizeInBytes: SMALL_SIZE },
    ["production/analysis_data/SBJ12345/umccrise/2024082790265f5d/L2401304__L2401303/SBJ12345__MDX654326/structural/SBJ12345__MDX654326-manta.vcf.gz"]:
      { sizeInBytes: SMALL_SIZE },
    ["production/analysis_data/SBJ12345/umccrise/2024082790265f5d/L2401304__L2401303/SBJ12345__MDX654326/small_variants/SBJ12345__MDX654321-germline.predispose_genes.vcf.gz.tbi"]:
      { sizeInBytes: SMALL_SIZE },
    ["production/analysis_data/SBJ12345/umccrise/2024082790265f5d/L2401304__L2401303/SBJ12345__MDX654326/small_variants/SBJ12345__MDX654326-somatic-PASS.vcf.gz.tbi"]:
      { sizeInBytes: SMALL_SIZE },
    ["production/analysis_data/SBJ12345/umccrise/2024082790265f5d/L2401304__L2401303/SBJ12345__MDX654326/structural/SBJ12345__MDX654326-manta.vcf.gz.tbi"]:
      { sizeInBytes: SMALL_SIZE },
    ["production/analysis_data/SBJ12345/umccrise/2024082790265f5d/L2401304__L2401303/work/SBJ12345__MDX654326/purple/amber/MDX654321.amber.snp.vcf.gz"]:
      { sizeInBytes: SMALL_SIZE },
    ["production/analysis_data/SBJ12345/umccrise/2024082790265f5d/L2401304__L2401303/work/SBJ12345__MDX654326/purple/amber/MDX654321.amber.snp.vcf.gz.tbi"]:
      { sizeInBytes: SMALL_SIZE },
    ["production/analysis_data/SBJ12345/umccrise/2024082790265f5d/L2401304__L2401303/work/SBJ12345__MDX654326/purple/amber/SBJ12345__MDX654326.amber.baf.pcf"]:
      { sizeInBytes: SMALL_SIZE },
    ["production/analysis_data/SBJ12345/umccrise/2024082790265f5d/L2401304__L2401303/work/SBJ12345__MDX654326/purple/amber/SBJ12345__MDX654326.amber.baf.tsv"]:
      { sizeInBytes: SMALL_SIZE },
    ["production/analysis_data/SBJ12345/umccrise/2024082790265f5d/L2401304__L2401303/work/SBJ12345__MDX654326/purple/amber/SBJ12345__MDX654326.amber.baf.vcf.gz"]:
      { sizeInBytes: SMALL_SIZE },
    ["production/analysis_data/SBJ12345/umccrise/2024082790265f5d/L2401304__L2401303/work/SBJ12345__MDX654326/purple/amber/SBJ12345__MDX654326.amber.baf.vcf.gz.tbi"]:
      { sizeInBytes: SMALL_SIZE },
    ["production/analysis_data/SBJ12345/umccrise/2024082790265f5d/L2401304__L2401303/work/SBJ12345__MDX654326/purple/amber/SBJ12345__MDX654326.amber.contamination.tsv"]:
      { sizeInBytes: SMALL_SIZE },
    ["production/analysis_data/SBJ12345/umccrise/2024082790265f5d/L2401304__L2401303/work/SBJ12345__MDX654326/purple/amber/SBJ12345__MDX654326.amber.contamination.vcf.gz"]:
      { sizeInBytes: SMALL_SIZE },
    ["production/analysis_data/SBJ12345/umccrise/2024082790265f5d/L2401304__L2401303/work/SBJ12345__MDX654326/purple/amber/SBJ12345__MDX654326.amber.contamination.vcf.gz.tbi"]:
      { sizeInBytes: SMALL_SIZE },
    ["production/analysis_data/SBJ12345/umccrise/2024082790265f5d/L2401304__L2401303/work/SBJ12345__MDX654326/purple/amber/SBJ12345__MDX654326.amber.qc"]:
      { sizeInBytes: SMALL_SIZE },
    ["production/analysis_data/SBJ12345/umccrise/2024082790265f5d/L2401304__L2401303/work/SBJ12345__MDX654326/purple/amber/amber.version"]:
      { sizeInBytes: SMALL_SIZE },
    ["production/analysis_data/SBJ12345/umccrise/2024082790265f5d/L2401304__L2401303/work/SBJ12345__MDX654326/purple/cobalt/MDX654321.cobalt.gc.median.tsv"]:
      { sizeInBytes: SMALL_SIZE },
    ["production/analysis_data/SBJ12345/umccrise/2024082790265f5d/L2401304__L2401303/work/SBJ12345__MDX654326/purple/cobalt/MDX654321.cobalt.ratio.median.tsv"]:
      { sizeInBytes: SMALL_SIZE },
    ["production/analysis_data/SBJ12345/umccrise/2024082790265f5d/L2401304__L2401303/work/SBJ12345__MDX654326/purple/cobalt/MDX654321.cobalt.ratio.pcf"]:
      { sizeInBytes: SMALL_SIZE },
    ["production/analysis_data/SBJ12345/umccrise/2024082790265f5d/L2401304__L2401303/work/SBJ12345__MDX654326/purple/cobalt/SBJ12345__MDX654326.chr.len"]:
      { sizeInBytes: SMALL_SIZE },
    ["production/analysis_data/SBJ12345/umccrise/2024082790265f5d/L2401304__L2401303/work/SBJ12345__MDX654326/purple/cobalt/SBJ12345__MDX654326.cobalt.gc.median.tsv"]:
      { sizeInBytes: SMALL_SIZE },
    ["production/analysis_data/SBJ12345/umccrise/2024082790265f5d/L2401304__L2401303/work/SBJ12345__MDX654326/purple/cobalt/SBJ12345__MDX654326.cobalt.ratio.pcf"]:
      { sizeInBytes: SMALL_SIZE },
    ["production/analysis_data/SBJ12345/umccrise/2024082790265f5d/L2401304__L2401303/work/SBJ12345__MDX654326/purple/cobalt/SBJ12345__MDX654326.cobalt.ratio.tsv"]:
      { sizeInBytes: SMALL_SIZE },
    ["production/analysis_data/SBJ12345/umccrise/2024082790265f5d/L2401304__L2401303/work/SBJ12345__MDX654326/purple/cobalt/cobalt.version"]:
      { sizeInBytes: SMALL_SIZE },
    ["production/analysis_data/SBJ12345/umccrise/2024082790265f5d/L2401304__L2401303/SBJ12345__MDX654326/cancer_report_tables/sigs/SBJ12345__MDX654326-dbs.tsv.gz"]:
      { sizeInBytes: SMALL_SIZE },
    ["production/analysis_data/SBJ12345/umccrise/2024082790265f5d/L2401304__L2401303/SBJ12345__MDX654326/cancer_report_tables/sigs/SBJ12345__MDX654326-indel.tsv.gz"]:
      { sizeInBytes: SMALL_SIZE },
    ["production/analysis_data/SBJ12345/umccrise/2024082790265f5d/L2401304__L2401303/SBJ12345__MDX654326/cancer_report_tables/sigs/SBJ12345__MDX654326-snv_2015.tsv.gz"]:
      { sizeInBytes: SMALL_SIZE },
    ["production/analysis_data/SBJ12345/umccrise/2024082790265f5d/L2401304__L2401303/SBJ12345__MDX654326/cancer_report_tables/sigs/SBJ12345__MDX654326-snv_2020.tsv.gz"]:
      { sizeInBytes: SMALL_SIZE },
    ["production/analysis_data/SBJ12345/wts_tumor_only/2024082721696397/L2401295_dragen/MDX240300.bam"]:
      { sizeInBytes: SMALL_SIZE },
    ["production/analysis_data/SBJ12345/wts_tumor_only/2024082721696397/L2401295_dragen/MDX240300.bam.bai"]:
      { sizeInBytes: SMALL_SIZE },
    ["production/analysis_data/SBJ12345/wts_tumor_only/2024082721696397/arriba/fusions.pdf"]:
      { sizeInBytes: SMALL_SIZE },
    ["production/analysis_data/SBJ12345/wts_tumor_only/2024082721696397/L2401295_dragen/MDX240300.fusion_candidates.final"]:
      { sizeInBytes: SMALL_SIZE },
    ["production/analysis_data/SBJ12345/wts_tumor_only/2024082721696397/arriba/fusions.tsv"]:
      { sizeInBytes: SMALL_SIZE },
    ["production/analysis_data/SBJ12345/wts_tumor_only/2024082721696397/L2401295_dragen/MDX240300.quant.sf"]:
      { sizeInBytes: SMALL_SIZE },
    ["production/analysis_data/SBJ12345/wts_tumor_only/2024082721696397/L2401295_dragen/MDX240300.quant.genes.sf"]:
      { sizeInBytes: SMALL_SIZE },
  };

  const testObjects: Record<string, TestObject> = {};

  for (const [n, params] of Object.entries(sourceObjects)) {
    testObjects[n] = await createTestObject(
      sourceBucket,
      `${testFolderSrc}${n}`,
      params.sizeInBytes,
      0,
      "",
    );
  }

  await makeObjectDictionaryCsv(workingBucket, testFolderObjectsTsvAbsolute, {
    [sourceBucket]: Object.keys(sourceObjects).map(
      (n) => `${testFolderSrc}${n}`,
    ),
  });

  // TODO: top-level folder copying
  //await makeObjectDictionaryCsv(workingBucket, testFolderObjectsTsvAbsolute, {
  //  [sourceBucket]: [
  //    `${testFolderSrc}production/primary_data/240823_A98765_4321_ABCDEFGHIJ*`,
  //    `${testFolderSrc}production/analysis_data/SBJ12345/wgs_tumor_normal*`,
  //    `${testFolderSrc}production/analysis_data/SBJ12345/umccrise*`,
  //  ],
  //});

  const executionStartResult = await sfnClient.send(
    new StartExecutionCommand({
      stateMachineArn: stateMachineArn,
      name: uniqueTestId,
      input: JSON.stringify({
        sourceFilesCsvKey: testFolderObjectsTsvRelative,
        destinationBucket: destinationBucket,
        // the complex cases we expect to invoke per subject - so put in a folder for each subject
        destinationPrefixKey:
          path.join(testFolderDest, "EXTERNAL_SAMPLE_7654") + "/",
        maxItemsPerBatch: 16,
      }),
    }),
  );

  return await triggerAndReturnErrorReport(
    TEST_NAME,
    uniqueTestId,
    executionStartResult.executionArn!,
    600,
    destinationBucket,
    testObjects,
    WaiterState.SUCCESS,
  );
}
