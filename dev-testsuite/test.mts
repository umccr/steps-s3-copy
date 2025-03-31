import {
  CloudFormationClient,
  DescribeStacksCommand,
  Stack,
} from "@aws-sdk/client-cloudformation";
import { testPartsChecksums } from "./test-parts-checksums.mjs";
import { testRealistic } from "./test-realistic.mjs";
import { randomBytes } from "node:crypto";
import { testThawing } from "./test-thawing.mjs";
import { testErrorMissingObject } from "./test-error-missing-object.mjs";
import { testPublicObject } from "./test-public-object.mjs";
import { TEST_BUCKET_WORKING_PREFIX } from "./constants.mjs";
import {
  DescribeStateMachineCommand,
  SFNClient,
  TestStateCommand,
} from "@aws-sdk/client-sfn";
import { tap } from "node:test/reporters";
import { run } from "node:test";
import path from "node:path";

const cloudFormationClient = new CloudFormationClient({});
const sfnClient = new SFNClient({});

(async () => {
  if (process.argv.length < 3) {
    console.error(
      "You must launch the test script with the name of the CDK stack to test - the named outputs of the CDK stack will be used to find the resources to test",
    );
    process.exit(1);
  }

  const stackNameToTest = process.argv.slice(2)[0];

  const foundStack = await cloudFormationClient.send(
    new DescribeStacksCommand({
      StackName: stackNameToTest,
    }),
  );

  if (!foundStack.Stacks || foundStack.Stacks.length < 1) {
    console.error(
      `There is no stack named ${stackNameToTest} that we can find for testing`,
    );
    process.exit(1);
  }

  console.log(`Using stack ${foundStack.Stacks[0].StackId}`);

  const stack = foundStack.Stacks[0];

  const getMandatoryStackOutputValue = (stack: Stack, name: string): string => {
    if (!stack.Outputs) {
      console.error(
        `Deployed stack ${stackNameToTest} must have CloudFormation outputs which we use for resource discovery`,
      );
      process.exit(1);
    }

    const output = stack.Outputs.find((o) => o.OutputKey === name);

    if (!output || !output.OutputValue) {
      console.error(
        `Deployed stack ${stackNameToTest} must have set named outputs - missing ${name}`,
      );
      process.exit(1);
    }

    return output.OutputValue;
  };

  const smArn = getMandatoryStackOutputValue(stack, "StateMachineArn");
  const smRoleArn = getMandatoryStackOutputValue(stack, "StateMachineRoleArn");
  const smCanWriteLambdaAslStateName = getMandatoryStackOutputValue(
    stack,
    "StateMachineCanWriteLambdaAslStateName",
  );
  const sourceBucket = getMandatoryStackOutputValue(stack, "SourceBucket");
  const workingBucket = getMandatoryStackOutputValue(stack, "WorkingBucket");
  const destinationBucket = getMandatoryStackOutputValue(
    stack,
    "DestinationBucket",
  );

  console.log(`Steps Arn = ${smArn}`);
  console.log(
    `Working S3 Location = ${workingBucket}/${TEST_BUCKET_WORKING_PREFIX}`,
  );
  console.log(`Source S3 Bucket = ${sourceBucket}`);
  console.log(`Destination S3 Bucket = ${destinationBucket}/<test id>/`);

  const smDefinition = await sfnClient.send(
    new DescribeStateMachineCommand({
      stateMachineArn: smArn,
      includedData: "ALL_DATA",
    }),
  );

  console.log(smCanWriteLambdaAslStateName);

  run({
    files: [path.resolve("./test-a.ts")],
  })
    .on("test:fail", () => {
      process.exitCode = 1;
    })
    .compose(tap)
    .pipe(process.stdout);

  const smDefinitionJson = JSON.parse(smDefinition.definition!);

  for (const [k, v] of Object.entries(smDefinitionJson["States"])) {
    console.log(k);
    if (k === smCanWriteLambdaAslStateName) {
      const testResult1 = await sfnClient.send(
        new TestStateCommand({
          definition: JSON.stringify(v),
          roleArn: smRoleArn,
          input: "{}",
          variables: JSON.stringify({
            invokeArguments: {
              destinationBucket: destinationBucket,
              destinationPrefixKey: "",
            },
            invokeSettings: {
              workingBucket: "abcd",
              workingBucketPrefixKey: "aasd/",
            },
          }),
        }),
      );
      console.log(testResult1);

      const testResult2 = await sfnClient.send(
        new TestStateCommand({
          definition: JSON.stringify(v),
          roleArn: smRoleArn,
          input: "{}",
          variables: JSON.stringify({
            invokeArguments: {
              destinationBucket: "tcga-2-controlled",
              destinationPrefixKey: "",
            },
            invokeSettings: {
              workingBucket: "abcd",
              workingBucketPrefixKey: "aasd/",
            },
          }),
        }),
      );

      console.log(testResult2);
    }
  }

  return;

  const asyncTest = async (func: any) =>
    await func(
      randomBytes(8).toString("hex"),
      smArn,
      sourceBucket,
      workingBucket,
      destinationBucket,
    );

  const allTestResults = await Promise.allSettled([
    asyncTest(testPartsChecksums),
    asyncTest(testThawing),
    asyncTest(testErrorMissingObject),
    asyncTest(testRealistic),
    // asyncTest(testPublicObject),
  ]);

  console.log(JSON.stringify(allTestResults, null, 2));
})();
