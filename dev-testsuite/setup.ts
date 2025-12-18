import {
  CloudFormationClient,
  DescribeStacksCommand,
  type Stack,
} from "@aws-sdk/client-cloudformation";
import { DescribeStateMachineCommand, SFNClient } from "@aws-sdk/client-sfn";
import { randomBytes } from "node:crypto";
import { TEST_BUCKET_ONE_DAY_PREFIX } from "../dev-constants/constants.ts";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";

export type TestSetupState = {
  // we use a short random hex string for naming folders - as we create objects
  // in a shared bucket where we don't want them to clash
  uniqueTestId: string;

  // the state machine under test
  smArn: string;

  // the settings of the state machine under test
  workingBucket: string;
  workingBucketPrefixKey: string;

  testInstructionsRelative: string;
  testInstructionsAbsolute: string;
  testSrcPrefix: string;
  testDestPrefix: string;
};

export type UnitTestSetupState = {
  smRoleArn: string;
  smCanWriteLambdaAslStateString: string;
  smHeadObjectsLambdaAslStateString: string;
};

/**
 * Find a Steps copier stack by name and return a function that
 * can fetch output values from the stack (used to configure the testing).
 *
 * @param stackName
 */
async function findStack(stackName: string): {
  stack: Stack;
  getMandatoryOutputValue: (s: string) => string;
} {
  const cloudFormationClient = new CloudFormationClient({});
  const foundStack = await cloudFormationClient.send(
    new DescribeStacksCommand({
      StackName: stackName,
    }),
  );

  if (
    !foundStack.Stacks ||
    foundStack.Stacks.length < 1 ||
    !foundStack.Stacks[0]
  ) {
    throw Error(
      `There is no stack named ${stackName} that we can find for test setup`,
    );
  }

  const s = foundStack.Stacks[0];

  return {
    stack: s,
    getMandatoryOutputValue: (name: string): string => {
      if (!s.Outputs) {
        throw Error(
          `Deployed stack ${stackName} must have CloudFormation outputs which we use for resource discovery`,
        );
      }

      const output = s.Outputs.find((o) => o.OutputKey === name);

      if (!output || !output.OutputValue) {
        throw Error(
          `Deployed stack ${stackName} must have set named outputs - missing ${name}`,
        );
      }

      return output.OutputValue;
    },
  };
}

async function getStackName(): string {
  const stsClient = new STSClient({});

  const idResult = await stsClient.send(new GetCallerIdentityCommand({}));

  switch (idResult.Account) {
    case "843407916570":
      return "StepsS3Copy";
    case "455634345446":
      return "Stg-StepsS3CopyStack";
    default:
      throw new Error("Unsupported account for steps copier testing");
  }
}

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

  const stackInstance = findStack(getStackName());

  const smArn = stackInstance.getMandatoryOutputValue("StateMachineArn");
  const workingBucket = stackInstance.getMandatoryOutputValue("WorkingBucket");
  const workingBucketPrefix = stackInstance.getMandatoryOutputValue(
    "WorkingBucketPrefix",
  );

  // console.log(`Steps Arn = ${smArn}`);
  // console.log(
  //  `Working S3 Location = ${workingBucket}/${TEST_BUCKET_WORKING_PREFIX}`,
  //);
  // console.log(`Source S3 Bucket = ${sourceBucket}`);
  // console.log(`Destination S3 Bucket = ${destinationBucket}/<test id>/`);

  const objectsToCopyName = `objects-to-copy.jsonl`;
  const unique = randomBytes(8).toString("hex");

  return {
    uniqueTestId: unique,
    smArn,
    workingBucket,
    workingBucketPrefixKey: workingBucketPrefix,

    // because our instructions must exist in the working folder - we need it
    // both as a relative path (how we will refer to it _within_ the steps)
    // and an absolute path (for use _outside_ our steps)
    testInstructionsRelative: `${unique}/${objectsToCopyName}`,
    testInstructionsAbsolute: `${workingBucketPrefix}${unique}/${objectsToCopyName}`,

    testSrcPrefix: `${TEST_BUCKET_ONE_DAY_PREFIX}${unique}SRC/`,
    testDestPrefix: `${TEST_BUCKET_ONE_DAY_PREFIX}${unique}DEST/`,
  };
}

export async function unitTestSetup(): Promise<UnitTestSetupState> {
  const sfnClient = new SFNClient({});

  const stackInstance = findStack(getStackName());

  const smRoleArn = stackInstance.getMandatoryOutputValue(
    "StateMachineRoleArn",
  );
  const smCanWriteLambdaAslStateName = stackInstance.getMandatoryOutputValue(
    "StateMachineCanWriteLambdaAslStateName",
  );
  const smHeadObjectsLambdaAslStateName = stackInstance.getMandatoryOutputValue(
    "StateMachineHeadObjectsLambdaAslStateName",
  );

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
    smRoleArn,
    smCanWriteLambdaAslStateString,
    smHeadObjectsLambdaAslStateString,
  };
}
