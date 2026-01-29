import { writeFileSync } from "fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { createHtmlReport, type FileResult } from "./create-html-report.ts";

// Run:
//   npx tsx packages/steps-s3-copy/lambda/summarise-copy-lambda/preview-copy-report.ts
//
// It will write dev_copy_report.html next to this file and try to open it.

const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, "..");

// Mock copy files results
const records: FileResult[] = [
  {
    name: "A.fastq.ora",
    status: "ALREADYCOPIED",
    speed: 0,
    message:
      "destination file already exists with same checksum so nothing was transferred",
    destination:
      "s3://dest-bucket/some/long/path/to/test/popover/behaviour/Lane_1/A.fastq.ora",
    bytesTransferred: 0,
    elapsedSeconds: 0,
  },
  {
    name: "B.fastq.ora",
    status: "COPIED",
    speed: 12.3,
    message: "",
    destination:
      "s3://dest-bucket/some/long/path/to/test/popover/behaviour/Lane_2/B.fastq.ora",
    bytesTransferred: 123_456_789,
    elapsedSeconds: 10,
  },
  {
    name: "C.fastq.ora",
    status: "ERROR",
    speed: 0,
    message: "AccessDenied",
    destination:
      "s3://dest-bucket/some/long/path/to/test/popover/behaviour/Lane_1/C.fastq.ora",
    bytesTransferred: 0,
    elapsedSeconds: 0,
  },
];

const html = createHtmlReport({
  title: "Copy Results Report (local preview: dev_copy_report.html)",
  records,
  destinationBucket: "dest-bucket",
  destinationFolderKey: "some/long/path/to/test/popover/behaviour/",
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
