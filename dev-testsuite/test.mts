import {
  CloudFormationClient,
  DescribeStacksCommand,
} from "@aws-sdk/client-cloudformation";
import { test1 } from "./test-1.mjs";
import { testRealistic } from "./test-realistic.mjs";
import { randomBytes } from "node:crypto";
import { testThawing } from "./test-thawing.mjs";

const cloudFormationClient = new CloudFormationClient({});

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

  if (!foundStack.Stacks || foundStack.Stacks.length < 1) {
    console.error(
      `There is no stack named ${stackNameToTest} that we can find for testing`,
    );
    process.exit(1);
  }

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

      // we define all the test invokes here - but can choose to execute only some of them later on

      const testThawingInvoke = async () =>
        await testThawing(
          randomBytes(8).toString("hex"),
          smOutput.OutputValue!,
          sourceOutput.OutputValue!,
          workingOutput.OutputValue!,
          destinationOutput.OutputValue!,
        );

      const testInvoke1 = async () =>
        test1(
          randomBytes(8).toString("hex"),
          smOutput.OutputValue!,
          sourceOutput.OutputValue!,
          workingOutput.OutputValue!,
          destinationOutput.OutputValue!,
        );

      const testInvoke2 = async () =>
        await testRealistic(
          randomBytes(8).toString("hex"),
          smOutput.OutputValue!,
          sourceOutput.OutputValue!,
          workingOutput.OutputValue!,
          "org-umccr-demo-data-copy-demo",
        );

      // note that our test invokes are promises - so we

      const allTestResults = await Promise.allSettled([
        testThawingInvoke(),
        // testInvoke1(),
        // testInvoke2(),
      ]);

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
})();
