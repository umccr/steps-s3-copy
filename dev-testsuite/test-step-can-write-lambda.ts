import { beforeAll, test, expect } from "bun:test";
import assert from "node:assert";
import { SFNClient, TestStateCommand } from "@aws-sdk/client-sfn";
import {
  testSetup,
  type TestSetupState,
  unitTestSetup,
  type UnitTestSetupState,
} from "./setup";

const sfnClient = new SFNClient({});

let state: TestSetupState;
let unitState: UnitTestSetupState;

beforeAll(async () => {
  state = await testSetup();
  unitState = await unitTestSetup();

  console.log(JSON.stringify(unitState, null, 2));
});

test.serial("basic", async (t) => {
  const testStateResult = await sfnClient.send(
    new TestStateCommand({
      definition: unitState.smCanWriteLambdaAslStateString,
      roleArn: unitState.smRoleArn,
      input: "{}",
      variables: JSON.stringify({
        invokeArguments: {
          destinationBucket: state.workingBucket,
          destinationPrefixKey: "",
        },
        invokeSettings: {
          workingBucket: "abcd",
          workingBucketPrefixKey: "aasd/",
        },
      }),
    }),
  );

  console.log(testStateResult);
});

test.serial("destination bucket in different region", async (t) => {
  const testStateResult = await sfnClient.send(
    new TestStateCommand({
      definition: unitState.smCanWriteLambdaAslStateString,
      roleArn: unitState.smRoleArn,
      input: "{}",
      variables: JSON.stringify({
        invokeArguments: {
          // this is an AWS Open Data repository but one that requires logins for access
          // (there is no way we would ever be able to actually write to this bucket - but the error
          // should occur before we try)
          destinationBucket: "tcga-2-controlled",
          destinationPrefixKey: "abcd/",
        },
        invokeSettings: {
          workingBucket: state.workingBucket,
          workingBucketPrefixKey: state.workingBucketPrefixKey,
        },
      }),
    }),
  );

  expect(
    testStateResult.error === "WrongRegionError",
    "Expected it to throw a Steps WrongRegionError",
  );

  assert(testStateResult.cause);
  expect(
    testStateResult.cause.includes(
      "because destinationBucket was in the wrong region",
    ),
  );
});
