import { waitUntilStateMachineFinishes } from "./steps-waiter.mjs";
import { assertDestinations } from "./assert-destinations.mjs";
import { SFNClient } from "@aws-sdk/client-sfn";
import { WaiterState } from "@smithy/util-waiter";

const sfnClient = new SFNClient({});

export async function triggerAndReturnErrorReport(
  testName: string,
  uniqueTestId: string,
  executionArn: string,
  waitTime: number,
  destinationBucket: string,
  testObjects: any,
  expectedState: WaiterState,
) {
  const executionResult = await waitUntilStateMachineFinishes(
    { client: sfnClient, maxWaitTime: waitTime },
    {
      executionArn: executionArn,
    },
  );

  const objectResults = await assertDestinations(
    uniqueTestId,
    destinationBucket,
    testObjects,
  );

  // we only display details of the test if the state is not what is expected
  // this is a super lame test runner - should use a real one
  if (executionResult.state == expectedState) {
    return {
      testName: testName,
      testSuccess: "✅ YES",
    };
  } else {
    return {
      testName: testName,
      testSuccess: "🚨 NO",
      testExecutionResult: executionResult,
      testObjectResults: objectResults,
    };
  }
}
