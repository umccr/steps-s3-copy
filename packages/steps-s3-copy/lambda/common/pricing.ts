import {
  PricingClient,
  GetProductsCommand,
  FilterType,
} from "@aws-sdk/client-pricing";
import { bytesToGB } from "./constants.ts";

// Thawing cost estimation (returns 0 for non-cold storage classes)

type TierCost = { perGB: number; perRequest: number };

export type ThawingCosts = {
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

/**
 * Fetch Glacier/Deep Archive retrieval costs from AWS Pricing API and build a thawingCosts-style dictionary.
 * @param region AWS region string (e.g. "ap-southeast-2")
 * @returns Promise<Record<string, Record<string, number>>>
 */

export async function fetchThawingCosts(region: string): Promise<ThawingCosts> {
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
  thawingCosts: ThawingCosts,
): number {
  if (!isColdStorage) return 0;

  const tierCosts = (
    thawingCosts[storageClass as keyof ThawingCosts] as Record<string, TierCost>
  )?.[retrievalSpeed];
  if (!tierCosts) return 0;

  const sizeGB = bytesToGB(sizeBytes);

  return (
    sizeGB * tierCosts.perGB +
    tierCosts.perRequest +
    sizeGB * thawingCosts.tempStoragePerGBPerMonth * (restoreWindowDays / 30)
  );
}

// Cross Region S3 read/write cost estimation (returns 0 for same-region copies, or if size is 0)

/**
 * Fetch S3 cross-region egress price (AUD per GB) from AWS Pricing API.
 * @param fromRegion AWS region string (e.g. "ap-southeast-2")
 * @returns price in AUD per GB, or 0 if not found
 */
export async function fetchS3CrossRegionEgressPrice(
  fromRegion: string,
): Promise<number> {
  const client = new PricingClient({ region: "us-east-1" });
  const params = {
    ServiceCode: "AmazonS3",
    Filters: [
      { Type: FilterType.TERM_MATCH, Field: "location", Value: fromRegion },
      {
        Type: FilterType.TERM_MATCH,
        Field: "usagetype",
        Value: "DataTransfer-Out-Bytes",
      },
      { Type: FilterType.TERM_MATCH, Field: "currencyCode", Value: "AUD" },
    ],
    MaxResults: 1,
  };
  const command = new GetProductsCommand(params);
  const response = await client.send(command);

  if (response.PriceList && response.PriceList.length > 0) {
    const priceItem = JSON.parse(response.PriceList[0]);
    const terms = priceItem.terms?.OnDemand || {};
    for (const termKey of Object.keys(terms)) {
      const priceDimensions = terms[termKey].priceDimensions || {};
      for (const dimKey of Object.keys(priceDimensions)) {
        const pricePerUnit = priceDimensions[dimKey].pricePerUnit;
        if (pricePerUnit && pricePerUnit.AUD) {
          return parseFloat(pricePerUnit.AUD);
        }
      }
    }
  }
  return 0;
}

export function estimateS3CrossRegionReadWriteCost(
  sizeBytes: number,
  isCrossRegion: boolean,
  perGbPriceAud: number,
): number {
  return isCrossRegion ? bytesToGB(sizeBytes) * perGbPriceAud : 0;
}
