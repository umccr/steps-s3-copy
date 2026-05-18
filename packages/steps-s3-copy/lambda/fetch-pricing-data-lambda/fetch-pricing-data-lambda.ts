import {
  fetchColdStorageRetrievalCosts,
  fetchCrossRegionCosts,
  fetchComputeCosts,
} from "../common/cost-estimation";
import type { StepsS3CopyInvokeArguments } from "../../src/steps-s3-copy-input";
import { PRICING_DATA_FILENAME } from "../common/constants";

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

interface InvokeEvent {
  invokeArguments: StepsS3CopyInvokeArguments;
  invokeSettings: {
    workingBucket: string;
    workingBucketPrefix: string;
  };
}

export const handler = async (event: InvokeEvent) => {
  // Validate input
  const sourceRequiredRegion = event.invokeArguments.sourceRequiredRegion;
  if (!sourceRequiredRegion) {
    throw new Error("sourceRequiredRegion must be defined");
  }

  // Fetch pricing data
  const coldStorageCosts =
    await fetchColdStorageRetrievalCosts(sourceRequiredRegion);
  const crossRegionCosts = await fetchCrossRegionCosts(sourceRequiredRegion);
  const computeCosts = await fetchComputeCosts(sourceRequiredRegion);

  const pricingData = {
    coldStorageCosts,
    crossRegionCosts,
    computeCosts,
    fetchedAt: new Date().toISOString(),
  };

  const sourceFilePrefix =
    event.invokeSettings.workingBucketPrefix +
    event.invokeArguments.instructionsPrefix;

  const pricingDataKey = sourceFilePrefix + PRICING_DATA_FILENAME;

  const s3 = new S3Client({});
  await s3.send(
    new PutObjectCommand({
      Bucket: event.invokeSettings.workingBucket,
      Key: pricingDataKey,
      Body: JSON.stringify(
        pricingData,
        (key, value) =>
          typeof value === "number" && !isFinite(value) ? "Infinity" : value,
        2,
      ),
      ContentType: "application/json",
    }),
  );

  return {
    status: "Success",
    bucket: event.invokeSettings.workingBucket,
    key: pricingDataKey,
    summary: {
      fetched: Object.keys(pricingData),
    },
  };
};
