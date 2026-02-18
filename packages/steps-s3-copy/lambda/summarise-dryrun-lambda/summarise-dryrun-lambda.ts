import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { basename } from "path/posix";
import { stringify } from "csv-stringify/sync";
import { dirname } from "path/posix";
import { createHtmlReport, FileSummary } from "./create-dryrun-report.ts";

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

/**
 * Reads the per-file Summaries from the JSONL
 */
export async function readFileSummariesFromJsonl(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<FileSummary[]> {
  const getCommand = new GetObjectCommand({ Bucket: bucket, Key: key });
  const result = await client.send(getCommand);

  if (!result.Body) return [];

  const content = await result.Body.transformToString();
  const lines = content
    .trim()
    .split(/\r?\n/)
    .filter((l) => l.trim());

  const out: FileSummary[] = [];

  for (const line of lines) {
    const obj = JSON.parse(line);
    const cost = obj.costEstimate;
    if (cost) {
      out.push({
        name: obj.sourceKey, // adjust as needed
        size: obj.size || 0,
        s3CrossRegionReadWriteCostAUD: cost.s3CrossRegionReadWriteCostAUD || 0,
        coldStorageRetrievalCostAUD: cost.coldStorageRetrievalCostAUD || 0,
        computeCostAUD: cost.computeCostAUD || 0,
        // ... other fields as needed
      });
    }
  }
  return out;
}

export async function handler(event: InvokeEvent) {
  const client = new S3Client({});

  const summSmall = await readFileSummariesFromJsonl(
    client,
    event.inputCopySets.small.bucket,
    event.inputCopySets.small.key,
  );
  const summLarge = await readFileSummariesFromJsonl(
    client,
    event.inputCopySets.large.bucket,
    event.inputCopySets.large.key,
  );
  const summSmallThaw = await readFileSummariesFromJsonl(
    client,
    event.inputCopySets.smallThaw.bucket,
    event.inputCopySets.smallThaw.key,
  );
  const summLargeThaw = await readFileSummariesFromJsonl(
    client,
    event.inputCopySets.largeThaw.bucket,
    event.inputCopySets.largeThaw.key,
  );

  // --------------------------------------------------
  // HTML report generation and storage
  // --------------------------------------------------

  // Determine if we need to generate and store the HTML report(s)
  const retainReport = event.retainCopyReport;

  if (retainReport) {
    const htmlReportName = "DRY_RUN_REPORT.html";

    // Generate the HTML report
    const html = createHtmlReport({
      title: "Dry Run Report",
      summSmall: summSmall,
      summLarge: summLarge,
      summSmallThaw: summSmallThaw,
      summLargeThaw: summLargeThaw,
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
