import {
  HeadObjectCommand,
  type HeadObjectCommandOutput,
  S3Client,
} from "@aws-sdk/client-s3";
import assert, { fail } from "node:assert";
import {
  type TestObject,
  type TestObjectParams,
} from "./create-test-object.js";
import { basename } from "node:path";

export async function assertDestinations(
  destinationBucket: string,
  destinationFolderKey: string,
  sourceObjects: Record<string, TestObjectParams>,
  testObjects: Record<string, TestObject>,
) {
  const s3Client = new S3Client({});

  for (const [n, to] of Object.entries(sourceObjects)) {
    let h: HeadObjectCommandOutput;
    const destKey = to.overrideExpectedDestinationRelativeKey
      ? `${destinationFolderKey}${to.overrideExpectedDestinationRelativeKey}`
      : `${destinationFolderKey}${basename(n)}`;

    try {
      h = await s3Client.send(
        new HeadObjectCommand({
          Bucket: destinationBucket,
          Key: destKey,
        }),
      );
    } catch (e: any) {
      fail(`Missing copied object s3://${destinationBucket}/${destKey}`);
    }

    // TODO: should assert content equality
    assert(
      h.ContentLength == to.sizeInBytes,
      `Copied object differed in size - s3://${destinationBucket}/${destKey} was ${h.ContentLength} but we expected ${to.sizeInBytes}`,
    );

    console.info(
      `✅ Copied ${to.sizeInBytes} byte object to s3://<working>/${destKey}` +
        (to.storageClass ? ` from storage class ${to.storageClass}` : ""),
    );
  }
}

/**
 * Make an assertion that an object has been correctly copied.
 *
 * @param destinationBucket
 * @param destinationKey
 * @param expectedSize
 */
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

  console.info(
    `✅ Copied ${expectedSize} byte object to s3://<working>/${destinationKey}`,
  );
}
