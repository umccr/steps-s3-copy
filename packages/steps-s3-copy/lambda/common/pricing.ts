import {
  PricingClient,
  GetProductsCommand,
  FilterType,
} from "@aws-sdk/client-pricing";
import { bytesToGB } from "./constants.ts";

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
  ColdStorageRetrievalCosts: ColdStorageRetrievalCosts,
): number {
  if (!isColdStorage) return 0;

  const tierCosts = (
    ColdStorageRetrievalCosts[
      storageClass as keyof ColdStorageRetrievalCosts
    ] as Record<string, TierCost>
  )?.[retrievalSpeed];
  if (!tierCosts) return 0;

  const sizeGB = bytesToGB(sizeBytes);

  return (
    sizeGB * tierCosts.perGB +
    tierCosts.perRequest +
    sizeGB *
      ColdStorageRetrievalCosts.tempStoragePerGBPerMonth *
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

export function estimateCrossRegionCost(
  iscrossRegion: boolean,
  crossRegionCosts: CrossRegionCosts,
  sizeBytes: number,
): number {
  if (!iscrossRegion) return 0;

  const totalGb = sizeBytes / 1024 / 1024 / 1024;
  const tier = crossRegionCosts.egressPriceTiers.find(
    (t) => totalGb >= t.beginRangeGb && totalGb < t.endRangeGb,
  );
  const egressCostUsd = (tier?.pricePerGbUsd ?? 0) * totalGb;
  const putCostUsd = crossRegionCosts.putPricePerRequest; // 1 PUT request
  return egressCostUsd + putCostUsd;
}

// Cross Region S3 read/write cost estimation (returns 0 for same-region copies, or if size is 0)
