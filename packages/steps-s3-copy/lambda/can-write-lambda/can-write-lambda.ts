import { PutObjectCommand } from "@aws-sdk/client-s3";
import {
  AccessDeniedError,
  DestinationPrefixKeyNoTrailingSlashError,
  WrongRegionError,
} from "./errors";
import type {
  CanWriteLambdaInvokeEvent,
  CanWriteLambdaResult,
} from "../common/can-write-lambda-types";
import { buildS3Client } from "../common/s3-client-builder";
import { assertInvokeArgumentString } from "../common/assert-invoke-arguments";

export async function handler(event: CanWriteLambdaInvokeEvent) {
  console.log("canWrite()");
  console.debug(JSON.stringify(event, null, 2));

  // Optional invokeArguments fields are defaulted in the state machine's
  // "Assign Inputs to State and Apply Defaults" Pass state. These asserts catch the case
  // where that defaulting was bypassed (e.g. a test invoking this lambda directly).
  assertInvokeArgumentString(
    event.invokeArguments.destinationPrefix,
    "destinationPrefix",
  );
  assertInvokeArgumentString(
    event.invokeArguments.startMarkerKey,
    "startMarkerKey",
  );

  if (
    event.invokeArguments.destinationPrefix &&
    !event.invokeArguments.destinationPrefix.endsWith("/")
  )
    throw new DestinationPrefixKeyNoTrailingSlashError(
      "The destination prefix must either be an empty string or a string with a trailing slash",
    );

  // we are being super specific here - more so than our normal client creation
  // the "required region" is where we are going
  // to make our client - in order to ensure we get 301 Redirects for buckets outside our location
  // If bucket overrides are present, this will take precedence over the required region.
  const client = await buildS3Client(
    event.invokeArguments.destinationBucket,
    event.invokeArguments.bucketDefinitions,
    event.invokeArguments.destinationRequiredRegion,
  );

  try {
    if (event.invokeArguments.dryRun) {
      // is there an operation we can do here that doesn't end up writing anything?
      // how about initiate multi part?
    } else {
      const putCommand = new PutObjectCommand({
        Bucket: event.invokeArguments.destinationBucket,
        Key: `${event.invokeArguments.destinationPrefix}${event.invokeArguments.startMarkerKey}`,
        Body: "A file created by copy out to ensure correct permissions and to indicate that start of the copy process",
        // we need PutTagging permission to be right - or else rclone will fail when copying our sometimes
        // tagged source files
        Tagging: "testtag=ok",
      });

      await client.send(putCommand);
    }
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
