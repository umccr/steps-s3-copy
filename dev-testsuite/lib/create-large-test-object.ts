import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  S3Client,
  UploadPartCopyCommand,
  type CompletedPart,
} from "@aws-sdk/client-s3";
import pLimit from "p-limit";
import { createTestObject } from "./create-test-object.js";
import { MiB } from "./suffixes.js";

// the size of the single real object that every part of the large object is copied from
const SOURCE_PART_SIZE = 64 * MiB;

/**
 * Creates a (potentially very big) object of an exact size in S3 without building it
 * in memory or uploading it from this machine.
 *
 * A single real part object is uploaded, then a multipart upload is built entirely
 * server side by copying that part (UploadPartCopy) over and over. The content of the
 * result is therefore repeated data - fine for testing copies and sizes, but not
 * for testing content differences.
 *
 * @param bucket the bucket to create the object in
 * @param key the key of the object to create
 * @param sizeInBytes the exact size in bytes of the object
 * @param helperKey a key (in the same bucket) where the helper part object is stored
 */
export async function createLargeTestObject(
  bucket: string,
  key: string,
  sizeInBytes: number,
  helperKey: string,
): Promise<void> {
  const s3Client = new S3Client({});

  const fullParts = Math.floor(sizeInBytes / SOURCE_PART_SIZE);
  const lastPartSize = sizeInBytes - fullParts * SOURCE_PART_SIZE;
  const partCount = fullParts + (lastPartSize > 0 ? 1 : 0);

  if (partCount > 10000)
    throw new Error(
      `${sizeInBytes} bytes would need ${partCount} parts, but S3 allows at most 10000`,
    );

  // the real part we copy from (it is also big enough to be the source of any part size we need)
  await createTestObject(bucket, helperKey, SOURCE_PART_SIZE, 0);

  const copySource = encodeURI(`${bucket}/${helperKey}`);

  const upload = await s3Client.send(
    new CreateMultipartUploadCommand({ Bucket: bucket, Key: key }),
  );

  const uploadId = upload.UploadId!;

  try {
    const limit = pLimit(8);

    const parts = await Promise.all(
      Array.from({ length: partCount }, (_, i) => {
        const partNumber = i + 1;
        const thisPartSize =
          partNumber <= fullParts ? SOURCE_PART_SIZE : lastPartSize;

        return limit(async () => {
          const r = await s3Client.send(
            new UploadPartCopyCommand({
              Bucket: bucket,
              Key: key,
              UploadId: uploadId,
              PartNumber: partNumber,
              CopySource: copySource,
              CopySourceRange: `bytes=0-${thisPartSize - 1}`,
            }),
          );

          return {
            ETag: r.CopyPartResult?.ETag,
            PartNumber: partNumber,
          } satisfies CompletedPart;
        });
      }),
    );

    await s3Client.send(
      new CompleteMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: parts },
      }),
    );
  } catch (e) {
    // our test buckets expire incomplete multipart uploads anyhow, so a failure here is not a concern
    await s3Client
      .send(
        new AbortMultipartUploadCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
        }),
      )
      .catch(() => {});

    throw e;
  }
}
