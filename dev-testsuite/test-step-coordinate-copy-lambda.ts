import { before, suite, test } from "node:test";
import assert from "node:assert";
import { SFNClient, TestStateCommand } from "@aws-sdk/client-sfn";
import { testSetup, TestSetupState } from "./setup.js";

const sfnClient = new SFNClient({});

suite("coordinate copy lambda", async () => {
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
});
