import { writeFileSync } from "fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { createHtmlReport } from "./create-dryrun-report.ts";

// Run:
//   npx tsx packages/steps-s3-copy/lambda/summarise-dryrun-lambda/preview-dryrun-report.ts
//
// It will write dev_dryrun_report.html next to this file and try to open it.

const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, "..");

const html = createHtmlReport({
  title: "Dry Run Results Report (local preview: dev_dryrun_report.html)",
  // Add mock cost data
  costsSmall: {
    s3CrossRegionReadWriteCostAUD: 0.002,
    coldStorageRetrievalCostAUD: 0.0,
    computeCostAUD: 0.0003,
  },
  costsLarge: {
    s3CrossRegionReadWriteCostAUD: 0.0045,
    coldStorageRetrievalCostAUD: 0.0,
    computeCostAUD: 0.0011,
  },
  costsSmallThaw: {
    s3CrossRegionReadWriteCostAUD: 0.0013,
    coldStorageRetrievalCostAUD: 0.015,
    computeCostAUD: 0.0002,
  },
  costsLargeThaw: {
    s3CrossRegionReadWriteCostAUD: 0.0021,
    coldStorageRetrievalCostAUD: 0.038,
    computeCostAUD: 0.0007,
  },
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
