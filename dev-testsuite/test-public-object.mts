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
import { waitUntilStateMachineFinishes } from "./lib/steps-waiter.mjs";
import { assertDestinations } from "./lib/assert-destinations.mjs";

const TEST_NAME = "public object";

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
export async function testPublicObject(
  uniqueTestId: string,
  stateMachineArn: string,
  sourceBucket: string,
  workingBucket: string,
  destinationBucket: string,
) {
  console.log(
    `Test "public object" (${uniqueTestId}) working ${workingBucket}/${TEST_BUCKET_WORKING_PREFIX} and copying ${sourceBucket}->${destinationBucket}`,
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

  return {
    testName: TEST_NAME,
    testResult: "not run",
  };

  await makeObjectDictionaryCsv(workingBucket, testFolderObjectsTsvAbsolute, {
    // need to find an object in Sydney

    // need to turn this into an actual error (as it correctly fails because the object is in us-west-2
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

  // await assertDestinations(uniqueTestId, destinationBucket, testObjects);

  return 0;
}
