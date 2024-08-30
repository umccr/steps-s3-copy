import {
  HeadObjectCommand,
  RestoreObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { IsThawingError } from "./errors";

interface ThawObjectsEvent {
  Items: {
    bucket: string;
    key: string;
  }[];

  BatchInput: {
    glacierFlexibleRetrievalThawDays: number;
    glacierFlexibleRetrievalThawSpeed: string;

    glacierDeepArchiveThawDays: number;
    glacierDeepArchiveThawSpeed: string;

    intelligentTieringArchiveThawDays: number;
    intelligentTieringArchiveThawSpeed: string;

    intelligentTieringDeepArchiveThawDays: number;
    intelligentTieringDeepArchiveThawSpeed: string;
  };
}

/**
 * A function to initiate restore/monitor any S3 objects that are in storage
 * classes that do not allow immediate access.
 *
 * Note that restoring objects is the *sole* purpose of this lambda - so even
 * though it could detect invalid objects / permissions errors etc - that is
 * not what it is going to do.
 *
 * It attempts to find any objects that need thawing and initiates a restore.
 * And it detects if any of in the process of thawing. In those cases it
 * throws an Error. In *all other cases* it passes on data for the Fargate
 * rclone step (even if there were exceptions it gobbled up).
 *
 * We do this because rclone has better mechanism for detecting errors and
 * we don't want to redo the work here. Also this means error reporting
 * out of the overall Steps orchestration will be consistent for "missing files"
 * etc.
 *
 * @param event
 */
export async function handler(event: ThawObjectsEvent) {
  console.log("thawObjects()");
  console.log(JSON.stringify(event, null, 2));

  const client = new S3Client({});

  // count of how many of the passed in objects we are thawing
  let isThawing = 0;

  for (const o of event.Items || []) {
    try {
      // need to find out if the object is in a "needs restore" or "currently restoring" or "restored" category
      const headCommand = new HeadObjectCommand({
        Bucket: o.bucket,
        Key: o.key,
      });

      const headResult = await client.send(headCommand);

      if (headResult.Restore) {
        // the object is still being thawed
        if (headResult.Restore.includes('ongoing-request="true"')) isThawing++;

        // otherwise it may successfully have been restored - in which case we can just continue
        // as if the file was in S3 active
        // TODO are there other states we should check here?
        // the only one I've found is ongoing-request=\"false\", expiry-date=\"Sat, 02 Dec 2023 00:00:00 GMT\"
        continue;
      }

      // now deal with the objects we have detected that are in storage classes needing restoring but where it
      // hasn't started yet
      if (
        headResult.StorageClass == "GLACIER" ||
        headResult.StorageClass == "DEEP_ARCHIVE" ||
        headResult.StorageClass == "INTELLIGENT_TIERING"
      ) {
        // some sensible defaults - that we retain if any of the expected parameter values is not present
        let days: number = 1;
        let tier: string = "Bulk";

        if (headResult.StorageClass == "GLACIER") {
          days = event.BatchInput.glacierFlexibleRetrievalThawDays ?? days;
          tier = event.BatchInput.glacierFlexibleRetrievalThawSpeed ?? tier;
        }
        if (headResult.StorageClass == "DEEP_ARCHIVE") {
          days = event.BatchInput.glacierDeepArchiveThawDays ?? days;
          tier = event.BatchInput.glacierDeepArchiveThawSpeed ?? tier;
        }
        if (headResult.StorageClass == "INTELLIGENT_TIERING") {
          if (headResult.ArchiveStatus == "ARCHIVE_ACCESS") {
            days = event.BatchInput.intelligentTieringArchiveThawDays ?? days;
            tier = event.BatchInput.intelligentTieringArchiveThawSpeed ?? tier;
          }
          if (headResult.ArchiveStatus == "DEEP_ARCHIVE_ACCESS") {
            days =
              event.BatchInput.intelligentTieringDeepArchiveThawDays ?? days;
            tier =
              event.BatchInput.intelligentTieringDeepArchiveThawSpeed ?? tier;
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

        const restoreObjectResult = await client.send(restoreObjectCommand);

        // note: if the restore operation itself fails - then above line will throw an exception
        // which means this will not count for "isThawing"
        // which I think is the correct logic - if there is a permanent reason we can't unthaw an object - it will
        // fall throughout of this and the rclone will fail (at which point we will get an error and
        // we can investigate)

        isThawing++;
      }
    } catch (e: any) {
      // we actually gobble up any errors here (with just a print)
      // see the top of this method for details
      console.error(e);
    }
  }

  // the *only* way this method can fail via error is this path
  // where we tell the Steps we are in the process of thawing
  // *all* other paths should continue on (where they can fail in the rclone)
  if (isThawing > 0)
    throw new IsThawingError(
      `${isThawing}/${event.Items.length} are in the process of thawing`,
    );

  return {};
}
