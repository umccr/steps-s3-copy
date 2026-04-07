// test-report-preview.ts
// Local developer preview for HTML report generation with mock data

import { writeFileSync } from "fs";
import { join } from "path";
import { createHtmlReport } from "../packages/steps-s3-copy/lambda/summarise-copy-lambda/create-html-report";
import type {
  ReportMetadata,
  FileCopySetsMetadata,
  FileCopyResultMetadata,
} from "../packages/steps-s3-copy/lambda/summarise-copy-lambda/summarise-copy-lambda";
import { execSync } from "child_process";

// Parse CLI args
const dryRun = process.argv.includes("--dry-run");

// Two sets of ReportMetadata: one for dry run, one for real copy
const reportMetadataDryRun: ReportMetadata[] = [
  {
    copySetsMetadata: {
      name: "file_1.fastq",
      destination:
        "s3://a-very-long-bucket-name/a-very-long-prefix/file_1.fastq",
      size: 123456789,
      FileCostEstimate: {
        s3CrossRegionReadWriteCostAUD: 0.12,
        coldStorageRetrievalCostAUD: 0.05,
        computeCostAUD: 0.01,
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
      destination:
        "s3://a-very-long-bucket-name/a-very-long-prefix/level-1-dir/file_2.bam",
      size: 987654321,
      FileCostEstimate: {
        s3CrossRegionReadWriteCostAUD: 0.1,
        coldStorageRetrievalCostAUD: 0.0,
        computeCostAUD: 0.01,
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
      destination:
        "s3://a-very-long-bucket-name/a-very-long-prefix/level-1-dir/level-2-dir/file_3.fastq.ora",
      size: 345678901,
      FileCostEstimate: {
        s3CrossRegionReadWriteCostAUD: 0.0,
        coldStorageRetrievalCostAUD: 0.0,
        computeCostAUD: 0.01,
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
      destination:
        "s3://a-very-long-bucket-name/a-very-long-prefix/file_1.fastq",
      size: 123456789,
      FileCostEstimate: {
        s3CrossRegionReadWriteCostAUD: 0.12,
        coldStorageRetrievalCostAUD: 0.05,
        computeCostAUD: 0.01,
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
      destination:
        "s3://a-very-long-bucket-name/a-very-long-prefix/level-1-dir/file_2.bam",
      size: 987654321,
      FileCostEstimate: {
        s3CrossRegionReadWriteCostAUD: 0.1,
        coldStorageRetrievalCostAUD: 0.0,
        computeCostAUD: 0.01,
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
      destination:
        "s3://a-very-long-bucket-name/a-very-long-prefix/level-1-dir/level-2-dir/file_3.fastq.ora",
      size: 345678901,
      FileCostEstimate: {
        s3CrossRegionReadWriteCostAUD: 0.0,
        coldStorageRetrievalCostAUD: 0.0,
        computeCostAUD: 0.01,
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
];

// Build  ReportMetadata array
const reportMetadata: ReportMetadata[] = dryRun
  ? reportMetadataDryRun
  : reportMetadataCopy;

// Generate the report
const htmlReport = createHtmlReport({
  title: dryRun ? "Estimation Report" : "Copy Results Report",
  destinationBucket: "a-very-long-bucket-name",
  destinationFolderKey: "a-very-long-prefix/",
  reportMetadata,
  dryRun,
});

const outFile = join(
  __dirname,
  dryRun ? "test-report-preview-dryrun.html" : "test-report-preview-copy.html",
);
writeFileSync(outFile, htmlReport, "utf8");
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
  console.log("Could not auto-open the report, plese open it manually.");
}
