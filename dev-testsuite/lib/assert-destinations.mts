import {
  HeadObjectCommand,
  HeadObjectCommandOutput,
  S3Client,
} from "@aws-sdk/client-s3";
import assert, { fail } from "node:assert";
import { TestObject } from "./create-test-object.js";

export async function assertDestinations(
  uniqueTestId: string,
  destinationBucket: string,
  objects: Record<string, TestObject>,
) {
  const s3Client = new S3Client({});

  for (const [n, to] of Object.entries(objects)) {
    try {
      const h = await s3Client.send(
        new HeadObjectCommand({
          Bucket: destinationBucket,
          Key: `${uniqueTestId}/${n}`,
        }),
      );

      assert(
        h.ContentLength == to.bufferSplit.buffer.length,
        `Copied object differed in size - ${n} was ${h.ContentLength} expecting ${to.bufferSplit.buffer.length}`,
      );

      // TODO: should assert content equality
    } catch (e: any) {
      fail(e.message);
    }
  }
}

export async function assertCopiedObject(
  destinationBucket: string,
  destinationKey: string,
  expectedSize: number,
) {
  const s3Client = new S3Client({});

  let h: HeadObjectCommandOutput;

  try {
    h = await s3Client.send(
      new HeadObjectCommand({
        Bucket: destinationBucket,
        Key: destinationKey,
      }),
    );
  } catch (e: any) {
    fail(`Missing copied object s3://${destinationBucket}/${destinationKey}`);
  }

  assert(
    h.ContentLength == expectedSize,
    `Copied object differed in size - s3://${destinationBucket}/${destinationKey} was ${h.ContentLength} but we expected ${expectedSize}`,
  );
}
