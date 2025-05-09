import {
  CloudFormationClient,
  DescribeStacksCommand,
  Stack,
} from "@aws-sdk/client-cloudformation";
import { DescribeStateMachineCommand, SFNClient } from "@aws-sdk/client-sfn";
import { randomBytes } from "node:crypto";

export type TestSetupState = {
  // we use a short random hex string for naming folders - as we create objects in a shared bucket
  // and we don't want them to clash
  uniqueTestId: string;

  smArn: string;
  smRoleArn: string;
  smCanWriteLambdaAslStateString: string;
  smHeadObjectsLambdaAslStateString: string;

  sourceBucket: string;
  workingBucket: string;
  workingBucketPrefixKey: string;
  destinationBucket: string;
};

// the name of the deployed dev Steps that we are testing
// this name corresponds to the name in the dev CDK project (in another folder)
const STACK_NAME = "StepsS3Copy";

/**
 * Shared routine that gets all the details of the state machine we are testing from the outputs of
 * the installed CloudFormation.
 */
export async function testSetup(): Promise<TestSetupState> {
  // The preference would be to pass in the stack name as part of the "node --test STACKNAME" but that doesn't currently
  // seem to be possible - even though argv is settable in the Nodejs test runner run().
  // if (process.argv.length < 3) {
  //  console.error(
  //      "You must launch the test script with the name of the CDK stack to test - the named outputs of the CDK stack will be used to find the resources to test",
  //  );
  //  process.exit(1);
  // }

  const cloudFormationClient = new CloudFormationClient({});
  const sfnClient = new SFNClient({});

  const foundStack = await cloudFormationClient.send(
    new DescribeStacksCommand({
      StackName: STACK_NAME,
    }),
  );

  if (!foundStack.Stacks || foundStack.Stacks.length < 1) {
    throw Error(
      `There is no stack named ${STACK_NAME} that we can find for test setup`,
    );
  }

  // console.log(`Using stack ${foundStack.Stacks[0].StackId}`);

  const stack = foundStack.Stacks[0];

  const getMandatoryStackOutputValue = (stack: Stack, name: string): string => {
    if (!stack.Outputs) {
      throw Error(
        `Deployed stack ${STACK_NAME} must have CloudFormation outputs which we use for resource discovery`,
      );
    }

    const output = stack.Outputs.find((o) => o.OutputKey === name);

    if (!output || !output.OutputValue) {
      throw Error(
        `Deployed stack ${STACK_NAME} must have set named outputs - missing ${name}`,
      );
    }

    return output.OutputValue;
  };

  const smArn = getMandatoryStackOutputValue(stack, "StateMachineArn");
  const smRoleArn = getMandatoryStackOutputValue(stack, "StateMachineRoleArn");
  const smCanWriteLambdaAslStateName = getMandatoryStackOutputValue(
    stack,
    "StateMachineCanWriteLambdaAslStateName",
  );
  const smHeadObjectsLambdaAslStateName = getMandatoryStackOutputValue(
    stack,
    "StateMachineHeadObjectsLambdaAslStateName",
  );
  const sourceBucket = getMandatoryStackOutputValue(stack, "SourceBucket");
  const workingBucket = getMandatoryStackOutputValue(stack, "WorkingBucket");
  const destinationBucket = getMandatoryStackOutputValue(
    stack,
    "DestinationBucket",
  );

  // console.log(`Steps Arn = ${smArn}`);
  // console.log(
  //  `Working S3 Location = ${workingBucket}/${TEST_BUCKET_WORKING_PREFIX}`,
  //);
  // console.log(`Source S3 Bucket = ${sourceBucket}`);
  // console.log(`Destination S3 Bucket = ${destinationBucket}/<test id>/`);

  // the AWS provided Steps test framework processes _ACTUAL_ states definitions - which we don't have
  // on hand because we are using CDK constructs. ALSO, what we really want to test sometimes is the
  // interaction of the Steps state with the lambdas they execute.

  // SO - what we have done here is set it up so we TEST THE DEPLOYED STATE MACHINE - by parsing
  // its definitions
  const smDefinition = await sfnClient.send(
    new DescribeStateMachineCommand({
      stateMachineArn: smArn,
      includedData: "ALL_DATA",
    }),
  );

  const smDefinitionJson = JSON.parse(smDefinition.definition!);

  let smCanWriteLambdaAslStateString;
  let smHeadObjectsLambdaAslStateString;

  const searchForState = (root: any) => {
    if (!root) return;

    for (const [k, v] of Object.entries(root)) {
      if (typeof v === "object") searchForState(v);

      if (k === smCanWriteLambdaAslStateName) {
        smCanWriteLambdaAslStateString = JSON.stringify(v);
      }
      if (k === smHeadObjectsLambdaAslStateName) {
        smHeadObjectsLambdaAslStateString = JSON.stringify(v);
      }
    }
  };

  searchForState(smDefinitionJson["States"]);

  if (!smCanWriteLambdaAslStateString)
    throw Error("Missing state definition for CanWrite lambda");

  if (!smHeadObjectsLambdaAslStateString)
    throw Error("Missing state definition for HeadObjects lambda");

  // console.log(smCanWriteLambdaAslStateString);
  // console.log(smHeadObjectsLambdaAslStateString);

  return {
    uniqueTestId: randomBytes(8).toString("hex"),
    smArn,
    smRoleArn,
    smCanWriteLambdaAslStateString,
    smHeadObjectsLambdaAslStateString,
    sourceBucket,
    workingBucket,
    // we share this definition with the dev deployment - but unfortunately that is in a different
    // typescript project - obviously we need to keep them in sync
    workingBucketPrefixKey: "a-working-folder/",
    destinationBucket,
  };
}
