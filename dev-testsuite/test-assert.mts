import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { TestObject } from "./test-util.mjs";

const s3Client = new S3Client({});

export async function assertDestinations(
  uniqueTestId: string,
  destinationBucket: string,
  objects: Record<string, TestObject>,
) {
  for (const [n, to] of Object.entries(objects)) {
    const h = await s3Client.send(
      new HeadObjectCommand({
        Bucket: destinationBucket,
        Key: `${uniqueTestId}/${n}`,
      }),
    );

    console.log(h.ETag);
    console.log(to.expectedAwsChecksums);
  }
}
