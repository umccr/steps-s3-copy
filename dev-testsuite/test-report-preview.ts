import { writeFile, readFile } from "fs/promises";
import { writeFileSync, existsSync } from "fs";
import path from "path";
import { execSync } from "child_process";
import { createHtmlReport } from "../packages/steps-s3-copy/lambda/summarise-copy-lambda/create-html-report";
import type { ReportMetadata } from "../packages/steps-s3-copy/lambda/summarise-copy-lambda/summarise-copy-lambda";
import {
  fetchColdStorageRetrievalCosts,
  fetchCrossRegionCosts,
  fetchComputeCosts,
} from "../packages/steps-s3-copy/lambda/common/cost-estimation";

const dryRun = process.argv.includes("--dry-run");

// -----------------------------------------------------------------------------
// If pricingFile doesn't exist, fetch cost data from API for source region Syd
// (ap-southeast-2) and write it.
// -----------------------------------------------------------------------------
const pricingFile = path.resolve(__dirname, "pricing-data.json");
const pricingFileExists = existsSync(pricingFile);

if (!pricingFileExists) {
  const sourceRegion = "ap-southeast-1";

  const coldStorageCosts = await fetchColdStorageRetrievalCosts(sourceRegion);
  const crossRegionCosts = await fetchCrossRegionCosts(sourceRegion);
  const computeCosts = await fetchComputeCosts(sourceRegion);

  const fetchedPricingData = {
    coldStorageCosts,
    crossRegionCosts,
    computeCosts,
    fetchedAt: new Date().toISOString(),
  };

  await writeFile(
    pricingFile,
    JSON.stringify(
      fetchedPricingData,
      (_, value) =>
        typeof value === "number" && !Number.isFinite(value)
          ? "Infinity"
          : value,
      2,
    ),
    "utf8",
  );

  console.log("Saved pricing data to ./pricing-data.json");
}

// Read the pricing data
const raw = await readFile(pricingFile, "utf8");
const pricingData = JSON.parse(raw);

// Two sets of mock ReportMetadata: one for dry run, one for real copy
const reportMetadataDryRun: ReportMetadata[] = [
  {
    copySetsMetadata: {
      name: "file_1.fastq",
      size: 123456789,
      costEstimate: {
        crossRegionCostUSD: 0.12,
        coldStorageRetrievalCostUSD: 0.05,
        computeCostUSD: 0.01,
      },
    },
    copyResultMetadata: {
      name: "file_1.fastq",
      status: "ESTIMATED",
      speed: 0,
      message: "Dry run: no copy performed",
      destination:
        "s3://a-very-long-bucket-name/a-very-long-prefix/file_1.fastq",
      bytesTransferred: 0,
      elapsedSeconds: 0,
    },
  },
  {
    copySetsMetadata: {
      name: "file_2.bam",
      size: 987654321,
      costEstimate: {
        crossRegionCostUSD: 0.1,
        coldStorageRetrievalCostUSD: 0.0,
        computeCostUSD: 0.01,
      },
    },
    copyResultMetadata: {
      name: "file_2.bam",
      status: "ESTIMATED",
      speed: 0,
      message: "Dry run: no copy performed",
      destination:
        "s3://a-very-long-bucket-name/a-very-long-prefix/level-1-dir/file_2.bam",
      bytesTransferred: 0,
      elapsedSeconds: 0,
    },
  },
  {
    copySetsMetadata: {
      name: "file_3.fastq.ora",
      size: 345678901,
      costEstimate: {
        crossRegionCostUSD: 0.0,
        coldStorageRetrievalCostUSD: 0.0,
        computeCostUSD: 0.01,
      },
    },
    copyResultMetadata: {
      name: "file_3.fastq.ora",
      status: "ESTIMATED",
      speed: 0,
      message: "Dry run: no copy performed",
      destination:
        "s3://a-very-long-bucket-name/a-very-long-prefix/level-1-dir/level-2-dir/file_3.fastq.ora",
      bytesTransferred: 0,
      elapsedSeconds: 0,
    },
  },
];

const reportMetadataCopy: ReportMetadata[] = [
  {
    copySetsMetadata: {
      name: "file_1.fastq",
      size: 123456789,
      costEstimate: {
        crossRegionCostUSD: 0.12,
        coldStorageRetrievalCostUSD: 0.05,
        computeCostUSD: 0.01,
      },
    },
    copyResultMetadata: {
      name: "file_1.fastq",
      status: "COPIED",
      speed: 12.3,
      message: "",
      destination:
        "s3://a-very-long-bucket-name/a-very-long-prefix/file_1.fastq",
      bytesTransferred: 123456789,
      elapsedSeconds: 10,
    },
  },
  {
    copySetsMetadata: {
      name: "file_2.bam",
      size: 987654321,
      costEstimate: {
        crossRegionCostUSD: 0.1,
        coldStorageRetrievalCostUSD: 0.0,
        computeCostUSD: 0.01,
      },
    },
    copyResultMetadata: {
      name: "file_2.bam",
      status: "ALREADYCOPIED",
      speed: 0,
      message:
        "destination file already exists with same checksum so nothing was transferred",
      destination:
        "s3://a-very-long-bucket-name/a-very-long-prefix/level-1-dir/file_2.bam",
      bytesTransferred: 0,
      elapsedSeconds: 0,
    },
  },
  {
    copySetsMetadata: {
      name: "file_3.fastq.ora",
      size: 345678901,
      costEstimate: {
        crossRegionCostUSD: 0.0,
        coldStorageRetrievalCostUSD: 0.0,
        computeCostUSD: 0.01,
      },
    },
    copyResultMetadata: {
      name: "file_3.fastq.ora",
      status: "ERROR",
      speed: 0,
      message: "source file did not exist so nothing was transferred",
      destination:
        "s3://a-very-long-bucket-name/a-very-long-prefix/level-1-dir/level-2-dir/file_3.fastq.ora",
      bytesTransferred: 0,
      elapsedSeconds: 0,
    },
  },
  {
    copySetsMetadata: {
      name: "file_4.cram",
      size: 456789012,
      costEstimate: {
        crossRegionCostUSD: 0.23,
        coldStorageRetrievalCostUSD: 0.07,
        computeCostUSD: 0.02,
      },
    },
    copyResultMetadata: {
      name: "file_4.cram",
      status: "COPIED",
      speed: 22.45,
      message: "transfer completed successfully",
      destination:
        "s3://a-very-long-bucket-name/a-very-long-prefix/project-a/run-001/file_4.cram",
      bytesTransferred: 456789012,
      elapsedSeconds: 18,
    },
  },
  {
    copySetsMetadata: {
      name: "file_5.vcf.gz",
      size: 56789012,
      costEstimate: {
        crossRegionCostUSD: 0.03,
        coldStorageRetrievalCostUSD: 0.0,
        computeCostUSD: 0.01,
      },
    },
    copyResultMetadata: {
      name: "file_5.vcf.gz",
      status: "COPIED",
      speed: 8.91,
      message: "",
      destination:
        "s3://a-very-long-bucket-name/a-very-long-prefix/project-a/run-001/file_5.vcf.gz",
      bytesTransferred: 56789012,
      elapsedSeconds: 6,
    },
  },
  {
    copySetsMetadata: {
      name: "file_6.g.vcf.gz",
      size: 67890123,
      costEstimate: {
        crossRegionCostUSD: 0.04,
        coldStorageRetrievalCostUSD: 0.01,
        computeCostUSD: 0.01,
      },
    },
    copyResultMetadata: {
      name: "file_6.g.vcf.gz",
      status: "ESTIMATED",
      speed: 0,
      message: "dry run only, transfer not executed",
      destination:
        "s3://a-very-long-bucket-name/a-very-long-prefix/project-a/run-002/file_6.g.vcf.gz",
      bytesTransferred: 0,
      elapsedSeconds: 0,
    },
  },
  {
    copySetsMetadata: {
      name: "file_7.txt",
      size: 1234,
      costEstimate: {
        crossRegionCostUSD: 0.0,
        coldStorageRetrievalCostUSD: 0.0,
        computeCostUSD: 0.0,
      },
    },
    copyResultMetadata: {
      name: "file_7.txt",
      status: "COPIED",
      speed: 0.15,
      message: "small metadata file copied",
      destination:
        "s3://a-very-long-bucket-name/a-very-long-prefix/project-a/docs/file_7.txt",
      bytesTransferred: 1234,
      elapsedSeconds: 1,
    },
  },
  {
    copySetsMetadata: {
      name: "file_8.json",
      size: 45678,
      costEstimate: {
        crossRegionCostUSD: 0.0,
        coldStorageRetrievalCostUSD: 0.0,
        computeCostUSD: 0.0,
      },
    },
    copyResultMetadata: {
      name: "file_8.json",
      status: "ALREADYCOPIED",
      speed: 0,
      message: "destination already up to date",
      destination:
        "s3://a-very-long-bucket-name/a-very-long-prefix/project-b/metadata/file_8.json",
      bytesTransferred: 0,
      elapsedSeconds: 0,
    },
  },
  {
    copySetsMetadata: {
      name: "file_9.tsv",
      size: 7890123,
      costEstimate: {
        crossRegionCostUSD: 0.01,
        coldStorageRetrievalCostUSD: 0.0,
        computeCostUSD: 0.01,
      },
    },
    copyResultMetadata: {
      name: "file_9.tsv",
      status: "ERROR",
      speed: 0,
      message: "permission denied while writing destination object",
      destination:
        "s3://a-very-long-bucket-name/a-very-long-prefix/project-b/results/file_9.tsv",
      bytesTransferred: 0,
      elapsedSeconds: 2,
    },
  },
  {
    copySetsMetadata: {
      name: "file_10.tar.gz",
      size: 2345678901,
      costEstimate: {
        crossRegionCostUSD: 0.45,
        coldStorageRetrievalCostUSD: 0.22,
        computeCostUSD: 0.03,
      },
    },
    copyResultMetadata: {
      name: "file_10.tar.gz",
      status: "COPIED",
      speed: 45.12,
      message: "",
      destination:
        "s3://a-very-long-bucket-name/a-very-long-prefix/project-b/archives/file_10.tar.gz",
      bytesTransferred: 2345678901,
      elapsedSeconds: 52,
    },
  },
  {
    copySetsMetadata: {
      name: "file_11.bed",
      size: 345678,
      costEstimate: {
        crossRegionCostUSD: 0.0,
        coldStorageRetrievalCostUSD: 0.0,
        computeCostUSD: 0.0,
      },
    },
    copyResultMetadata: {
      name: "file_11.bed",
      status: "COPIED",
      speed: 0.82,
      message: "",
      destination:
        "s3://a-very-long-bucket-name/a-very-long-prefix/project-c/annotations/file_11.bed",
      bytesTransferred: 345678,
      elapsedSeconds: 1,
    },
  },
  {
    copySetsMetadata: {
      name: "file_12.bim",
      size: 234567,
      costEstimate: {
        crossRegionCostUSD: 0.0,
        coldStorageRetrievalCostUSD: 0.0,
        computeCostUSD: 0.0,
      },
    },
    copyResultMetadata: {
      name: "file_12.bim",
      status: "COPIED",
      speed: 0.63,
      message: "",
      destination:
        "s3://a-very-long-bucket-name/a-very-long-prefix/project-c/annotations/file_12.bim",
      bytesTransferred: 234567,
      elapsedSeconds: 1,
    },
  },
  {
    copySetsMetadata: {
      name: "file_13.fam",
      size: 198765,
      costEstimate: {
        crossRegionCostUSD: 0.0,
        coldStorageRetrievalCostUSD: 0.0,
        computeCostUSD: 0.0,
      },
    },
    copyResultMetadata: {
      name: "file_13.fam",
      status: "COPIED",
      speed: 0.51,
      message: "",
      destination:
        "s3://a-very-long-bucket-name/a-very-long-prefix/project-c/annotations/file_13.fam",
      bytesTransferred: 198765,
      elapsedSeconds: 1,
    },
  },
  {
    copySetsMetadata: {
      name: "file_14.sam",
      size: 1456789012,
      costEstimate: {
        crossRegionCostUSD: 0.31,
        coldStorageRetrievalCostUSD: 0.12,
        computeCostUSD: 0.02,
      },
    },
    copyResultMetadata: {
      name: "file_14.sam",
      status: "ERROR",
      speed: 0,
      message: "network timeout after partial upload attempt",
      destination:
        "s3://a-very-long-bucket-name/a-very-long-prefix/project-d/alignment/file_14.sam",
      bytesTransferred: 104857600,
      elapsedSeconds: 17,
    },
  },
  {
    copySetsMetadata: {
      name: "file_15.fastq.gz",
      size: 812345678,
      costEstimate: {
        crossRegionCostUSD: 0.18,
        coldStorageRetrievalCostUSD: 0.06,
        computeCostUSD: 0.02,
      },
    },
    copyResultMetadata: {
      name: "file_15.fastq.gz",
      status: "COPIED",
      speed: 19.87,
      message: "transfer completed successfully",
      destination:
        "s3://a-very-long-bucket-name/a-very-long-prefix/project-d/reads/file_15.fastq.gz",
      bytesTransferred: 812345678,
      elapsedSeconds: 41,
    },
  },
  {
    copySetsMetadata: {
      name: "file_16.fastq.gz",
      size: 834567890,
      costEstimate: {
        crossRegionCostUSD: 0.19,
        coldStorageRetrievalCostUSD: 0.06,
        computeCostUSD: 0.02,
      },
    },
    copyResultMetadata: {
      name: "file_16.fastq.gz",
      status: "COPIED",
      speed: 20.41,
      message: "",
      destination:
        "s3://a-very-long-bucket-name/a-very-long-prefix/project-d/reads/file_16.fastq.gz",
      bytesTransferred: 834567890,
      elapsedSeconds: 40,
    },
  },
  {
    copySetsMetadata: {
      name: "file_17.idx",
      size: 4567890,
      costEstimate: {
        crossRegionCostUSD: 0.0,
        coldStorageRetrievalCostUSD: 0.0,
        computeCostUSD: 0.01,
      },
    },
    copyResultMetadata: {
      name: "file_17.idx",
      status: "ALREADYCOPIED",
      speed: 0,
      message: "already present at destination",
      destination:
        "s3://a-very-long-bucket-name/a-very-long-prefix/project-d/indexes/file_17.idx",
      bytesTransferred: 0,
      elapsedSeconds: 0,
    },
  },
  {
    copySetsMetadata: {
      name: "file_18.log",
      size: 67890,
      costEstimate: {
        crossRegionCostUSD: 0.0,
        coldStorageRetrievalCostUSD: 0.0,
        computeCostUSD: 0.0,
      },
    },
    copyResultMetadata: {
      name: "file_18.log",
      status: "ERROR",
      speed: 0,
      message: "destination bucket policy blocked write request",
      destination:
        "s3://a-very-long-bucket-name/a-very-long-prefix/project-e/logs/file_18.log",
      bytesTransferred: 0,
      elapsedSeconds: 1,
    },
  },
  {
    copySetsMetadata: {
      name: "file_19.csv",
      size: 8901234,
      costEstimate: {
        crossRegionCostUSD: 0.01,
        coldStorageRetrievalCostUSD: 0.0,
        computeCostUSD: 0.01,
      },
    },
    copyResultMetadata: {
      name: "file_19.csv",
      status: "ESTIMATED",
      speed: 0,
      message: "cost estimate generated before execution",
      destination:
        "s3://a-very-long-bucket-name/a-very-long-prefix/project-e/reports/file_19.csv",
      bytesTransferred: 0,
      elapsedSeconds: 0,
    },
  },
  {
    copySetsMetadata: {
      name: "file_20.parquet",
      size: 190123456,
      costEstimate: {
        crossRegionCostUSD: 0.08,
        coldStorageRetrievalCostUSD: 0.03,
        computeCostUSD: 0.01,
      },
    },
    copyResultMetadata: {
      name: "file_20.parquet",
      status: "COPIED",
      speed: 15.77,
      message: "",
      destination:
        "s3://a-very-long-bucket-name/a-very-long-prefix/project-e/warehouse/file_20.parquet",
      bytesTransferred: 190123456,
      elapsedSeconds: 12,
    },
  },
  {
    copySetsMetadata: {
      name: "file_21.h5",
      size: 2901234567,
      costEstimate: {
        crossRegionCostUSD: 0.55,
        coldStorageRetrievalCostUSD: 0.28,
        computeCostUSD: 0.04,
      },
    },
    copyResultMetadata: {
      name: "file_21.h5",
      status: "COPIED",
      speed: 51.23,
      message: "large file transferred successfully",
      destination:
        "s3://a-very-long-bucket-name/a-very-long-prefix/project-f/matrices/file_21.h5",
      bytesTransferred: 2901234567,
      elapsedSeconds: 57,
    },
  },
  {
    copySetsMetadata: {
      name: "file_22.rds",
      size: 120123456,
      costEstimate: {
        crossRegionCostUSD: 0.06,
        coldStorageRetrievalCostUSD: 0.02,
        computeCostUSD: 0.01,
      },
    },
    copyResultMetadata: {
      name: "file_22.rds",
      status: "ALREADYCOPIED",
      speed: 0,
      message: "checksum matched existing object",
      destination:
        "s3://a-very-long-bucket-name/a-very-long-prefix/project-f/objects/file_22.rds",
      bytesTransferred: 0,
      elapsedSeconds: 0,
    },
  },
  {
    copySetsMetadata: {
      name: "file_23.mt",
      size: 220123456,
      costEstimate: {
        crossRegionCostUSD: 0.09,
        coldStorageRetrievalCostUSD: 0.03,
        computeCostUSD: 0.01,
      },
    },
    copyResultMetadata: {
      name: "file_23.mt",
      status: "ERROR",
      speed: 0,
      message: "multipart upload failed during finalization",
      destination:
        "s3://a-very-long-bucket-name/a-very-long-prefix/project-f/tables/file_23.mt",
      bytesTransferred: 73400320,
      elapsedSeconds: 14,
    },
  },
  {
    copySetsMetadata: {
      name: "file_24.bgz",
      size: 32123456,
      costEstimate: {
        crossRegionCostUSD: 0.02,
        coldStorageRetrievalCostUSD: 0.0,
        computeCostUSD: 0.01,
      },
    },
    copyResultMetadata: {
      name: "file_24.bgz",
      status: "COPIED",
      speed: 6.75,
      message: "",
      destination:
        "s3://a-very-long-bucket-name/a-very-long-prefix/project-g/compressed/file_24.bgz",
      bytesTransferred: 32123456,
      elapsedSeconds: 5,
    },
  },
  {
    copySetsMetadata: {
      name: "file_25.gtf",
      size: 4212345,
      costEstimate: {
        crossRegionCostUSD: 0.0,
        coldStorageRetrievalCostUSD: 0.0,
        computeCostUSD: 0.01,
      },
    },
    copyResultMetadata: {
      name: "file_25.gtf",
      status: "COPIED",
      speed: 1.34,
      message: "annotation copied",
      destination:
        "s3://a-very-long-bucket-name/a-very-long-prefix/project-g/refs/file_25.gtf",
      bytesTransferred: 4212345,
      elapsedSeconds: 3,
    },
  },
  {
    copySetsMetadata: {
      name: "file_26.fa",
      size: 52123456,
      costEstimate: {
        crossRegionCostUSD: 0.02,
        coldStorageRetrievalCostUSD: 0.01,
        computeCostUSD: 0.01,
      },
    },
    copyResultMetadata: {
      name: "file_26.fa",
      status: "COPIED",
      speed: 9.44,
      message: "",
      destination:
        "s3://a-very-long-bucket-name/a-very-long-prefix/project-g/refs/file_26.fa",
      bytesTransferred: 52123456,
      elapsedSeconds: 6,
    },
  },
  {
    copySetsMetadata: {
      name: "file_27.fai",
      size: 12345,
      costEstimate: {
        crossRegionCostUSD: 0.0,
        coldStorageRetrievalCostUSD: 0.0,
        computeCostUSD: 0.0,
      },
    },
    copyResultMetadata: {
      name: "file_27.fai",
      status: "COPIED",
      speed: 0.08,
      message: "",
      destination:
        "s3://a-very-long-bucket-name/a-very-long-prefix/project-g/refs/file_27.fai",
      bytesTransferred: 12345,
      elapsedSeconds: 1,
    },
  },
  {
    copySetsMetadata: {
      name: "file_28.dict",
      size: 23456,
      costEstimate: {
        crossRegionCostUSD: 0.0,
        coldStorageRetrievalCostUSD: 0.0,
        computeCostUSD: 0.0,
      },
    },
    copyResultMetadata: {
      name: "file_28.dict",
      status: "ALREADYCOPIED",
      speed: 0,
      message: "dictionary file already available",
      destination:
        "s3://a-very-long-bucket-name/a-very-long-prefix/project-g/refs/file_28.dict",
      bytesTransferred: 0,
      elapsedSeconds: 0,
    },
  },
  {
    copySetsMetadata: {
      name: "file_29.html",
      size: 3456789,
      costEstimate: {
        crossRegionCostUSD: 0.0,
        coldStorageRetrievalCostUSD: 0.0,
        computeCostUSD: 0.01,
      },
    },
    copyResultMetadata: {
      name: "file_29.html",
      status: "ESTIMATED",
      speed: 0,
      message: "preview generated without copy execution",
      destination:
        "s3://a-very-long-bucket-name/a-very-long-prefix/project-h/reports/file_29.html",
      bytesTransferred: 0,
      elapsedSeconds: 0,
    },
  },
  {
    copySetsMetadata: {
      name: "file_30.pdf",
      size: 14567890,
      costEstimate: {
        crossRegionCostUSD: 0.01,
        coldStorageRetrievalCostUSD: 0.0,
        computeCostUSD: 0.01,
      },
    },
    copyResultMetadata: {
      name: "file_30.pdf",
      status: "COPIED",
      speed: 4.52,
      message: "report copied",
      destination:
        "s3://a-very-long-bucket-name/a-very-long-prefix/project-h/reports/file_30.pdf",
      bytesTransferred: 14567890,
      elapsedSeconds: 4,
    },
  },
];

// Multiply mock data so can test long table behaviour
const multiplier = 10;

// Repeat each mock set using Array fill + flat
const repeatedDryRun = Array.from(
  { length: multiplier },
  () => reportMetadataDryRun,
).flat();
const repeatedCopy = Array.from(
  { length: multiplier },
  () => reportMetadataCopy,
).flat();

// Build  ReportMetadata array
const reportMetadata: ReportMetadata[] = dryRun ? repeatedDryRun : repeatedCopy;

// Generate the report
const htmlReport = createHtmlReport({
  title: dryRun ? "Estimation Report" : "Copy Results Report",
  destinationBucket: "a-very-long-bucket-name",
  destinationFolderKey: "a-very-long-prefix/",
  reportMetadata,
  dryRun,
  pricingData: pricingData,
});

const outFile = path.join(
  __dirname,
  dryRun ? "test-report-preview-dryrun.html" : "test-report-preview-copy.html",
);
writeFileSync(outFile, await htmlReport, "utf8");
console.log(`Report written to: ${outFile}`);

// Try to open the report file just created
try {
  const platform = process.platform;
  if (platform === "darwin") execSync(`open "${outFile}"`);
  else if (platform === "linux") execSync(`xdg-open "${outFile}"`);
  else if (platform === "win32")
    execSync(`start "" "${outFile}"`, {
      stdio: "inherit",
    });
} catch {
  console.log("Could not auto-open the report, please open it manually.");
}
