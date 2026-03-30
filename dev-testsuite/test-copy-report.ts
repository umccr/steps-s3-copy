import { writeFileSync } from "fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import {
  createHtmlReport,
  type FileSummary,
} from "../packages/steps-s3-copy/lambda/summarise-copy-lambda/create-html-report.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, "..");

// Mock copy files results

const html = createHtmlReport({
  title: "Copy Results Report (local preview: dev_copy_report.html)",
  destinationBucket: "dest-bucket",
  destinationFolderKey: "some/long/path/to/test/popover/behaviour/",
  // Add mock per-file cost data as arrays
  summSmall: [
    {
      name: "file1-small.fastq.ora",
      size: 123456,
      s3CrossRegionReadWriteCostAUD: 0.002,
      coldStorageRetrievalCostAUD: 0.0,
      computeCostAUD: 0.0003,
      status: "COPIED",
      speed: 12.3,
      message: "A message or number.",
      destination:
        "s3://dest-bucket/some/long/path/to/test/popover/behaviour/file1-small.fastq.ora",
      bytesTransferred: 345_678,
      elapsedSeconds: 5,
    },
  ],
  summLarge: [
    {
      name: "file1-large.fastq.ora",
      size: 234567,
      s3CrossRegionReadWriteCostAUD: 0.0045,
      coldStorageRetrievalCostAUD: 0.0,
      computeCostAUD: 0.0011,
      status: "COPIED",
      speed: 12.3,
      message: "A message or number.",
      destination:
        "s3://dest-bucket/some/long/path/to/test/popover/behaviour/file1-small.fastq.ora",
      bytesTransferred: 345_678,
      elapsedSeconds: 5,
    },
  ],
  summSmallThaw: [
    {
      name: "file1-small-thaw.fastq.ora",
      size: 345678,
      s3CrossRegionReadWriteCostAUD: 0.0013,
      coldStorageRetrievalCostAUD: 0.015,
      computeCostAUD: 0.0002,
      status: "COPIED",
      speed: 12.3,
      message: "A message or number.",
      destination:
        "s3://dest-bucket/some/long/path/to/test/popover/behaviour/file1-small.fastq.ora",
      bytesTransferred: 345_678,
      elapsedSeconds: 5,
    },
  ],
  summLargeThaw: [
    {
      name: "file1-large-thaw.fastq.ora",
      size: 456789,
      s3CrossRegionReadWriteCostAUD: 0.0021,
      coldStorageRetrievalCostAUD: 0.038,
      computeCostAUD: 0.0007,
      status: "COPIED",
      speed: 12.3,
      message: "A message or number.",
      destination:
        "s3://dest-bucket/some/long/path/to/test/popover/behaviour/file1-small.fastq.ora",
      bytesTransferred: 345_678,
      elapsedSeconds: 5,
    },
  ],
});
const outPath = join(__dirname, "dev_copy_report.html");
writeFileSync(outPath, html, "utf-8");
console.log(`dev_copy_report.html written: ${outPath}`);

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
