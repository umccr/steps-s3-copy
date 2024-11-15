import {
  CloudFormationClient,
  DescribeStacksCommand,
} from "@aws-sdk/client-cloudformation";
import { test1 } from "./test-1.mjs";
import { test2 } from "./test-2.mjs";
import { randomBytes } from "node:crypto";

const cloudFormationClient = new CloudFormationClient({});

/*async function doTest2(stateMachineArn: string) {
  const {
    testFolderSrc,
    testFolderDest,
    testFolderObjectsTsvAbsolute,
    testFolderObjectsTsvRelative,
  } = getPaths(1);

  // we are going to make objects that are in both the src *and* destination
  // this will let us test our "checksum skipping"

  // same name and same content
  await makeTestObject(
    TEST_BUCKET,
    `${testFolderSrc}existing-a.bin`,
    256 * 1024,
  );
  await makeTestObject(
    TEST_BUCKET,
    `${testFolderDest}existing-a.bin`,
    256 * 1024,
  );

  // same name and different content - the result should be that rclone *does* copy this
  await makeTestObject(
    TEST_BUCKET,
    `${testFolderSrc}existing-b.bin`,
    64 * 1024,
  );
  await makeTestObject(
    TEST_BUCKET,
    `${testFolderDest}existing-b.bin`,
    64 * 1024,
    "STANDARD",
    1,
  );

  await makeObjectDictionaryCsv(TEST_BUCKET, testFolderObjectsTsvAbsolute, {
    "umccr-10g-data-dev": [
      "HG00096/HG00096.hard-filtered.vcf.gz",
      "HG00097/HG00097.hard-filtered.vcf.gz",
      // this does not exist
      "HG000XX/HG000XX.hard-filtered.vcf.gz",
    ],
    "not-a-bucket-that-exists": ["a-file-that-also-does-not-exist.bam"],
    [TEST_BUCKET]: [
      `${testFolderSrc}existing-a.bin`,
      `${testFolderSrc}existing-b.bin`,
    ],
  });

  await sfnClient.send(
    new StartExecutionCommand({
      stateMachineArn: stateMachineArn,
      input: JSON.stringify({
        sourceFilesCsvKey: testFolderObjectsTsvRelative,
        destinationBucket: TEST_BUCKET,
        destinationPrefixKey: testFolderDest,
        maxItemsPerBatch: 2,
      }),
    }),
  );
}

// s3:///HG00096/HG00096.hard-filtered.vcf.gz
async function doTest3(stateMachineArn: string) {
  const testFolderSrc = uniqueFolder + "-src2";
  const testFolderDest = uniqueFolder + "-dest2";

  const sourceObjects = {
    [`${testFolderSrc}/1.bin`]: StorageClass.GLACIER_IR,
    [`${testFolderSrc}/2.bin`]: StorageClass.STANDARD,
    [`${testFolderSrc}/3.bin`]: StorageClass.GLACIER,
  };

  for (const [n, stor] of Object.entries(sourceObjects)) {
    await makeTestObject(TEST_BUCKET, n, 1000, stor);
  }

  //await makeObjectDictionaryCsv(TEST_BUCKET, testFolderObjectsTsvAbsolute, {
  //  TEST_BUCKET: Object.keys(sourceObjects),
  //});

  await sfnClient.send(
    new StartExecutionCommand({
      stateMachineArn: stateMachineArn,
      input: JSON.stringify({
        sourceFilesCsvKey: `${testFolderSrc}/objects-to-copy.tsv`,
        destinationBucket: TEST_BUCKET,
        destinationPrefixKey: testFolderDest,
        maxItemsPerBatch: 1,
      }),
    }),
  );
}
*/

(async () => {
  if (process.argv.length < 3) {
    console.error(
      "You must launch the test script with the name of the CDK stack to test",
    );
    process.exit(1);
  }

  const stackNameToTest = process.argv.slice(2)[0];

  const foundStack = await cloudFormationClient.send(
    new DescribeStacksCommand({
      StackName: stackNameToTest,
    }),
  );

  if (foundStack.Stacks && foundStack.Stacks.length > 0) {
    console.log(`Using stack ${foundStack.Stacks[0].StackId}`);

    const stack = foundStack.Stacks[0];

    if (stack.Outputs) {
      const smOutput = stack.Outputs.find(
        (o) => o.OutputKey === "StateMachineArn",
      );
      const sourceOutput = stack.Outputs.find(
        (o) => o.OutputKey === "SourceBucket",
      );
      const workingOutput = stack.Outputs.find(
        (o) => o.OutputKey === "WorkingBucket",
      );
      const destinationOutput = stack.Outputs.find(
        (o) => o.OutputKey === "DestinationBucket",
      );

      if (
        smOutput &&
        smOutput.OutputValue &&
        sourceOutput &&
        sourceOutput.OutputValue &&
        workingOutput &&
        workingOutput.OutputValue &&
        destinationOutput &&
        destinationOutput.OutputValue
      ) {
        console.log(`Steps Arn = ${smOutput.OutputValue}`);

        const allTestPromises = [
          test1(
            randomBytes(8).toString("hex"),
            smOutput.OutputValue!,
            sourceOutput.OutputValue!,
            workingOutput.OutputValue!,
            destinationOutput.OutputValue!,
          ),
          /*test1(
              "",
              smOutput.OutputValue,
              "umccr-10f-data-dev",
              workingOutput.OutputValue,
              destinationOutput.OutputValue,
          ),*/
          /*test2(
              randomBytes(8).toString("hex"),
              smOutput.OutputValue,
              sourceOutput.OutputValue,
              workingOutput.OutputValue,
              "org-umccr-demo-data-copy-demo" //destinationOutput.OutputValue,
          ),*/
        ];

        const allTestResults = await Promise.allSettled(allTestPromises);

        console.log(allTestResults);
      } else {
        console.error(
          `Deployed stack ${stackNameToTest} must have set named outputs`,
        );
        process.exit(1);
      }
    } else {
      console.error(
        `Deployed stack ${stackNameToTest} must have CloudFormation outputs which we use for testing discovery`,
      );
      process.exit(1);
    }
  } else {
    console.error(
      `There is no stack named ${stackNameToTest} that we can find for testing`,
    );
    process.exit(1);
  }
})();
