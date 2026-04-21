import {
  fetchColdStorageRetrievalCosts,
  fetchCrossRegionCosts,
  fetchComputeCosts,
} from "../common/cost-estimation";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

interface PricingDataLambdaInvokeEvent {
  invokeArguments: {
    sourceRequiredRegion: string;
  };
  invokeSettings: {
    workingBucket: string;
    workingBucketPrefixKey: string;
  };
}

export const handler = async (event: PricingDataLambdaInvokeEvent) => {
  const { invokeArguments, invokeSettings } = event;
  const { sourceRequiredRegion } = invokeArguments;
  const { workingBucket, workingBucketPrefixKey } = invokeSettings;

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

  const pricingDataObjectKey = workingBucketPrefixKey
    ? `${workingBucketPrefixKey.replace(/\/+$/, "")}/pricing-data.json`
    : "pricing-data.json";

  const s3 = new S3Client({});
  await s3.send(
    new PutObjectCommand({
      Bucket: workingBucket,
      Key: pricingDataObjectKey,
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
    bucket: workingBucket,
    key: pricingDataObjectKey,
    summary: {
      fetched: Object.keys(pricingData),
    },
  };
};
