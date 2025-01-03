import { StorageClass, ChecksumAlgorithm } from "@aws-sdk/client-s3";
import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";
import { TEST_BUCKET_WORKING_PREFIX } from "./constants.mjs";
import {
  createTestObject,
  getPaths,
  KiB,
  makeObjectDictionaryCsv,
  MiB,
  TestObject,
} from "./test-util.mjs";
import { waitUntilStateMachineFinishes } from "./steps-waiter.mjs";
import { assertDestinations } from "./test-assert.mjs";

const sfnClient = new SFNClient({});

type TestObjectParams = {
  sizeInBytes: number;
  partSizeInBytes?: number;
  checksumAlgorithm?: ChecksumAlgorithm;
  storageClass?: StorageClass;
};

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
export async function testThawing(
  uniqueTestId: string,
  stateMachineArn: string,
  sourceBucket: string,
  workingBucket: string,
  destinationBucket: string,
) {
  console.log(
    `Test "thawing" (${uniqueTestId}) working ${workingBucket}/${TEST_BUCKET_WORKING_PREFIX} and copying ${sourceBucket}->${destinationBucket}`,
  );

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

  const sourceObjects: Record<string, TestObjectParams> = {
    [`glacier-single-part.bin`]: {
      sizeInBytes: 256 * KiB,
      storageClass:
        "GLACIER" /* this is now Glacier Flexible Retrieval - the enum name is still the original name */,
    },
    [`glacier-multi-part.bin`]: {
      sizeInBytes: 6 * MiB,
      partSizeInBytes: 5 * MiB,
      storageClass:
        "GLACIER" /* this is now Glacier Flexible Retrieval - the enum name is still the original name */,
    },
    [`standard-single-part.bin`]: {
      sizeInBytes: 256 * KiB,
    },
    [`glacier-ir-single-part.bin`]: {
      sizeInBytes: 256 * KiB,
      storageClass:
        "GLACIER_IR" /* Glacier IR should behave like normal S3 but we want to ensure that works */,
    },
    [`glacier-ir-multi-part.bin`]: {
      sizeInBytes: 6 * MiB,
      partSizeInBytes: 5 * MiB,
      storageClass:
        "GLACIER_IR" /* Glacier IR should behave like normal S3 but we want to ensure that works */,
    },
  };

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

  if (uniqueTestId === "") return;

  const testObjectKeys = Object.keys(sourceObjects).map(
    (n) => `${testFolderSrc}${n}`,
  );

  testObjectKeys.push("not-a-file-that-exists.bin");
  testObjectKeys.push("a-file-with-a-wildcard*.bin");

  await makeObjectDictionaryCsv(workingBucket, testFolderObjectsTsvAbsolute, {
    [sourceBucket]: testObjectKeys,
    ["1000genomes-dragen"]: ["aws-programmatic-access-test-object"],
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

  const executionResult = await waitUntilStateMachineFinishes(
    { client: sfnClient, maxWaitTime: 120 },
    {
      executionArn: executionStartResult.executionArn,
    },
  );

  console.log(executionResult);

  await assertDestinations(uniqueTestId, destinationBucket, testObjects);

  return 0;
}
