import { ChecksumAlgorithm, S3Client, StorageClass } from "@aws-sdk/client-s3";
import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";
import { TEST_BUCKET_WORKING_PREFIX } from "./constants.mjs";
import {
  createTestObject,
  getPaths,
  makeObjectDictionaryCsv,
  TestObject,
} from "./test-util.mjs";
import { triggerAndReturnErrorReport } from "./lib/error-reporter.js";
import { WaiterState } from "@smithy/util-waiter";

const TEST_NAME = "parts checksums";

const s3Client = new S3Client({});
const sfnClient = new SFNClient({});

type TestObjectParams = {
  sizeInBytes: number;
  partSizeInBytes?: number;
  checksumAlgorithm?: ChecksumAlgorithm;
  storageClass?: StorageClass;
};

const MiB = 1024 * 1024;

/**
 * Execute a test on the given state machine, copying newly created objects from
 * sourceBucket to destinationBucket, and using workingBucket for working artifacts.
 *
 * @param uniqueTestId a unique string for this particular test invocation
 * @param stateMachineArn the state machine under test
 * @param sourceBucket the bucket in which to place test objects
 * @param workingBucket the working bucket to use
 * @param destinationBucket the destination bucket in which to find copied test objects
 */
export async function testPartsChecksums(
  uniqueTestId: string,
  stateMachineArn: string,
  sourceBucket: string,
  workingBucket: string,
  destinationBucket: string,
) {
  console.log(`Test "${TEST_NAME}" (${uniqueTestId})`);

  const {
    testFolderSrc,
    testFolderDest,
    testFolderObjectsTsvAbsolute,
    testFolderObjectsTsvRelative,
  } = getPaths(
    sourceBucket,
    workingBucket,
    TEST_BUCKET_WORKING_PREFIX,
    destinationBucket,
    uniqueTestId,
  );

  // 3 files in standard storage (no thawing)
  const sourceObjects: Record<string, TestObjectParams> = {
    [`1.bin`]: {
      sizeInBytes: 256 * 124,
    },
    [`2.bin`]: {
      sizeInBytes: 256 * 124,
      // noting that this min part size of 5MiB means that this
      // is still only a single part - but will be uploaded via multipart upload
      partSizeInBytes: 5 * 1024 * 1024,
    },
    [`3.bin`]: {
      sizeInBytes: 256 * 124,
      checksumAlgorithm: "CRC32",
    },
    [`4.bin`]: {
      sizeInBytes: 256 * 124,
      // noting that this min part size of 5MiB means that this
      // is still only a single part - but will be uploaded via multipart upload
      partSizeInBytes: 5 * 1024 * 1024,
      checksumAlgorithm: "SHA1",
    },
  };

  /*const sourceObjects: Record<string, TestObjectParams> = {
    //[`many-parts.bin`]: {
    //  // 1010 parts (above the 1000 part boundary) of 5 MiB and then some "extra" to test that edge case as well
    //  sizeInBytes: (5 * MiB * 1010) + 4111,
    //  partSizeInBytes: 5 * MiB,
    //},
    // [`many-parts-with-crc32.bin`]: {
    //  // 1010 parts (above the 1000 part boundary) of 5 MiB and then some "extra" to test that edge case as well
    //  sizeInBytes: (5 * MiB * 1010) + 4111,
    //  partSizeInBytes: 5 * MiB,
    //  checksumAlgorithm: "CRC32"
    //},
    [`uneven-parts.bin`]: {
      sizeInBytes: 45 * MiB,
      partSizeInBytes: 6 * MiB,
    },
    [`uneven-parts-with-crc32.bin`]: {
      sizeInBytes: 45 * MiB,
      partSizeInBytes: 6 * MiB,
      checksumAlgorithm: "CRC32"
    },
    [`uneven-parts-with-sha1.bin`]: {
      sizeInBytes: 45 * MiB,
      partSizeInBytes: 6 * MiB,
      checksumAlgorithm: "SHA1"
    },
    [`skip-part-numbers.bin`]: {
      sizeInBytes: 45 * MiB,
      partSizeInBytes: 6 * MiB,
    },
    // You cannot skip part numbers if using checksums
    // [`skip-part-numbers-with-crc32.bin`]: {
    //  sizeInBytes: 45 * MiB,
    //  partSizeInBytes: 6 * MiB,
    //  checksumAlgorithm: "CRC32"
    //},
    //[`largest-single-part.bin`]: {
    //  sizeInBytes: 5000 * MiB,
    //  partSizeInBytes: undefined
    //},
  }; */

  const testObjects: Record<string, TestObject> = {};

  for (const [n, params] of Object.entries(sourceObjects)) {
    testObjects[n] = await createTestObject(
      sourceBucket,
      `${testFolderSrc}${n}`,
      params.sizeInBytes,
      0,
      "",
      params.partSizeInBytes,
      params.checksumAlgorithm,
      params.storageClass,
    );
  }

  await makeObjectDictionaryCsv(workingBucket, testFolderObjectsTsvAbsolute, {
    [sourceBucket]: Object.keys(sourceObjects).map(
      (n) => `${testFolderSrc}${n}`,
    ),
  });

  const executionStartResult = await sfnClient.send(
    new StartExecutionCommand({
      stateMachineArn: stateMachineArn,
      name: uniqueTestId,
      input: JSON.stringify({
        sourceFilesCsvKey: testFolderObjectsTsvRelative,
        destinationBucket: destinationBucket,
        destinationPrefixKey: testFolderDest,
        maxItemsPerBatch: 1,
      }),
    }),
  );

  return await triggerAndReturnErrorReport(
    TEST_NAME,
    uniqueTestId,
    executionStartResult.executionArn!,
    180,
    destinationBucket,
    testObjects,
    WaiterState.SUCCESS,
  );
}
