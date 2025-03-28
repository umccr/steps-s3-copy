import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyPartResult,
  CreateMultipartUploadCommand,
  PutObjectCommand,
  S3Client,
  StorageClass,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { createRandomBuffer } from "./lib/create-random-buffer.mjs";
import { calcMultipleHashes, Checksums } from "./calc-multiple-hashes.mjs";
import { ChecksumAlgorithm } from "@aws-sdk/client-s3";
import { BufferSplit } from "./lib/buffer-split.mjs";
import pLimit from "p-limit";

const s3Client = new S3Client({
  // requestHandler: {
  //    requestTimeout: 3_000,
  //    httpsAgent: { maxSockets: 5 },
  // },
});

export const GiB = 1024 * 1024 * 1024;
export const MiB = 1024 * 1024;
export const KiB = 1024;

/**
 * The test object encompasses an object we are going to create
 * in a sourceBucket and then copy.
 */
export type TestObject = {
  sourceBucket: string;
  sourceKey: string;

  bufferSplit: BufferSplit;

  expectedAwsChecksums: Checksums;
};

export function getPaths(
  sourceBucket: string,
  workingBucket: string,
  workingPrefix: string,
  destinationBucket: string,
  uniqueTestFolder: string,
) {
  const tsvName = `objects-to-copy.tsv`;

  return {
    // because this must exist in the working folder - we need it
    // both as a relative path (how we will refer to it within the steps)
    // and an absolute path (for use outside our steps)
    testFolderObjectsTsvRelative: `${uniqueTestFolder}/${tsvName}`,
    testFolderObjectsTsvAbsolute: `${workingPrefix}${uniqueTestFolder}/${tsvName}`,

    testFolderSrc: uniqueTestFolder === "" ? "" : `${uniqueTestFolder}/`,
    testFolderDest: uniqueTestFolder === "" ? "" : `${uniqueTestFolder}/`,
  };
}

/**
 * Put a dictionary of objects as a two column CSV into an S3 object.
 *
 * @param csvBucket
 * @param csvAbsoluteKey the sourceKey of the CSV in the working folder
 * @param objects a dictionary of buckets->sourceKey[]
 */
export async function makeObjectDictionaryCsv(
  csvBucket: string,
  csvAbsoluteKey: string,
  objects: Record<string, string[]>,
) {
  let content = "";

  // for each sourceBucket
  for (const b of Object.keys(objects)) {
    // for each sourceKey
    for (const k of objects[b]) content += `${b},"${k}"\n`;
  }

  // now save the CSV to S3
  const response = await s3Client.send(
    new PutObjectCommand({
      Bucket: csvBucket,
      Key: csvAbsoluteKey,
      Body: content,
    }),
  );
}

/**
 * Makes an S3 object of a certain size and storage class - and
 * filled with basically blank data
 *
 * @param bucket the sourceBucket of the object
 * @param key the sourceKey of the object
 * @param sizeInBytes the size in bytes of the object to make
 * @param storageClass the storage class for the object, defaults to STANDARD
 * @param forceContentByte force a content byte if the default needs to be overridden
 * @returns the byte value that is the content of the created file
 */
export async function makeTestObject(
  bucket: string,
  key: string,
  sizeInBytes: number,
  storageClass: StorageClass = "STANDARD",
  forceContentByte: number | undefined = undefined,
) {
  const contentByte =
    forceContentByte === undefined ? sizeInBytes % 256 : forceContentByte;

  const response = await s3Client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      // so rather than make every file filled with 0s - we fill
      // with a value that depends on the size... no particular
      // point other than we can I guess assert content has been
      // successfully copied by looking at the destination content after copy
      Body: Buffer.alloc(sizeInBytes, contentByte),
      StorageClass: storageClass,
    }),
  );
  return contentByte;
}

/**
 * Creates an AWS S3 object for test copying purposes.
 *
 * @param bucket the sourceBucket to place the object in
 * @param key the sourceKey of the object
 * @param sizeInBytes the size in bytes of the object
 * @param contentSeed a single numeric seed that will define the random content
 * @param independentTotalMd5 an MD5 previously derived from this content through an independent check
 * @param storageClass
 * @param partSizeInBytes a size in bytes to specify a multipart upload, or undefined to mean create as a single upload
 * @param checksumAlgorithm the checksum algorithm we ask S3 to tag the object with on creation
 */
export async function createTestObject(
  bucket: string,
  key: string,
  sizeInBytes: number,
  contentSeed: number,
  independentTotalMd5: string,
  partSizeInBytes?: number,
  checksumAlgorithm?: ChecksumAlgorithm,
  storageClass?: StorageClass,
): Promise<TestObject> {
  const buffer = createRandomBuffer(sizeInBytes, contentSeed);

  const bufferSplit = new BufferSplit(buffer, partSizeInBytes);

  const hashes = calcMultipleHashes(bufferSplit);

  if (bufferSplit.isSinglePart) {
    const sing = await singlePartUpload(
      bucket,
      key,
      bufferSplit,
      checksumAlgorithm,
      storageClass,
    );
  } else {
    const multi = await multiPartUpload(
      bucket,
      key,
      bufferSplit,
      checksumAlgorithm,
      storageClass,
    );
  }

  return {
    sourceBucket: bucket,
    sourceKey: key,
    bufferSplit: bufferSplit,
    expectedAwsChecksums: hashes.aws,
  };
}

async function singlePartUpload(
  bucket: string,
  key: string,
  bufferSplit: BufferSplit,
  checksumAlgorithm?: ChecksumAlgorithm,
  storageClass?: StorageClass,
) {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: bufferSplit.buffer,
      ChecksumAlgorithm: checksumAlgorithm,
      StorageClass: storageClass,
    }),
  );
}

async function multiPartUpload(
  bucket: string,
  key: string,
  bufferSplit: BufferSplit,
  checksumAlgorithm?: ChecksumAlgorithm,
  storageClass?: StorageClass,
) {
  if (bufferSplit.partSize < 5 * MiB)
    throw new Error("Part size must be >= 5MiB");

  let uploadId;

  try {
    const multipartUpload = await s3Client.send(
      new CreateMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        ChecksumAlgorithm: checksumAlgorithm,
        StorageClass: storageClass,
      }),
    );

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
      if (key.includes("uneven")) {
        if (part == 2) {
          // make part 2 one byte shorter
          partActualSize = partActualSize - 1;
        } else if (part == 3) {
          // make part 3 one byte larger and start where 2 ended
          partStart = partStart - 1;
          partActualSize = partActualSize + 1;
        }
      }

      const partBuffer = bufferSplit.buffer.subarray(
        partStart,
        partStart + partActualSize,
      );

      const partActualNumber = key.includes("skip")
        ? part > 3
          ? part + 10
          : part
        : part;

      uploadPromises.push(
        limit(() =>
          s3Client
            .send(
              new UploadPartCommand({
                Bucket: bucket,
                Key: key,
                UploadId: uploadId,
                Body: partBuffer,
                PartNumber: partActualNumber,
                ChecksumAlgorithm: checksumAlgorithm,
              }),
            )
            .then((d) => {
              // console.log(`Finished part ${partActualNumber}`);

              // only one of these Checksums can be present in the data returned
              // from UploadPart, but we copy them all
              return {
                ETag: d.ETag,
                ChecksumCRC32: d.ChecksumCRC32,
                ChecksumCRC32C: d.ChecksumCRC32C,
                ChecksumSHA1: d.ChecksumSHA1,
                ChecksumSHA256: d.ChecksumSHA256,
                PartNumber: partActualNumber,
              } as CopyPartResult;
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
      // our test buckets should have expiry on incomplete multipart uploads
      // anyhow so not too much stress if this leaves behind an incomplete
    }

    throw err;
  }
}

/*
(async () => {
  const sourceBucket = "steps-s3-copy-testing";

  const empty = makeBlob(0, 0);

  const tiny = makeBlob(6, 0);

  console.log(calcPartDetails(tiny, 1));
  console.log(calcPartDetails(tiny, 2));
  console.log(calcPartDetails(tiny, 3));
  console.log(calcPartDetails(tiny, 4));
  console.log(calcPartDetails(tiny, 5));
  console.log(calcPartDetails(tiny, 6));
  console.log(calcPartDetails(tiny, 7));
  console.log(calcPartDetails(tiny, 8));

  const small = makeBlob(64, 6);

  calcHashes(small, 5 * 1024 * 1024);

  await multiPartUpload(sourceBucket, "small.bin", small, 5*1024*1024);


  // make a "large" blob that is multiple 5 MiB parts AND is an uneven number of bytes (there may be edge cases
  // for objects not multiples of 2)
  const large = makeBlob(19 * 1024 * 1024 + 223, 8);
  calcHashes(large, 6 * 1024 * 1024);


  await multiPartUpload(sourceBucket, "large.bin", large, 6*1024*1024);

  const r = await s3Client.send(new GetObjectAttributesCommand({
    Bucket: sourceBucket,
    Key: "large.bin",
    ObjectAttributes: [
      "ETag", "Checksum", "ObjectParts", "ObjectSize", "StorageClass"
    ]
  }));
  console.log(JSON.stringify(r, null, 2));


})();
*/
