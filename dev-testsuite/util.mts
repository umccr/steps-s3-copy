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
import { calcMultipleHashes, Checksums } from "./lib/calc-multiple-hashes.mjs";
import { ChecksumAlgorithm } from "@aws-sdk/client-s3";
import { BufferSplit } from "./lib/buffer-split.mjs";
import pLimit from "p-limit";

const s3Client = new S3Client({
  // requestHandler: {
  //    requestTimeout: 3_000,
  //    httpsAgent: { maxSockets: 5 },
  // },
});

export function getPaths(workingPrefix: string, uniqueTestFolder: string) {
  const tsvName = `objects-to-copy.tsv`;

  return {
    // because this must exist in the working folder - we need it
    // both as a relative path (how we will refer to it _within_ the steps)
    // and an absolute path (for use _outside_ our steps)
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
 * Put a dictionary of objects (from makeTestObjects) as a JSONL source
 * list for the copier.
 *
 * @param objects a dictionary of buckets->key[] that form the "source" objects we want to copy
 * @param bucket bucket where to save the JSONL source list
 * @param key key where to save the JSONL source list
 */
export async function makeObjectDictionaryJsonl(
  objects: Record<string, string[]>,
  bucket: string,
  key: string,
) {
  let content = "";

  // for each bucket of sources
  for (const b of Object.keys(objects)) {
    // for each key
    for (const k of objects[b]) {
      const jsonLine = JSON.stringify(
        {
          sourceBucket: b,
          sourceKey: k,
        },
        null,
        0,
      );
      content += `${jsonLine}\n`;
    }
  }

  // now save the JSONL to S3
  const response = await s3Client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: content,
    }),
  );
}

export async function makeInstructionsJsonl(
  instructions: any[],
  bucket: string,
  key: string,
) {
  let content = "";

  for (const i of instructions) {
    const jsonLine = JSON.stringify(i, null, 0);
    content += `${jsonLine}\n`;
  }

  // now save the JSONL to S3
  const response = await s3Client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
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
