import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const s3Client = new S3Client({
  // requestHandler: {
  //    requestTimeout: 3_000,
  //    httpsAgent: { maxSockets: 5 },
  // },
});

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
    if (!objects[b]) continue;

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

/**
 * Take an array of instruction objects, and convert them to JSONL
 * and upload the JSONL to a bucket.
 *
 * @param instructions
 * @param bucket
 * @param key
 */
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
