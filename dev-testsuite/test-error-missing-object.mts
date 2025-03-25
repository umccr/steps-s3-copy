import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";
import { TEST_BUCKET_WORKING_PREFIX } from "./constants.mjs";
import { getPaths, makeObjectDictionaryCsv } from "./test-util.mjs";
import { waitUntilStateMachineFinishes } from "./lib/steps-waiter.mjs";

const sfnClient = new SFNClient({});

const TEST_NAME = "missing object";

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
export async function testErrorMissingObject(
  uniqueTestId: string,
  stateMachineArn: string,
  sourceBucket: string,
  workingBucket: string,
  destinationBucket: string,
) {
  console.log(
    `Test "${TEST_NAME}" (${uniqueTestId}) working ${workingBucket}/${TEST_BUCKET_WORKING_PREFIX} and copying ${sourceBucket}->${destinationBucket}`,
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

  await makeObjectDictionaryCsv(workingBucket, testFolderObjectsTsvAbsolute, {
    [sourceBucket]: ["not-a-file-that-exists.bin"],
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
    { client: sfnClient, maxWaitTime: 360 },
    {
      executionArn: executionStartResult.executionArn,
    },
  );

  return {
    testName: TEST_NAME,
    // TODO: we expect this one to fail - we need to dig deeper in the errors though to make sure our error is correct!
    testSuccess: executionResult.state == "FAILURE",
    testData: executionResult,
  };
}
