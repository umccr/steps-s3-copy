import {
  HeadObjectCommand,
  NotFound,
  paginateListObjectsV2,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { join, relative, basename } from "node:path/posix";
import * as assert from "node:assert/strict";

/**
 * The way this lambda will be invoked. We expect to be part of a Distributed Map -
 * which will pass in items via an Items array. There can also be a BatchInput
 * field which currently will be empty.
 */
export type HeadObjectsLambdaInvokeEvent = {
  BatchInput: {
    destinationFolderKey: string;
    maximumExpansion: number;
  };
  Items: HeadObjectsLambdaItem[];
};

/**
 * The input items that we expect from our input JSONL (i.e. this is the JSONL
 * given to us by the user/invoker).
 */
export type HeadObjectsLambdaItem = {
  // source bucket for object
  sourceBucket: string;

  // key of object or (key + "/*") to indicate a folder
  sourceKey: string;

  // a SUMS checksum definition we are asserting about this object
  // if not present then default to no assertions about checksums.
  // specifying a sums is incompatible with a wildcard sourceKey as sums
  // are checksums for specific objects, not folders
  sums?: string;

  // if present, indicates the portion of the sourceKey that is the root of the folder
  // structure that should be copied. This affects how destination folders are calculated..
  sourceRootFolderKey?: string;

  // -- OR --

  // if present, a folder(s) path to relatively add to destination path prefix (if any)
  destinationRelativeFolderKey?: string;
};

/**
 * The output items we send on to the next steps stage - which are basically
 * the inputs + the information we have learnt from S3 about each object.
 * In the case of wildcard inputs, we will have expanded them out to individual
 * objects.
 */
export type HeadObjectsLambdaResultItem = {
  // source bucket for object
  sourceBucket: string;

  // key of object (no wildcards allowed by this point)
  sourceKey: string;

  // derived destination key for object
  destinationKey: string;

  // if present in the input, the SUMS checksums
  sums?: string;

  // storage class of object currently
  storageClass: string;

  // size in bytes
  size: number;

  // etag
  etag: string;

  // last modified date rendered as ISO string
  lastModifiedISOString: string;
};

/**
 * A function to check for the existence of all objects and output
 * the "HEAD" details of each object. Will expand keys with trailing
 * wildcards.
 *
 * @param event
 */
export async function handler(
  event: HeadObjectsLambdaInvokeEvent,
): Promise<HeadObjectsLambdaResultItem[]> {
  console.debug("headObjects()");
  console.debug(JSON.stringify(event, null, 2));

  // immediately fail if any inputs are literally not matching our desired schema/rules
  // the rules here are rules that will _always_ fail i.e. they can submit the same thing again
  // and again and they will be rejected (contrasting this to whether an object does or does not
  // exist for instance - which is a different kind of error)

  // note here that destinationFolderKey CAN BE THE EMPTY STRING - so we do not check for "false" values
  if (typeof event?.BatchInput?.destinationFolderKey !== "string")
    throw new DestinationFolderKeyFieldInvalid(
      "destinationFolderKey must be a slash terminated string or the empty string",
    );

  if (
    event.BatchInput.destinationFolderKey !== "" &&
    !event.BatchInput.destinationFolderKey.endsWith("/")
  )
    throw new DestinationFolderKeyFieldInvalid(
      "destinationFolderKey must be a slash terminated string or the empty string",
    );

  if (event.BatchInput.destinationFolderKey.includes(".."))
    throw new DestinationFolderKeyFieldInvalid(
      "destinationFolderKey cannot contain '..' (which may be interpreted by some systems as a relative path access)",
    );

  for (const o of event.Items || []) {
    if (!o.sourceBucket || typeof o.sourceBucket !== "string") {
      throw new SourceBucketFieldInvalid(
        "sourceBucket must be specified as a string",
      );
    }

    if (!o.sourceKey || typeof o.sourceKey !== "string") {
      throw new SourceKeyFieldInvalid(
        "sourceKey must be specified as a string",
      );
    }

    if (o.sourceKey.includes(".."))
      throw new SourceKeyFieldInvalid(
        "sourceKey cannot contain '..' which may be interpreted by some systems as a relative path access",
      );

    if (
      typeof o?.sourceRootFolderKey === "string" &&
      typeof o?.destinationRelativeFolderKey === "string"
    )
      throw new Error(
        "sourceRootFolderKey and destinationRelativeFolderKey cannot both be specified for a single source item",
      );

    // check destinationKey for rules
    if (typeof o.destinationRelativeFolderKey === "string") {
      if (!o.destinationRelativeFolderKey.endsWith("/"))
        throw new DestinationRelativeFolderKeyFieldInvalid(
          "if present, destinationRelativeFolderKey must have a trailing slash",
        );

      if (o.destinationRelativeFolderKey.startsWith("/"))
        throw new DestinationRelativeFolderKeyFieldInvalid(
          "destinationRelativeFolderKey cannot be an absolute path that starts with a slash - it is by definition meant to be relative",
        );

      if (o.destinationRelativeFolderKey.includes(".."))
        throw new DestinationRelativeFolderKeyFieldInvalid(
          "destinationRelativeFolderKey cannot contain '..' which may be interpreted by some systems as a relative path access",
        );
    }

    if (typeof o.sourceRootFolderKey === "string") {
      if (!o.sourceRootFolderKey.endsWith("/"))
        throw new Error(
          "if present, sourceRootFolderKey must have a trailing slash",
        );

      if (!o.sourceKey.startsWith(o.sourceRootFolderKey))
        throw new Error(
          "if present, sourceRootFolderKey must be a leading portion of the corresponding items sourceKey",
        );
    }

    // check sums for validity
    if (o.sums) {
    }
  }

  const client = new S3Client({});

  // we build an array of details of objects that we find either from ListObjects
  // *or* by calling HeadObject
  const resultObjects: HeadObjectsLambdaResultItem[] = [];

  // this is a new list of input items we have not dealt with yet
  const toHeadItems: HeadObjectsLambdaItem[] = [];

  // first step is to expand out any entries we note are wildcards
  for (const o of event.Items || []) {
    // expand wildcard
    if (o.sourceKey.endsWith("/*")) {
      if (o.sourceRootFolderKey)
        throw new Error(
          "cannot specify both a wildcard folder for a source and specify the sourceRootFolderKey",
        );

      if (o.sums)
        throw new Error(
          "cannot specify both a wildcard folder and also includes a sums field as checksums will not apply to all the expanded files",
        );

      // source key without the trailing "/*"
      const sourceKeyPrefix = o.sourceKey.substring(0, o.sourceKey.length - 2);

      let expansionCount = 0;

      for await (const data of paginateListObjectsV2(
        { client },
        {
          Bucket: o.sourceBucket,
          Prefix: sourceKeyPrefix,
        },
      )) {
        if (!data.Contents) continue;

        for (const item of data.Contents) {
          // this would be a bug in the AWS SDK contract if these were empty so we will
          // hard abort the process if so
          // need these assertions to fix the typescript guard conditions
          assert.ok(item.Key);
          assert.ok(item.ETag);
          assert.ok(item.LastModified);
          assert.equal(typeof item.Size, "number");

          // we skip directory markers in S3
          // note: we do this _before_ incrementing expansionCount - so if it
          // is all just empty directory markers in a tree - we will then error out
          if (item.Size === 0 && item.Key.endsWith("/")) continue;

          // keep a count of expansion items found so we can limit
          expansionCount++;

          if (expansionCount > event.BatchInput.maximumExpansion)
            throw new WildcardExpansionMaximumError(
              o.sourceBucket,
              o.sourceKey,
              event.BatchInput.maximumExpansion,
            );

          // we have the benefit that ListObjects actually returns the details we
          // need - so these do not need a further HEAD command
          resultObjects.push({
            sourceBucket: o.sourceBucket,
            sourceKey: item.Key,
            destinationKey: computeDestinationKey(
              item.Key,
              sourceKeyPrefix + "/",
              event.BatchInput.destinationFolderKey,
              o.destinationRelativeFolderKey,
            ),
            etag: item.ETag,
            size: item.Size,
            storageClass: item.StorageClass ?? "STANDARD",
            lastModifiedISOString: item?.LastModified.toISOString(),
            // for the moment by definition anything we wildcard expand does not have any asserted checksums
            sums: undefined,
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

      assert.ok(headResult.ETag);
      assert.ok(headResult.LastModified);
      assert.equal(typeof headResult.ContentLength, "number");

      resultObjects.push({
        sourceBucket: o.sourceBucket,
        sourceKey: o.sourceKey,
        destinationKey: computeDestinationKey(
          o.sourceKey,
          o.sourceRootFolderKey,
          event.BatchInput.destinationFolderKey,
          o.destinationRelativeFolderKey,
        ),
        etag: headResult.ETag,
        size: headResult.ContentLength,
        // as per spec - storage class is always returned by head object EXCEPT for standard
        // for our downstream processing - we mind as well rectify this so it is always present
        storageClass: headResult.StorageClass ?? "STANDARD",
        lastModifiedISOString: headResult.LastModified.toISOString(),
        sums: o.sums,
      });
    } catch (e: any) {
      // this is an error we kind of might expect - we turn it into our own exception type
      if (e instanceof NotFound) {
        throw new SourceObjectNotFound(o.sourceBucket, o.sourceKey);
      }
      if (e instanceof S3ServiceException) {
        console.error(`S3 error for ${o.sourceBucket} ${o.sourceKey}`);
        console.error(e);
      } else {
        console.error(`Generic error for ${o.sourceBucket} ${o.sourceKey}`);
        console.error(e);
      }
      throw e;
    }
  }

  // for ease of testing we return results _from this single lambda_ in a consistent order
  resultObjects.sort((a, b) =>
    a.destinationKey.localeCompare(b.destinationKey),
  );

  return resultObjects;
}

function isNotEmptyString(o: any): o is string {
  return typeof o !== "undefined" && o !== null;
}

/**
 * Do the mechanics to derive a full destination key from the source key and our partial destination keys. This is
 * needed because we expand out directories and we need the ability to retain the relative directory structure
 * of the expanded paths.
 *
 * @param sourceKey the absolute source key of an object
 * @param sourceWildcardRoot if present, indicates that the source key came from expanding this wildcard root and destinations should be computed taking that into account
 * @param destinationPrefixKey the prefix key of the destination or undefined
 * @param destinationRelativeKey a relative key to add to the destination
 * @privateRemarks this is only exported as a function so it is accessible to the unit tests
 */
export function computeDestinationKey(
  sourceKey: string,
  sourceWildcardRoot: string | undefined | null,
  destinationPrefixKey: string | undefined | null,
  destinationRelativeKey: string | undefined | null,
): string {
  if (sourceKey.endsWith("/")) {
    throw new Error(
      "Source key cannot represent a folder (trailing slash) by the time it gets to destination name resolution - it must represent an actual object in S3",
    );
  }

  if (!destinationPrefixKey) destinationPrefixKey = "";

  if (!destinationRelativeKey) destinationRelativeKey = "";

  // the relative "name" of the file is either the plain filename OR if we are sourcing files from a wildcard expansion
  // then the relative path to the wildcard root
  const destinationRel = sourceWildcardRoot
    ? relative(sourceWildcardRoot, sourceKey)
    : basename(sourceKey);

  return join(destinationPrefixKey, destinationRelativeKey, destinationRel);
}

export class IsThawingError extends Error {
  constructor(message: string) {
    super();
    this.name = "IsThawingError";
    this.message = message;
  }
}

export class SourceBucketFieldInvalid extends Error {
  constructor(message: string) {
    super();
    this.name = "SourceBucketFieldInvalid";
    this.message = message;
  }
}

export class SourceKeyFieldInvalid extends Error {
  constructor(message: string) {
    super();
    this.name = "SourceKeyFieldInvalid";
    this.message = message;
  }
}

export class SourceObjectNotFound extends Error {
  constructor(bucket: string, key: string) {
    super();
    this.name = "SourceObjectNotFound";
    this.message = `Object s3://${bucket}/${key} does not exist or is not accessible`;
  }
}

export class DestinationFolderKeyFieldInvalid extends Error {
  constructor(message: string) {
    super();
    this.name = "DestinationFolderKeyFieldInvalid";
    this.message = message;
  }
}

export class DestinationRelativeFolderKeyFieldInvalid extends Error {
  constructor(message: string) {
    super();
    this.name = "DestinationRelativeFolderKeyFieldInvalid";
    this.message = message;
  }
}

export class WildcardExpansionMaximumError extends Error {
  constructor(bucket: string, key: string, max: number) {
    super();
    this.name = "WildcardExpansionMaximumError";
    this.message = `Expanding s3://${bucket}/${key} resulted in a number of objects that exceeds our safety limit of ${max}`;
  }
}

export class WildcardExpansionEmptyError extends Error {
  constructor(bucket: string, key: string) {
    super();
    this.name = "WildcardExpansionEmptyError";
    this.message = `Expanding s3://${bucket}/${key} resulted in no objects`;
  }
}

export class SourceBucketWrongRegionError extends Error {
  constructor(message: string) {
    super();
    this.name = "SourceBucketWrongRegionError";
    this.message = message;
  }
}
