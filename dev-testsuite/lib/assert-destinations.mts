import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { TestObject } from "../test-util.mjs";

const s3Client = new S3Client({});

export async function assertDestinations(
  uniqueTestId: string,
  destinationBucket: string,
  objects: Record<string, TestObject>,
) {
  const results: Record<string, string> = {};

  for (const [n, to] of Object.entries(objects)) {
    try {
      const h = await s3Client.send(
        new HeadObjectCommand({
          Bucket: destinationBucket,
          Key: `${uniqueTestId}/${n}`,
        }),
      );

      results[n] = `${h.ETag} should equal one of ${JSON.stringify(
        to.expectedAwsChecksums,
      )}`;
    } catch (e: any) {
      results[n] = `errored with "${e.message}"`;
    }
  }

  return results;
}
