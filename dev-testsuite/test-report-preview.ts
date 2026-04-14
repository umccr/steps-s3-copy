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
      size: 123456789,
      FileCostEstimate: {
        crossRegionCostUSD: 0.12,
        coldStorageRetrievalCostUSD: 0.05,
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
      size: 987654321,
      FileCostEstimate: {
        crossRegionCostUSD: 0.1,
        coldStorageRetrievalCostUSD: 0.0,
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
      size: 345678901,
      FileCostEstimate: {
        crossRegionCostUSD: 0.0,
        coldStorageRetrievalCostUSD: 0.0,
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
      size: 123456789,
      FileCostEstimate: {
        crossRegionCostUSD: 0.12,
        coldStorageRetrievalCostUSD: 0.05,
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
      size: 987654321,
      FileCostEstimate: {
        crossRegionCostUSD: 0.1,
        coldStorageRetrievalCostUSD: 0.0,
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
      size: 345678901,
      FileCostEstimate: {
        crossRegionCostUSD: 0.0,
        coldStorageRetrievalCostUSD: 0.0,
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

// API CALL test

import {
  PricingClient,
  GetProductsCommand,
  FilterType,
} from "@aws-sdk/client-pricing";

// const client = new PricingClient({ region: "us-east-1" });

// const command = new GetProductsCommand({
//   ServiceCode: "AWSDataTransfer",
//   Filters: [
//     { Type: FilterType.TERM_MATCH, Field: "fromRegionCode", Value: "ap-southeast-2" },
//     { Type: FilterType.TERM_MATCH, Field: "transferType", Value: "AWS Outbound" },
//   ],
//   MaxResults: 10,
// });

// const response = await client.send(command);

// for (const item of response.PriceList ?? []) {
//   console.log(JSON.stringify(JSON.parse(item as string), null, 2));
// }

// const client = new PricingClient({ region: "us-east-1" });

// const command = new GetProductsCommand({
//   ServiceCode: "AmazonS3",
//   Filters: [
//     { Type: FilterType.TERM_MATCH, Field: "regionCode", Value: "ap-southeast-2" },
//     { Type: FilterType.TERM_MATCH, Field: "usagetype", Value: "APS2-Requests-Tier1" },
//   ],
//   MaxResults: 10,
// });

// const response = await client.send(command);

// for (const item of response.PriceList ?? []) {
//   const parsed = JSON.parse(item as string);
//   console.log(JSON.stringify(parsed.product.attributes, null, 2));
// }

// export interface EgressPriceTier {
//   beginRangeGb: number;
//   endRangeGb: number;
//   pricePerGbUsd: number;
// }

// export async function fetchS3CrossRegionEgressPrice(
//   fromRegion: string,
// ): Promise<EgressPriceTier[]> {
//   const client = new PricingClient({ region: "us-east-1" });
//   const command = new GetProductsCommand({
//     ServiceCode: "AWSDataTransfer",
//     Filters: [
//       { Type: FilterType.TERM_MATCH, Field: "fromRegionCode", Value: fromRegion },
//       { Type: FilterType.TERM_MATCH, Field: "transferType", Value: "AWS Outbound" },
//     ],
//     MaxResults: 1,
//   });

//   const response = await client.send(command);
//   if (!response.PriceList?.length) return [];

//   const priceItem = JSON.parse(response.PriceList[0] as string);
//   const terms = priceItem.terms?.OnDemand || {};
//   const tiers: EgressPriceTier[] = [];

//   for (const termKey of Object.keys(terms)) {
//     const priceDimensions = terms[termKey].priceDimensions || {};
//     for (const dimKey of Object.keys(priceDimensions)) {
//       const dim = priceDimensions[dimKey];
//       const usd = dim.pricePerUnit?.USD;
//       if (!usd) continue;
//       tiers.push({
//         beginRangeGb: parseFloat(dim.beginRange),
//         endRangeGb: dim.endRange === "Inf" ? Infinity : parseFloat(dim.endRange),
//         pricePerGbUsd: parseFloat(usd),
//       });
//     }
//   }

//   // Sort by beginRange ascending
//   return tiers.sort((a, b) => a.beginRangeGb - b.beginRangeGb);
// }

// export function getEgressPriceForBytes(
//   tiers: EgressPriceTier[],
//   sizeBytes: number,
// ): number {
//   const totalGb = sizeBytes / 1024 / 1024 / 1024;
//   const tier = tiers.find(
//     (t) => totalGb >= t.beginRangeGb && totalGb < t.endRangeGb,
//   );
//   return tier?.pricePerGbUsd ?? 0;
// }

// fetchS3CrossRegionEgressPrice("ap-southeast-2").then((tiers) => {
//   console.log("Egress price tiers for ap-southeast-2:");
//   console.table(tiers);
//   const priceFor100GB = getEgressPriceForBytes(tiers, 100 * 1024 * 1024 * 1024);
//   console.log(`Price for transferring 100 GB: $${priceFor100GB.toFixed(4)} USD`);
// });

// export async function fetchS3PutRequestPrice(
//   fromRegion: string,
// ): Promise<number> {
//   const client = new PricingClient({ region: "us-east-1" });
//   const command = new GetProductsCommand({
//     ServiceCode: "AmazonS3",
//     Filters: [
//       { Type: FilterType.TERM_MATCH, Field: "regionCode", Value: fromRegion },
//       { Type: FilterType.TERM_MATCH, Field: "group", Value: "S3-API-Tier1" },
//     ],
//     MaxResults: 1,
//   });

//   const response = await client.send(command);
//   if (!response.PriceList?.length) return 0;

//   const priceItem = JSON.parse(response.PriceList[0] as string);
//   const terms = priceItem.terms?.OnDemand || {};

//   for (const termKey of Object.keys(terms)) {
//     const priceDimensions = terms[termKey].priceDimensions || {};
//     for (const dimKey of Object.keys(priceDimensions)) {
//       const usd = priceDimensions[dimKey].pricePerUnit?.USD;
//       if (usd) return parseFloat(usd);
//     }
//   }
//   return 0;
// }

// // fetchS3PutRequestPrice("ap-southeast-2").then((price) => {
// //   console.log(`S3 PUT request price for ap-southeast-2: $${price.toFixed(6)} USD`);
// // });

// export function estimateS3CrossRegionCost(
//   tiers: EgressPriceTier[],
//   putPricePerRequest: number,
//   sizeBytes: number,
// ): { egressCostUsd: number; putCostUsd: number; totalCostUsd: number } {
//   const egressCostUsd = getEgressPriceForBytes(tiers, sizeBytes);
//   const putCostUsd = putPricePerRequest; // 1 PUT request
//   const totalCostUsd = egressCostUsd + putCostUsd;
//   return { egressCostUsd, putCostUsd, totalCostUsd };
// }

// const region = "ap-southeast-2";
// const sizeBytes = 100 * 1024 * 1024 * 1024; // 100 GB

// const tiers = await fetchS3CrossRegionEgressPrice(region);
// const putPrice = await fetchS3PutRequestPrice(region);

// const estimate = estimateS3CrossRegionCost(tiers, putPrice, sizeBytes);

// console.log(`Estimate for transferring 100 GB from ${region}:`);
// console.log(`  Egress cost : $${estimate.egressCostUsd.toFixed(6)} USD`);
// console.log(`  PUT cost    : $${estimate.putCostUsd.toFixed(6)} USD`);
// console.log(`  Total cost  : $${estimate.totalCostUsd.toFixed(6)} USD`);
