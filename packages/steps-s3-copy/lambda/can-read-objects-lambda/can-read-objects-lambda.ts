import {
  HeadObjectCommand,
  RestoreObjectCommand,
  Tier,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { IsThawingError } from "./errors";
import type { BucketDefinition } from "../../src/steps-s3-copy-input";
import { createS3ClientCache } from "../common/s3-client-builder";
import { checkColdStorage } from "../common/constants";

interface ThawParams {
  glacierFlexibleRetrievalThawDays?: number;
  glacierFlexibleRetrievalThawSpeed?: Tier;

  glacierDeepArchiveThawDays?: number;
  glacierDeepArchiveThawSpeed?: Tier;

  intelligentTieringArchiveThawDays?: number;
  intelligentTieringArchiveThawSpeed?: Tier;

  intelligentTieringDeepArchiveThawDays?: number;
  intelligentTieringDeepArchiveThawSpeed?: Tier;
}

interface ThawObjectsEvent {
  Items: { bucket: string; key: string }[];
  BatchInput: {
    thawParams: ThawParams;
    aggressiveTimes: boolean;
    bucketDefinitions?: Record<string, BucketDefinition>;
  };
}

/**
 * A function to check for the existence of all objects and that they
 * are in the right region. Will initiate restore for any S3 objects that are in storage
 * classes that do not allow immediate access.
 *
 * It attempts to find any objects that need thawing and initiates a restore.
 * And it detects if any of in the process of thawing. In those cases it
 * throws an IsThawingError which should be retried by the outer Steps.
 *
 * @param event
 */
export async function handler(event: ThawObjectsEvent) {
  console.log("canReadObjects()");
  console.log(JSON.stringify(event, null, 2));

  // count of how many of the passed in objects we are thawing
  let isThawing = 0;

  const getClient = createS3ClientCache(event.BatchInput.bucketDefinitions);

  for (const o of event.Items || []) {
    try {
      const client = await getClient(o.bucket);

      // need to find out if the object is in a "needs restore" or "currently restoring" or "restored" category
      // and also if the sourceBucket is in the correct region
      const headCommand = new HeadObjectCommand({
        Bucket: o.bucket,
        Key: o.key,
      });

      const headResult = await client.send(headCommand);

      // true if the object has already been thawed (and is readable right now)
      let alreadyRestored = false;

      if (headResult.Restore) {
        // the object is still being thawed
        if (headResult.Restore.includes('ongoing-request="true"')) {
          isThawing++;
          continue;
        }

        // otherwise it has been restored (ongoing-request="false", expiry-date="...").
        // It is readable now, but the restored copy may expire before the copy finishes
        // (e.g. thawed days ago). So we fall through and re-issue the restore with the
        // normal thaw days, which resets the expiry. We do not count it as thawing.
        alreadyRestored = true;
      }

      // now deal with the objects we have detected that are in storage classes needing restoring but where it
      // hasn't started yet

      const storageClass = headResult.StorageClass ?? "STANDARD";
      const archiveStatus = headResult.ArchiveStatus;
      const isColdStorage = checkColdStorage(storageClass, archiveStatus);

      if (isColdStorage) {
        // Default to 1 day and Bulk tier unless overridden in thawParams
        let days: number = 1;
        let tier: Tier = "Bulk";

        if (storageClass == "GLACIER") {
          days =
            event.BatchInput.thawParams.glacierFlexibleRetrievalThawDays ??
            days;
          tier =
            event.BatchInput.thawParams.glacierFlexibleRetrievalThawSpeed ??
            tier;
        }
        if (storageClass == "DEEP_ARCHIVE") {
          days = event.BatchInput.thawParams.glacierDeepArchiveThawDays ?? days;
          tier =
            event.BatchInput.thawParams.glacierDeepArchiveThawSpeed ?? tier;
        }
        if (storageClass == "INTELLIGENT_TIERING") {
          if (archiveStatus == "ARCHIVE_ACCESS") {
            days =
              event.BatchInput.thawParams.intelligentTieringArchiveThawDays ??
              days;
            tier =
              event.BatchInput.thawParams.intelligentTieringArchiveThawSpeed ??
              tier;
          }
          if (archiveStatus == "DEEP_ARCHIVE_ACCESS") {
            days =
              event.BatchInput.thawParams
                .intelligentTieringDeepArchiveThawDays ?? days;
            tier =
              event.BatchInput.thawParams
                .intelligentTieringDeepArchiveThawSpeed ?? tier;
          }
        }
        // DEBUG: Log restore settings chosen
        console.log(
          JSON.stringify({
            msg: "Chosen restore settings",
            bucket: o.bucket,
            key: o.key,
            storageClass: headResult.StorageClass,
            days,
            tier,
          }),
        );

        if (alreadyRestored) {
          // Only extend if the restored copy will expire sooner than a fresh restore
          // with our thaw days would. This avoids pointless requests and never shortens
          // an existing (longer) restore window.
          // Restore header example: ongoing-request="false", expiry-date="Sat, 02 Dec 2023 00:00:00 GMT"
          const expiryMatch = headResult.Restore?.match(
            /expiry-date="([^"]+)"/,
          );
          const expiryMs = expiryMatch ? Date.parse(expiryMatch[1]) : NaN;
          // expiry (in ms) a fresh restore would give: now + days (days * 24h * 60min * 60s * 1000ms)
          const newExpiryMs = Date.now() + days * 24 * 60 * 60 * 1000;

          // if we cannot parse the expiry we extend, to be safe
          if (!Number.isNaN(expiryMs) && expiryMs >= newExpiryMs) {
            console.log(
              JSON.stringify({
                msg: "Already restored with long enough expiry, not extending",
                bucket: o.bucket,
                key: o.key,
                expiry: expiryMatch?.[1],
                days,
              }),
            );
            continue;
          }
        }

        const restoreObjectCommand = new RestoreObjectCommand({
          Bucket: o.bucket,
          Key: o.key,
          RestoreRequest: {
            Days: days,
            GlacierJobParameters: {
              Tier: tier,
            },
          },
        });

        await client.send(restoreObjectCommand);

        // note: if the restore operation itself fails - then above line will throw an exception
        // which means this will not count for "isThawing"
        // which I think is the correct logic - if there is a permanent reason we can't unthaw an object - it will
        // fall throughout of this and the rclone will fail (at which point we will get an error and
        // we can investigate)

        // an extension of an already restored object is readable now, so it must not
        // trigger an IsThawingError retry (which would extend it again on every retry)
        if (!alreadyRestored) isThawing++;
      }
    } catch (e: any) {
      // we actually gobble up any errors here (with just a print)
      // see the top of this method for details

      if (e instanceof S3ServiceException) {
        console.error(`S3 error for ${o.bucket} ${o.key}`);
        console.error(e.message);
        console.error(e.$fault);
        console.error(e.$response);
        console.error(e.$metadata);
      } else {
        console.error(`Generic error for ${o.bucket} ${o.key}`);
        console.error(e);
      }

      throw e;
    }
  }

  // the *only* way this method can fail via error is this path
  // where we tell the Steps we are in the process of thawing
  // *all* other paths should continue on (where they can fail in the rclone)
  if (isThawing > 0) {
    throw new IsThawingError(
      `${isThawing}/${event.Items.length} are in the process of thawing`,
    );
  }
  // Return original input so downstream steps (e.g. ECS copy) get expected fields
  return event;
}
