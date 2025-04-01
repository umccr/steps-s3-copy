import {
  AbortMultipartUploadCommand,
  ChecksumAlgorithm,
  CompleteMultipartUploadCommand,
  CopyPartResult,
  CreateMultipartUploadCommand,
  PutObjectCommand,
  S3Client,
  StorageClass,
  CompletedPart,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import pLimit from "p-limit";
import { BufferSplit } from "./buffer-split.mjs";
import { createRandomBuffer } from "./create-random-buffer.mjs";
import { MiB } from "./suffixes.js";
import { CrtCrc64Nvme } from "@aws-sdk/crc64-nvme-crt";

/**
 * The test object params are a template for fields that
 * can be passed to create a test object.
 */
export type TestObjectParams = {
  sizeInBytes: number;
  partSizeInBytes?: number;
  storageClass?: StorageClass;
};

/**
 * The test object encompasses an object we are going to create
 * in a bucket - for the purposes of test copying it to another bucket!
 */
export type TestObject = {
  // the bucket where the object was created
  sourceBucket: string;

  // the key of the object
  sourceKey: string;

  // information about how the object was split into parts (if multi-part uploaded)
  bufferSplit: BufferSplit;

  // checksums calculated locally for the test object
  // expectedAwsChecksums: Checksums;
};

/**
 * Creates an AWS S3 object for test copying purposes.
 *
 * @param bucket the bucket to place the object in
 * @param key the key of the object
 * @param sizeInBytes the size in bytes of the object
 * @param contentSeed a single numeric seed that will define the random content
 * @param partSizeInBytes a size in bytes to specify a multipart upload, or undefined to mean create as a single upload
 * @param storageClass the storage class to assign to the object
 */
export async function createTestObject(
  bucket: string,
  key: string,
  sizeInBytes: number,
  contentSeed: number,
  partSizeInBytes?: number,
  storageClass?: StorageClass,
): Promise<TestObject> {
  const buffer = createRandomBuffer(sizeInBytes, contentSeed);

  // TODO: the latest SDK has *enforced* the use of checksums - causing our existing code to fail
  // so I've patched in the use of NVME 64 and taken out the ability to change checksums
  // we need to rethink all of this

  /*const checksum32 = checksums.crc32(buffer);
  const checksum32Buffer = Buffer.alloc(4);
  checksum32Buffer.writeUInt32BE(checksum32, 0);
  const checksumCrc32 = checksum32Buffer.toString("base64");

  const checksum32c = checksums.crc32c(buffer);
  const checksum32cBuffer = Buffer.alloc(4);
  checksum32cBuffer.writeUInt32BE(checksum32c, 0);
  const checksumCrc32c = checksum32cBuffer.toString("base64"); */

  const checksum64 = new CrtCrc64Nvme();
  checksum64.update(buffer);
  const checksum64Buffer = Buffer.from(await checksum64.digest());
  const checksumCrc64 = checksum64Buffer.toString("base64");

  const bufferSplit = new BufferSplit(buffer, partSizeInBytes);

  if (bufferSplit.isSinglePart) {
    await singlePartUpload(
      bucket,
      key,
      bufferSplit,
      checksumCrc64,
      storageClass,
    );
  } else {
    await multiPartUpload(
      bucket,
      key,
      bufferSplit,
      checksumCrc64,
      storageClass,
    );
  }

  return {
    sourceBucket: bucket,
    sourceKey: key,
    bufferSplit: bufferSplit,
    // expectedAwsChecksums: hashes.aws,
  };
}

async function singlePartUpload(
  bucket: string,
  key: string,
  bufferSplit: BufferSplit,
  nvme: string,
  storageClass?: StorageClass,
) {
  const s3Client = new S3Client({});

  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: bufferSplit.buffer,
      ChecksumAlgorithm: "CRC64NVME",
      ChecksumCRC64NVME: nvme,
      StorageClass: storageClass,
    }),
  );
}

async function multiPartUpload(
  bucket: string,
  key: string,
  bufferSplit: BufferSplit,
  nvme: string,
  storageClass?: StorageClass,
) {
  const s3Client = new S3Client({});

  if (bufferSplit.partSize < 5 * MiB)
    throw new Error("Part size must be >= 5MiB");

  let uploadId;

  try {
    const multipartUpload = await s3Client.send(
      new CreateMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        ChecksumAlgorithm: "CRC64NVME",
        ChecksumType: "FULL_OBJECT",
        StorageClass: storageClass,
      }),
    );

    // console.log(bufferSplit);

    const uploadId: string = multipartUpload.UploadId!;

    const uploadPromises = [];

    const limit = pLimit(4);

    // Upload each part.
    for (let part = 1; part <= bufferSplit.partCount; part++) {
      let partStart = (part - 1) * bufferSplit.partSize;
      let partActualSize =
        part === bufferSplit.partCount
          ? bufferSplit.partLast
          : bufferSplit.partSize;

      // hack for making a single test sample with uneven parts
      /*if (key.includes("uneven")) {
        if (part == 2) {
          // make part 2 one byte shorter
          partActualSize = partActualSize - 1;
        } else if (part == 3) {
          // make part 3 one byte larger and start where 2 ended
          partStart = partStart - 1;
          partActualSize = partActualSize + 1;
        }
      } */

      const partBuffer = bufferSplit.buffer.subarray(
        partStart,
        partStart + partActualSize,
      );

      const partActualNumber = /*key.includes("skip")
        ? part > 3
          ? part + 10
          : part
        :*/ part;

      uploadPromises.push(
        limit(() =>
          s3Client
            .send(
              new UploadPartCommand({
                Bucket: bucket,
                Key: key,
                UploadId: uploadId,
                ChecksumAlgorithm: "CRC64NVME",
                Body: partBuffer,
                PartNumber: partActualNumber,
              }),
            )
            .then((d) => {
              // console.log(`Finished part ${typeof partActualNumber}`);

              // only one of these Checksums can be present in the data returned
              // from UploadPart, but we copy them all
              return {
                ETag: d.ETag,
                ChecksumCRC64NVME: d.ChecksumCRC64NVME,
                ChecksumCRC32: d.ChecksumCRC32,
                ChecksumCRC32C: d.ChecksumCRC32C,
                ChecksumSHA1: d.ChecksumSHA1,
                ChecksumSHA256: d.ChecksumSHA256,
                PartNumber: partActualNumber,
              } satisfies CompletedPart;
            }),
        ),
      );
    }

    const uploadResults = await Promise.all(uploadPromises);

    // console.log(uploadResults);

    return await s3Client.send(
      new CompleteMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        ChecksumType: "FULL_OBJECT",
        ChecksumCRC64NVME: nvme,
        MultipartUpload: {
          Parts: uploadResults,
        },
      }),
    );
  } catch (err) {
    try {
      if (uploadId) {
        const abortCommand = new AbortMultipartUploadCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
        });

        await s3Client.send(abortCommand);
      }
    } catch (err2) {
      // console.error(err2);
      // our test buckets should have expiry on incomplete multipart uploads
      // anyhow so not too much stress if this leaves behind an incomplete
    }

    console.error(err);

    throw err;
  }
}
