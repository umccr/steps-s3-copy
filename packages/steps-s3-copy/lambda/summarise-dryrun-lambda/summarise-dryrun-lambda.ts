import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { basename } from "path/posix";
import { stringify } from "csv-stringify/sync";
import { dirname } from "path/posix";
import { createHtmlReport } from "./create-dryrun-report.ts";

interface InvokeEvent {
  destinationBucket: string;
  destinationPrefixKey: string;
  destinationEndCopyRelativeKey: string;
  workingBucket: string;
  copyInstructionsKey: string;
  retainCopyReport?: boolean;
  inputCopySets: {
    small: { bucket: string; key: string };
    large: { bucket: string; key: string };
    smallThaw: { bucket: string; key: string };
    largeThaw: { bucket: string; key: string };
  };
}

// This is the shape of the cost estimate metadata.
interface CostEstimate {
  s3CrossRegionReadWriteCostAUD: number;
  coldStorageRetrievalCostAUD: number;
  computeCostAUD: number;
}
/**
 * Reads the per-file cost estimates from the JSONL
 */
async function readCostsFromJsonl(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<CostEstimate> {
  const costs: CostEstimate = {
    s3CrossRegionReadWriteCostAUD: 0,
    coldStorageRetrievalCostAUD: 0,
    computeCostAUD: 0,
  };

  const getCommand = new GetObjectCommand({ Bucket: bucket, Key: key });
  const result = await client.send(getCommand);

  if (!result.Body) return costs;

  const content = await result.Body.transformToString();
  const lines = content
    .trim()
    .split(/\r?\n/)
    .filter((l) => l.trim());

  for (const line of lines) {
    const obj = JSON.parse(line);
    const cost = obj.costEstimate;

    if (cost) {
      costs.s3CrossRegionReadWriteCostAUD +=
        cost.s3CrossRegionReadWriteCostAUD || 0;
      costs.coldStorageRetrievalCostAUD +=
        cost.coldStorageRetrievalCostAUD || 0;
      costs.computeCostAUD += cost.computeCostAUD || 0;
    }
  }

  return costs;
}

export async function handler(event: InvokeEvent) {
  const client = new S3Client({});

  const costsSmall = await readCostsFromJsonl(
    client,
    event.inputCopySets.small.bucket,
    event.inputCopySets.small.key,
  );
  const costsLarge = await readCostsFromJsonl(
    client,
    event.inputCopySets.large.bucket,
    event.inputCopySets.large.key,
  );
  const costsSmallThaw = await readCostsFromJsonl(
    client,
    event.inputCopySets.smallThaw.bucket,
    event.inputCopySets.smallThaw.key,
  );
  const costsLargeThaw = await readCostsFromJsonl(
    client,
    event.inputCopySets.largeThaw.bucket,
    event.inputCopySets.largeThaw.key,
  );

  // --------------------------------------------------
  // HTML ended copy report generation and storage
  // --------------------------------------------------

  // Determine if we need to generate and store the HTML report(s)
  const retainReport = event.retainCopyReport;

  if (retainReport) {
    const htmlReportName = "DRY_RUN_REPORT.html";

    // Generate the HTML report
    const html = createHtmlReport({
      title: "Dry Run Report",
      costsSmall,
      costsLarge,
      costsSmallThaw,
      costsLargeThaw,
    });

    const sourceFilePrefix = dirname(event.copyInstructionsKey) + "/";
    const retainReportKey = sourceFilePrefix + htmlReportName;

    await client.send(
      new PutObjectCommand({
        Bucket: event.workingBucket,
        Key: retainReportKey,
        Body: html,
        ContentType: "text/html; charset=utf-8",
      }),
    );
  }
  return;
}
