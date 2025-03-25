import {
  CloudFormationClient,
  DescribeStacksCommand,
} from "@aws-sdk/client-cloudformation";
import { testPartsChecksums } from "./test-parts-checksums.mjs";
import { testRealistic } from "./test-realistic.mjs";
import { randomBytes } from "node:crypto";
import { testThawing } from "./test-thawing.mjs";
import { testErrorMissingObject } from "./test-error-missing-object.mjs";
import { testPublicObject } from "./test-public-object.mjs";
import { TEST_BUCKET_WORKING_PREFIX } from "./constants.mjs";

const cloudFormationClient = new CloudFormationClient({});

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

  if (!stack.Outputs) {
    console.error(
      `Deployed stack ${stackNameToTest} must have CloudFormation outputs which we use for resource discovery`,
    );
    process.exit(1);
  }

  const smOutput = stack.Outputs.find((o) => o.OutputKey === "StateMachineArn");
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
    !smOutput ||
    !smOutput.OutputValue ||
    !sourceOutput ||
    !sourceOutput.OutputValue ||
    !workingOutput ||
    !workingOutput.OutputValue ||
    !destinationOutput ||
    !destinationOutput.OutputValue
  ) {
    console.error(
      `Deployed stack ${stackNameToTest} must have set named outputs`,
    );
    process.exit(1);
  }

  console.log(`Steps Arn = ${smOutput.OutputValue}`);
  console.log(
    `Working S3 Location = ${workingOutput.OutputValue!}/${TEST_BUCKET_WORKING_PREFIX}`,
  );
  console.log(`Source S3 Bucket = ${sourceOutput.OutputValue!}`);
  console.log(
    `Destination S3 Bucket = ${destinationOutput.OutputValue!}/<test id>/`,
  );

  const asyncTest = async (func: any) =>
    await func(
      randomBytes(8).toString("hex"),
      smOutput.OutputValue!,
      sourceOutput.OutputValue!,
      workingOutput.OutputValue!,
      destinationOutput.OutputValue!,
    );

  const allTestResults = await Promise.allSettled([
    asyncTest(testPartsChecksums),
    asyncTest(testThawing),
    asyncTest(testErrorMissingObject),
    // asyncTest(testPublicObject),
  ]);

  console.log(JSON.stringify(allTestResults, null, 2));
})();
