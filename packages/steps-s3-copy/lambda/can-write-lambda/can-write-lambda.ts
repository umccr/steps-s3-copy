import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  AccessDeniedError,
  DestinationPrefixKeyNoTrailingSlashError,
  WrongRegionError,
} from "./errors";
import type {
  CanWriteLambdaInvokeEvent,
  CanWriteLambdaResult,
} from "../common/can-write-lambda-types";

export async function handler(event: CanWriteLambdaInvokeEvent) {
  console.log(JSON.stringify(event, null, 2));

  if (event.invokeArguments.destinationPrefixKey)
    if (!event.invokeArguments.destinationPrefixKey.endsWith("/"))
      throw new DestinationPrefixKeyNoTrailingSlashError(
        "The destination prefix sourceKey must either be an empty string or a string with a trailing slash",
      );

  // we are being super specific here - more so than our normal client creation
  // the "required region" is where we are going
  // to make our client - in order to ensure we get 301 Redirects for buckets outside our location
  const client = new S3Client({
    region: event.invokeArguments.destinationRequiredRegion,
  });

  try {
    const putCommand = new PutObjectCommand({
      Bucket: event.invokeArguments.destinationBucket,
      Key: `${event.invokeArguments.destinationPrefixKey}${event.invokeArguments.destinationStartCopyRelativeKey}`,
      Body: "A file created by copy out to ensure correct permissions and to indicate that start of the copy process",
      // we need PutTagging permission to be right - or else rclone will fail when copying our sometimes
      // tagged source files
      Tagging: "testtag=ok",
    });

    await client.send(putCommand);
  } catch (e: any) {
    if (e.Code === "PermanentRedirect")
      throw new WrongRegionError(
        "S3 Put failed because destinationBucket was in the wrong region",
      );

    if (e.Code === "AccessDenied")
      throw new AccessDeniedError("S3 Put failed with access denied error");

    throw e;
  }

  const result: CanWriteLambdaResult = {};

  return result;
}
