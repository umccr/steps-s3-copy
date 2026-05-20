import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import {
  PricingClient,
  GetProductsCommand,
  FilterType,
} from "@aws-sdk/client-pricing";

import {
  bytesToGB,
  defaultCopyDurationSeconds,
  DEFAULT_COPY_SPEED_MIBPS,
  FARGATE_MIN_BILLING_SECONDS,
  SIZE_THRESHOLD_BYTES,
  MULTIPART_CHUNK_SIZE,
  FARGATE_CPU_VCPU,
  FARGATE_MEMORY_MB,
  DEFAULT_FARGATE_OVERHEAD_SEC,
  LAMBDA_MEMORY_MB,
  DEFAULT_LAMBDA_OVERHEAD_SEC,
} from "./constants";

// Cost estimation logic for thawing, cross-region transfer, and compute costs.
// This is used by the fetch-pricing-data-lambda to fetch current costs from AWS Pricing API,
// for use in the cost estimation.

export type CostEstimate = {
  crossRegionCostUSD: number;
  coldStorageRetrievalCostUSD: number;
  computeCostUSD: number;
};

export interface PricingData {
  coldStorageCosts: ColdStorageRetrievalCosts;
  crossRegionCosts: CrossRegionCosts;
  computeCosts: ComputeCosts;
  fetchedAt: string;
}

// --------------------------------------------------------------------------------------------
// Thawing cost estimation (returns 0 for non-cold storage classes)
// --------------------------------------------------------------------------------------------
type TierCost = { perGB: number; perRequest: number };

export type ColdStorageRetrievalCosts = {
  tempStoragePerGBPerMonth: number;
  GLACIER: { Bulk: TierCost; Standard: TierCost; Expedited: TierCost };
  DEEP_ARCHIVE: { Bulk: TierCost; Standard: TierCost };
  INTELLIGENT_TIERING_ARCHIVE_ACCESS: {
    Bulk: TierCost;
    Standard: TierCost;
    Expedited: TierCost;
  };
  INTELLIGENT_TIERING_DEEP_ARCHIVE_ACCESS: {
    Bulk: TierCost;
    Standard: TierCost;
  };
};

export async function fetchColdStorageRetrievalCosts(
  region: string,
): Promise<ColdStorageRetrievalCosts> {
  const client = new PricingClient({ region: "us-east-1" });

  const sleep = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  const fetchAllPrices = async (
    allFilters: { Field: string; Value: string }[][],
  ) => {
    const results: number[] = [];
    for (const filters of allFilters) {
      results.push(await fetchPrice(filters));
      await sleep(200);
    }
    return results;
  };

  const fetchPrice = async (
    filters: { Field: string; Value: string }[],
  ): Promise<number> => {
    const command = new GetProductsCommand({
      ServiceCode: "AmazonS3",
      Filters: [
        { Type: FilterType.TERM_MATCH, Field: "regionCode", Value: region },
        ...filters.map((f) => ({
          Type: FilterType.TERM_MATCH,
          Field: f.Field,
          Value: f.Value,
        })),
      ],
      MaxResults: 1,
    });
    const response = await client.send(command);
    if (!response.PriceList?.length) return 0;
    const priceItem = JSON.parse(response.PriceList[0] as string);
    const priceDimensions = Object.values(
      (Object.values(priceItem.terms.OnDemand as Record<string, any>)[0] as any)
        .priceDimensions,
    )[0] as any;
    return parseFloat(priceDimensions.pricePerUnit.USD);
  };

  const [
    glacierStandardPerGB = 0,
    glacierBulkPerGB = 0,
    glacierExpeditedPerGB = 0,
    glacierStandardPerRequest = 0,
    glacierBulkPerRequest = 0,
    glacierExpeditedPerRequest = 0,
    deepArchiveStandardPerGB = 0,
    deepArchiveBulkPerGB = 0,
    deepArchiveStandardPerRequest = 0,
    deepArchiveBulkPerRequest = 0,
    intAAExpeditedPerGB = 0,
    intAAStandardPerGB = 0,
    intAABulkPerGB = 0,
    intAAExpeditedPerRequest = 0,
    intAAStandardPerRequest = 0,
    intAABulkPerRequest = 0,
    intDAAStandardPerGB = 0,
    intDAABulkPerGB = 0,
    intDAAStandardPerRequest = 0,
    intDAABulkPerRequest = 0,
    tempStoragePerGBPerMonth = 0,
  ] = await fetchAllPrices([
    // GLACIER perGB
    [
      { Field: "feeCode", Value: "S3-Standard-Retrieval" },
      { Field: "operation", Value: "RestoreObject" },
    ],
    [
      { Field: "feeCode", Value: "S3-Bulk-Retrieval" },
      { Field: "operation", Value: "RestoreObject" },
    ],
    [{ Field: "feeCode", Value: "S3-Expedited-Retrieval" }],
    // GLACIER perRequest
    [
      { Field: "group", Value: "S3-API-Tier3" },
      { Field: "operation", Value: "RestoreObject" },
    ],
    [{ Field: "group", Value: "S3-API-Tier5" }],
    [{ Field: "group", Value: "S3-API-Tier6" }],
    // DEEP_ARCHIVE perGB
    [
      { Field: "feeCode", Value: "S3-Standard-Retrieval" },
      { Field: "operation", Value: "DeepArchiveRestoreObject" },
    ],
    [
      { Field: "feeCode", Value: "S3-Bulk-Retrieval" },
      { Field: "operation", Value: "DeepArchiveRestoreObject" },
    ],
    // DEEP_ARCHIVE perRequest
    [
      { Field: "group", Value: "S3-API-Tier3" },
      { Field: "operation", Value: "DeepArchiveRestoreObject" },
    ],
    [
      { Field: "group", Value: "S3-API-Tier5" },
      { Field: "operation", Value: "DeepArchiveRestoreObjectBulk" },
    ],
    // INT_ARCHIVE perGB
    [
      { Field: "group", Value: "INT-AA-RestoreObject" },
      { Field: "groupDescription", Value: "Expedited INT Retrieval" },
    ],
    [
      { Field: "group", Value: "INT-AA-RestoreObject" },
      { Field: "groupDescription", Value: "Standard INT Retrieval" },
    ],
    [
      { Field: "group", Value: "INT-AA-RestoreObject" },
      { Field: "groupDescription", Value: "Bulk INT Retrieval" },
    ],
    // INT_ARCHIVE perRequest
    [{ Field: "group", Value: "S3-API-INT-AA-TIER6" }],
    [{ Field: "group", Value: "S3-API-INT-AA-TIER3" }],
    [
      { Field: "group", Value: "S3-API-INT-AA-TIER5" },
      { Field: "operation", Value: "RestoreObjectBulk" },
    ],
    // INT_DEEP_ARCHIVE perGB
    [
      { Field: "group", Value: "INT-DAA-RestoreObject" },
      { Field: "groupDescription", Value: "Standard INT Retrieval" },
    ],
    [
      { Field: "group", Value: "INT-DAA-RestoreObject" },
      { Field: "groupDescription", Value: "Bulk INT Retrieval" },
    ],
    // INT_DEEP_ARCHIVE perRequest
    [{ Field: "group", Value: "S3-API-DAA-TIER3" }],
    [
      { Field: "group", Value: "S3-API-DAA-TIER5" },
      { Field: "operation", Value: "RestoreObjectBulk" },
    ],
    // S3 Standard temp storage
    [
      { Field: "storageClass", Value: "General Purpose" },
      { Field: "volumeType", Value: "Standard" },
    ],
  ]);

  return {
    tempStoragePerGBPerMonth,
    GLACIER: {
      Bulk: { perGB: glacierBulkPerGB, perRequest: glacierBulkPerRequest },
      Standard: {
        perGB: glacierStandardPerGB,
        perRequest: glacierStandardPerRequest,
      },
      Expedited: {
        perGB: glacierExpeditedPerGB,
        perRequest: glacierExpeditedPerRequest,
      },
    },
    DEEP_ARCHIVE: {
      Bulk: {
        perGB: deepArchiveBulkPerGB,
        perRequest: deepArchiveBulkPerRequest,
      },
      Standard: {
        perGB: deepArchiveStandardPerGB,
        perRequest: deepArchiveStandardPerRequest,
      },
    },
    INTELLIGENT_TIERING_ARCHIVE_ACCESS: {
      Bulk: { perGB: intAABulkPerGB, perRequest: intAABulkPerRequest },
      Standard: {
        perGB: intAAStandardPerGB,
        perRequest: intAAStandardPerRequest,
      },
      Expedited: {
        perGB: intAAExpeditedPerGB,
        perRequest: intAAExpeditedPerRequest,
      },
    },
    INTELLIGENT_TIERING_DEEP_ARCHIVE_ACCESS: {
      Bulk: { perGB: intDAABulkPerGB, perRequest: intDAABulkPerRequest },
      Standard: {
        perGB: intDAAStandardPerGB,
        perRequest: intDAAStandardPerRequest,
      },
    },
  };
}

export function estimateColdStorageRetrievalCost(
  isColdStorage: boolean,
  sizeBytes: number,
  storageClass: string,
  retrievalSpeed: string,
  restoreWindowDays: number,
  coldStorageRetrievalCosts: ColdStorageRetrievalCosts,
): number {
  if (!isColdStorage) return 0;

  const tierCosts = (
    coldStorageRetrievalCosts[
      storageClass as keyof ColdStorageRetrievalCosts
    ] as Record<string, TierCost>
  )?.[retrievalSpeed];
  if (!tierCosts) return 0;

  const sizeGB = bytesToGB(sizeBytes);

  return (
    sizeGB * tierCosts.perGB +
    tierCosts.perRequest +
    sizeGB *
      coldStorageRetrievalCosts.tempStoragePerGBPerMonth *
      (restoreWindowDays / 30)
  );
}

// --------------------------------------------------------------------------------------------
// Cross Region S3 read/write cost est. (returns 0 for same-region copies, or if size is 0)
// --------------------------------------------------------------------------------------------

export type CrossRegionCosts = {
  egressPriceTiers: EgressPriceTier[];
  putPricePerRequest: number;
};

export async function fetchCrossRegionCosts(
  sourceRegion: string,
): Promise<CrossRegionCosts> {
  const [egressPriceTiers, putPricePerRequest] = await Promise.all([
    fetchCrossRegionEgressPrice(sourceRegion),
    fetchCrossRegionPutRequestPrice(sourceRegion),
  ]);
  return { egressPriceTiers, putPricePerRequest };
}

interface EgressPriceTier {
  beginRangeGb: number;
  endRangeGb: number;
  pricePerGbUsd: number;
}

export async function fetchCrossRegionEgressPrice(
  fromRegion: string,
): Promise<EgressPriceTier[]> {
  const client = new PricingClient({ region: "us-east-1" });
  const command = new GetProductsCommand({
    ServiceCode: "AWSDataTransfer",
    Filters: [
      {
        Type: FilterType.TERM_MATCH,
        Field: "fromRegionCode",
        Value: fromRegion,
      },
      {
        Type: FilterType.TERM_MATCH,
        Field: "transferType",
        Value: "AWS Outbound",
      },
    ],
    MaxResults: 1,
  });

  const response = await client.send(command);
  if (!response.PriceList?.length) return [];

  const priceItem = JSON.parse(response.PriceList[0] as string);
  const terms = priceItem.terms?.OnDemand || {};
  const tiers: EgressPriceTier[] = [];

  for (const termKey of Object.keys(terms)) {
    const priceDimensions = terms[termKey].priceDimensions || {};
    for (const dimKey of Object.keys(priceDimensions)) {
      const dim = priceDimensions[dimKey];
      const usd = dim.pricePerUnit?.USD;
      if (!usd) continue;
      tiers.push({
        beginRangeGb: parseFloat(dim.beginRange),
        endRangeGb:
          dim.endRange === "Inf" ? Infinity : parseFloat(dim.endRange),
        pricePerGbUsd: parseFloat(usd),
      });
    }
  }

  // Sort by beginRange ascending
  return tiers.sort((a, b) => a.beginRangeGb - b.beginRangeGb);
}

export async function fetchCrossRegionPutRequestPrice(
  fromRegion: string,
): Promise<number> {
  const client = new PricingClient({ region: "us-east-1" });
  const command = new GetProductsCommand({
    ServiceCode: "AmazonS3",
    Filters: [
      { Type: FilterType.TERM_MATCH, Field: "regionCode", Value: fromRegion },
      { Type: FilterType.TERM_MATCH, Field: "group", Value: "S3-API-Tier1" },
    ],
    MaxResults: 1,
  });

  const response = await client.send(command);
  if (!response.PriceList?.length) return 0;

  const priceItem = JSON.parse(response.PriceList[0] as string);
  const terms = priceItem.terms?.OnDemand || {};

  for (const termKey of Object.keys(terms)) {
    const priceDimensions = terms[termKey].priceDimensions || {};
    for (const dimKey of Object.keys(priceDimensions)) {
      const usd = priceDimensions[dimKey].pricePerUnit?.USD;
      if (usd) return parseFloat(usd);
    }
  }
  return 0;
}

/**
 * Calculates cross-region S3 egress cost with progressive AWS pricing tiers.
 */
export function estimateCrossRegionCost(
  isCrossRegion: boolean,
  crossRegionCosts: CrossRegionCosts,
  sizeBytes: number,
  multipartChunkSizeBytes: number = MULTIPART_CHUNK_SIZE,
): number {
  if (!isCrossRegion) return 0;

  const totalGB = bytesToGB(sizeBytes);

  // Apply each tier in order, allocating as much of the transfer as possible to each tier
  let gbRemaining = totalGB;
  let totalEgressCost = 0;
  for (const tier of crossRegionCosts.egressPriceTiers) {
    const tierSize =
      (tier.endRangeGb === Infinity ? Infinity : tier.endRangeGb) -
      tier.beginRangeGb;
    const gbInTier = Math.min(gbRemaining, tierSize);

    if (gbInTier > 0) {
      totalEgressCost += gbInTier * tier.pricePerGbUsd;
      gbRemaining -= gbInTier;
    }
    //  Once ALL GB have been billed
    if (gbRemaining <= 0) break;
  }

  // Calculate the number of request
  const numPutRequests = Math.max(
    1,
    Math.ceil(sizeBytes / multipartChunkSizeBytes),
  );
  const putRequestCost = numPutRequests * crossRegionCosts.putPricePerRequest;

  return totalEgressCost + putRequestCost;
}

// --------------------------------------------------------------------------------------------
// Compute cost estimation
// --------------------------------------------------------------------------------------------

export type ComputeCosts = {
  lambda: {
    gbSecondPrice: number;
    invocationPrice: number;
  };
  fargate: {
    vCpuPricePerHour: number;
    memoryGbPricePerHour: number;
  };
};

const regionPrefixMap: Record<string, string> = {
  "us-east-1": "USE1",
  "us-east-2": "USE2",
  "us-west-1": "USW1",
  "us-west-2": "USW2",
  "ap-southeast-1": "APS1",
  "ap-southeast-2": "APS2",
  "ap-northeast-1": "APN1",
  "ap-northeast-2": "APN2",
  "ap-south-1": "APS3",
  "eu-west-1": "EU",
  "eu-west-2": "EUW2",
  "eu-central-1": "EUC1",
  "ca-central-1": "CAN1",
  "sa-east-1": "SAE1",
};

async function fetchLambdaComputePrice(
  region: string,
): Promise<Pick<ComputeCosts, "lambda">> {
  const client = new PricingClient({ region: "us-east-1" });

  const [durationResponse, invocationResponse] = await Promise.all([
    client.send(
      new GetProductsCommand({
        ServiceCode: "AWSLambda",
        Filters: [
          { Type: FilterType.TERM_MATCH, Field: "regionCode", Value: region },
          {
            Type: FilterType.TERM_MATCH,
            Field: "group",
            Value: "AWS-Lambda-Duration",
          },
        ],
        MaxResults: 1,
      }),
    ),
    client.send(
      new GetProductsCommand({
        ServiceCode: "AWSLambda",
        Filters: [
          { Type: FilterType.TERM_MATCH, Field: "regionCode", Value: region },
          {
            Type: FilterType.TERM_MATCH,
            Field: "group",
            Value: "AWS-Lambda-Requests",
          },
        ],
        MaxResults: 1,
      }),
    ),
  ]);

  const durationItem = JSON.parse(durationResponse.PriceList![0] as string);
  const invocationItem = JSON.parse(invocationResponse.PriceList![0] as string);

  const durationDimensions = Object.values(
    Object.values(durationItem.terms.OnDemand as Record<string, any>)[0]
      .priceDimensions as Record<string, any>,
  ) as any[];

  const tier1 = durationDimensions.find((d: any) => d.beginRange === "0");

  const invocationDimensions = Object.values(
    Object.values(invocationItem.terms.OnDemand as Record<string, any>)[0]
      .priceDimensions as Record<string, any>,
  ) as any[];

  return {
    lambda: {
      gbSecondPrice: parseFloat(tier1.pricePerUnit.USD),
      invocationPrice: parseFloat(invocationDimensions[0].pricePerUnit.USD),
    },
  };
}

async function fetchFargateComputePrice(
  region: string,
): Promise<Pick<ComputeCosts, "fargate">> {
  const client = new PricingClient({ region: "us-east-1" });

  const regionPrefix = regionPrefixMap[region];

  const [vcpuResponse, memResponse] = await Promise.all([
    client.send(
      new GetProductsCommand({
        ServiceCode: "AmazonECS",
        Filters: [
          { Type: FilterType.TERM_MATCH, Field: "regionCode", Value: region },
          {
            Type: FilterType.TERM_MATCH,
            Field: "usagetype",
            Value: `${regionPrefix}-Fargate-vCPU-Hours:perCPU`,
          },
        ],
        MaxResults: 1,
      }),
    ),
    client.send(
      new GetProductsCommand({
        ServiceCode: "AmazonECS",
        Filters: [
          { Type: FilterType.TERM_MATCH, Field: "regionCode", Value: region },
          {
            Type: FilterType.TERM_MATCH,
            Field: "usagetype",
            Value: `${regionPrefix}-Fargate-GB-Hours`,
          },
        ],
        MaxResults: 1,
      }),
    ),
  ]);

  const vcpuItem = JSON.parse(vcpuResponse.PriceList![0] as string);
  const memItem = JSON.parse(memResponse.PriceList![0] as string);

  const vcpuPrice = parseFloat(
    Object.values(
      Object.values(vcpuItem.terms.OnDemand as Record<string, any>)[0]
        .priceDimensions as Record<string, any>,
    )[0].pricePerUnit.USD,
  );

  const memPrice = parseFloat(
    Object.values(
      Object.values(memItem.terms.OnDemand as Record<string, any>)[0]
        .priceDimensions as Record<string, any>,
    )[0].pricePerUnit.USD,
  );

  return {
    fargate: {
      vCpuPricePerHour: vcpuPrice,
      memoryGbPricePerHour: memPrice,
    },
  };
}

export async function fetchComputeCosts(region: string): Promise<ComputeCosts> {
  const [lambda, fargate] = await Promise.all([
    fetchLambdaComputePrice(region),
    fetchFargateComputePrice(region),
  ]);

  return {
    ...lambda,
    ...fargate,
  };
}

function estimateComputeCostLambda(
  memoryMb: number,
  sizeBytes: number,
  computeCosts: ComputeCosts,
  overheadSeconds: number = DEFAULT_LAMBDA_OVERHEAD_SEC,
  assumedCopySpeedMiBps: number = DEFAULT_COPY_SPEED_MIBPS,
): number {
  const transferSeconds = defaultCopyDurationSeconds(
    sizeBytes,
    assumedCopySpeedMiBps,
  );
  const totalSeconds = transferSeconds + overheadSeconds;
  const gbSeconds = (memoryMb / 1024) * totalSeconds;
  return (
    gbSeconds * computeCosts.lambda.gbSecondPrice +
    computeCosts.lambda.invocationPrice
  );
}

function estimateComputeCostFargate(
  cpuVcpu: number,
  memGb: number,
  sizeBytes: number,
  computeCosts: ComputeCosts,
  overheadSeconds: number = DEFAULT_FARGATE_OVERHEAD_SEC,
  assumedCopySpeedMiBps: number = DEFAULT_COPY_SPEED_MIBPS,
): number {
  const transferSeconds = defaultCopyDurationSeconds(
    sizeBytes,
    assumedCopySpeedMiBps,
  );
  const totalSeconds = transferSeconds + overheadSeconds;
  const billedSeconds = Math.max(totalSeconds, FARGATE_MIN_BILLING_SECONDS);
  const hourFraction = billedSeconds / 3600;
  const cpuCost =
    cpuVcpu * computeCosts.fargate.vCpuPricePerHour * hourFraction;
  const memCost =
    memGb * computeCosts.fargate.memoryGbPricePerHour * hourFraction;
  return cpuCost + memCost;
}

export function estimateComputeCost(
  sizeBytes: number,
  computeCosts: ComputeCosts,
): number {
  if (sizeBytes <= SIZE_THRESHOLD_BYTES) {
    return estimateComputeCostLambda(LAMBDA_MEMORY_MB, sizeBytes, computeCosts);
  } else {
    return estimateComputeCostFargate(
      FARGATE_CPU_VCPU,
      FARGATE_MEMORY_MB / 1024,
      sizeBytes,
      computeCosts,
    );
  }
}

// --------------------------------------------------------------------------------------------
// Read cost data
// --------------------------------------------------------------------------------------------

/**
 * Read JSON from S3 and return PricingData dictionary.
 */
export async function readPricingDataJsonFromS3(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<PricingData> {
  const obj = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  const body = await obj.Body?.transformToString?.();
  if (!body) throw new Error("No pricing data returned from S3!");
  return JSON.parse(body) as PricingData;
}
