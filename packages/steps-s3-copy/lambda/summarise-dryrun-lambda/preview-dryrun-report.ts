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
  {
    name: "A.fastq.ora",
    size: 6291456,
    computeCostAUD: 0.0003,
    s3CrossRegionReadWriteCostAUD: 0.001,
    coldStorageRetrievalCostAUD: 0.0,
  },
  {
    name: "B.fastq.ora",
    size: 15728640,
    computeCostAUD: 0.0003,
    s3CrossRegionReadWriteCostAUD: 0.001,
    coldStorageRetrievalCostAUD: 0.0,
  },
  {
    name: "C.fastq.ora",
    size: 123456789,
    computeCostAUD: 0.0003,
    s3CrossRegionReadWriteCostAUD: 0.001,
    coldStorageRetrievalCostAUD: 0.0,
  },
  {
    name: "D.fastq.ora",
    size: 123456789,
    computeCostAUD: 0.0003,
    s3CrossRegionReadWriteCostAUD: 0.001,
    coldStorageRetrievalCostAUD: 0.0,
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
