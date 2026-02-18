import { writeFileSync } from "fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { createHtmlReport, type FileSummary } from "./create-dryrun-report.ts";

// Run:
//   npx tsx packages/steps-s3-copy/lambda/summarise-dryrun-lambda/preview-dryrun-report.ts
//
// It will write dev_dryrun_report.html next to this file and try to open it.

const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, "..");

// Mock copy files results
const records: FileSummary[] = [
  // Raw NGS reads
  {
    name: "HG001_R1.fastq.gz",
    size: 7_110_549_504,
    computeCostAUD: 0.00037,
    s3CrossRegionReadWriteCostAUD: 0.1564,
    coldStorageRetrievalCostAUD: 0.0,
  },
  {
    name: "HG001_R2.fastq.gz",
    size: 7_095_543_451,
    computeCostAUD: 0.00037,
    s3CrossRegionReadWriteCostAUD: 0.1559,
    coldStorageRetrievalCostAUD: 0.0,
  },

  // BAM alignments
  {
    name: "HG001.sorted.bam",
    size: 32_850_399_232,
    computeCostAUD: 0.0013,
    s3CrossRegionReadWriteCostAUD: 0.7231,
    coldStorageRetrievalCostAUD: 0.0,
  },
  {
    name: "HG002.sorted.bam",
    size: 31_546_900_992,
    computeCostAUD: 0.00128,
    s3CrossRegionReadWriteCostAUD: 0.6943,
    coldStorageRetrievalCostAUD: 0.0,
  },

  // BAM index files
  {
    name: "HG001.sorted.bam.bai",
    size: 3_436_352,
    computeCostAUD: 0.00001,
    s3CrossRegionReadWriteCostAUD: 0.000075,
    coldStorageRetrievalCostAUD: 0.0,
  },

  // Variant calls & index
  {
    name: "HG001.hc.vcf.gz",
    size: 2_145_689,
    computeCostAUD: 0.000005,
    s3CrossRegionReadWriteCostAUD: 0.000047,
    coldStorageRetrievalCostAUD: 0.0,
  },
  {
    name: "HG001.hc.vcf.gz.tbi",
    size: 52_651,
    computeCostAUD: 0.000001,
    s3CrossRegionReadWriteCostAUD: 0.000001,
    coldStorageRetrievalCostAUD: 0.0,
  },

  // Reference genome & index
  {
    name: "GRCh38_full_analysis_set.fa.gz",
    size: 902_653_184,
    computeCostAUD: 0.00011,
    s3CrossRegionReadWriteCostAUD: 0.0199,
    coldStorageRetrievalCostAUD: 0.0,
  },
  {
    name: "GRCh38_full_analysis_set.fa.fai",
    size: 21_000,
    computeCostAUD: 0.0000003,
    s3CrossRegionReadWriteCostAUD: 0.0000004,
    coldStorageRetrievalCostAUD: 0.0,
  },

  // QC Reports
  {
    name: "fastqc/HG001_fastqc.html",
    size: 234_112,
    computeCostAUD: 0.000001,
    s3CrossRegionReadWriteCostAUD: 0.000005,
    coldStorageRetrievalCostAUD: 0.0,
  },
  {
    name: "multiqc_report.html",
    size: 1_823_440,
    computeCostAUD: 0.02,
    s3CrossRegionReadWriteCostAUD: 0.00004,
    coldStorageRetrievalCostAUD: 0.0,
  },

  // Sample sheets, metadata, small text
  {
    name: "project_metadata.json",
    size: 8_351,
    computeCostAUD: 0.0000001,
    s3CrossRegionReadWriteCostAUD: 0.0000002,
    coldStorageRetrievalCostAUD: 0.0,
  },
  {
    name: "samplesheet.csv",
    size: 25_133,
    computeCostAUD: 0.02,
    s3CrossRegionReadWriteCostAUD: 0.0000005,
    coldStorageRetrievalCostAUD: 0.0,
  },

  // Old/archive:
  {
    name: "archive/HG001_2016_LC.fastq.gz",
    size: 6_845_449_728,
    computeCostAUD: 0.00036,
    s3CrossRegionReadWriteCostAUD: 0.1505,
    coldStorageRetrievalCostAUD: 0.11,
  },
  {
    name: "archive/HG001.sorted.deep.bam",
    size: 31_012_773_888,
    computeCostAUD: 0.0012,
    s3CrossRegionReadWriteCostAUD: 0.6825,
    coldStorageRetrievalCostAUD: 0.48,
  },
];

// Now pass as summSmall ONLY, to mock just one section:
const html = createHtmlReport({
  title: "Dry Run Results Report (local preview: dev_dryrun_report.html)",
  summSmall: records,
  // summLarge, summSmallThaw, summLargeThaw could also be included as arrays if you want.
});

const outPath = join(__dirname, "dev_dryrun_report.html");
writeFileSync(outPath, html, "utf-8");
console.log(`dev_dryrun_report.html written: ${outPath}`);

// Try auto-open report file just created
try {
  const platform = process.platform;
  if (platform === "darwin") execSync(`open "${outPath}"`);
  else if (platform === "linux") execSync(`xdg-open "${outPath}"`);
  else if (platform === "win32")
    execSync(`start "" "${outPath}"`, {
      stdio: "inherit",
    });
} catch {
  console.log(
    "Could not auto-open the report. Open it manually in your browser.",
  );
}
