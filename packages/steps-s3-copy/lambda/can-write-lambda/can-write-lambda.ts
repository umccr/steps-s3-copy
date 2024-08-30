import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  AccessDeniedError,
  DestinationPrefixKeyNoTrailingSlashError,
  WrongRegionError,
} from "./errors";

// see the main src/copy-out-state-machine-input.ts for matching fields

interface InvokeEvent {
  requiredRegion: string;

  destinationBucket: string;

  destinationPrefixKey: string;

  destinationStartCopyRelativeKey: string;
}

export async function handler(event: InvokeEvent) {
  console.log(JSON.stringify(event, null, 2));

  if (event.destinationPrefixKey)
    if (!event.destinationPrefixKey.endsWith("/"))
      throw new DestinationPrefixKeyNoTrailingSlashError(
        "The destination prefix key must either be an empty string or a string with a trailing slash",
      );

  // we are being super specific here - more so than our normal client creation
  // the "required region" is where we are going
  // to make our client - in order to ensure we get 301 Redirects for buckets outside our location
  const client = new S3Client({ region: event.requiredRegion });

  try {
    const putCommand = new PutObjectCommand({
      Bucket: event.destinationBucket,
      Key: `${event.destinationPrefixKey}${event.destinationStartCopyRelativeKey}`,
      Body: "A file created by copy out to ensure correct permissions and to indicate that start of the copy process",
    });

    await client.send(putCommand);
  } catch (e: any) {
    if (e.Code === "PermanentRedirect")
      throw new WrongRegionError(
        "S3 Put failed because bucket was in the wrong region",
      );

    if (e.Code === "AccessDenied")
      throw new AccessDeniedError("S3 Put failed with access denied error");

    throw e;
  }
}
