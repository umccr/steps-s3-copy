import type { TestObjectParams } from "./create-test-object";

const REAL_LARGE_SIZE = 50 * 1024 * 1024; // 50 MiB
const FAKE_LARGE_SIZE = 256 * 1024; // 256 KiB
const SMALL_SIZE = 1024; // 1 KiB

/**
 * A complex folder structure that is realistic.
 */
export const REALISTIC_SOURCE_OBJECTS: Record<string, TestObjectParams> = {
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

/**
 * The prefix for the wildcard group within the realistic source objects.
 */
export const REALISTIC_WILDCARD_PREFIX =
  "production/analysis_data/SBJ12345/wts_tumor_only/";
