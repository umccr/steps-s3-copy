import {
  HeadObjectCommand,
  paginateListObjectsV2,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import {
  SourceBucketFieldInvalid,
  SourceKeyFieldInvalid,
  WildcardExpansionEmptyError,
  WildcardExpansionMaximumError,
} from "./errors";
import type { HeadInputType, HeadResultType } from "../common/head-result-type";

interface HeadObjectsEvent {
  Items: HeadInputType[];
}

/**
 * A function to check for the existence of all objects and output
 * the "HEAD" details of each object. Will expand keys with trailing
 * wildcards.
 *
 * @param event
 */
export async function handler(event: HeadObjectsEvent) {
  console.log("headObjects()");
  console.log(JSON.stringify(event, null, 2));

  const client = new S3Client({});

  // we build an array of details of objects that we find either from ListObjects
  // *or* by calling HeadObject
  const resultObjects: HeadResultType[] = [];

  // this is a new list of input items we have not dealt with yet
  const toHeadItems: HeadInputType[] = [];

  // first step is to expand out any entries we note are wildcards
  for (const o of event.Items || []) {
    if (!o.sourceBucket) {
      throw new SourceBucketFieldInvalid("missing sourceBucket");
    }

    if (!o.sourceKey) {
      throw new SourceKeyFieldInvalid("missing sourceKey");
    }

    // expand wildcard
    if (o.sourceKey.endsWith("*")) {
      let expansionCount = 0;

      for await (const data of paginateListObjectsV2(
        { client },
        {
          Bucket: o.sourceBucket,
          Prefix: o.sourceKey.substring(0, o.sourceKey.length - 2),
        },
      )) {
        for (const item of data.Contents) {
          // we skip directory markers
          // note: we do this _before_ incrementing expansionCount - so if it
          // is all just empty directory markers in a tree - we will then error out
          if (item.Size === 0 && item.Key.endsWith("/")) continue;

          // keep a count of expansion items found so we can limit
          expansionCount++;

          if (expansionCount > 1024)
            throw new WildcardExpansionMaximumError(
              o.sourceBucket,
              o.sourceKey,
            );

          // we have the benefit that ListObjects actually returns the details we
          // need - so these do not need a further HEAD command
          resultObjects.push({
            sourceBucket: o.sourceBucket,
            sourceKey: item.Key,
            etag: item.ETag,
            size: item.Size,
            storageClass: item.StorageClass,
            exists: true,
            lastModified: item?.LastModified.toISOString(),
          });
        }
      }

      if (expansionCount === 0) {
        throw new WildcardExpansionEmptyError(o.sourceBucket, o.sourceKey);
      }
    } else {
      toHeadItems.push(o);
    }
  }

  for (const o of toHeadItems) {
    try {
      // find the details of the object
      const headCommand = new HeadObjectCommand({
        Bucket: o.sourceBucket,
        Key: o.sourceKey,
      });

      const headResult = await client.send(headCommand);

      resultObjects.push({
        sourceBucket: o.sourceBucket,
        sourceKey: o.sourceKey,
        etag: headResult.ETag,
        size: headResult.ContentLength,
        storageClass: headResult.StorageClass,
        exists: true,
        lastModified: headResult.LastModified.toISOString(),
      });
    } catch (e: any) {
      if (e instanceof S3ServiceException) {
        console.error(`S3 error for ${o.sourceBucket} ${o.sourceKey}`);
        console.error(e.message);
        console.error(e.$fault);
        console.error(e.$response);
        console.error(e.$metadata);
      } else {
        console.error(`Generic error for ${o.sourceBucket} ${o.sourceKey}`);
        console.error(e);
      }
      throw e;
    }
  }

  return resultObjects;
}
