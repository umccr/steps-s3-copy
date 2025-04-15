import { before, suite, test } from "node:test";
import assert from "node:assert";
import { SFNClient, TestStateCommand } from "@aws-sdk/client-sfn";
import { testSetup, TestSetupState } from "./setup.js";

const sfnClient = new SFNClient({});

suite("can write lambda", async () => {
  let state: TestSetupState;

  before(async () => {
    state = await testSetup();
  });

  test("basic", async (t) => {
    const testStateResult = await sfnClient.send(
      new TestStateCommand({
        definition: state.smCanWriteLambdaAslStateString,
        roleArn: state.smRoleArn,
        input: "{}",
        variables: JSON.stringify({
          invokeArguments: {
            destinationBucket: state.destinationBucket,
            destinationPrefixKey: "",
          },
          invokeSettings: {
            workingBucket: "abcd",
            workingBucketPrefixKey: "aasd/",
          },
        }),
      }),
    );
  });

  test("destination bucket in different region", async (t) => {
    const testStateResult = await sfnClient.send(
      new TestStateCommand({
        definition: state.smCanWriteLambdaAslStateString,
        roleArn: state.smRoleArn,
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

    assert(
      testStateResult.error === "WrongRegionError",
      "Expected it to throw a Steps WrongRegionError",
    );

    assert(testStateResult.cause);
    assert(
      testStateResult.cause.includes(
        "because destinationBucket was in the wrong region",
      ),
    );
  });
});
