import {
  checkExceptions,
  createWaiter,
  WaiterConfiguration,
  WaiterResult,
  WaiterState,
} from "@smithy/util-waiter";
import {
  DescribeExecutionCommand,
  DescribeExecutionInput,
  DescribeExecutionOutput,
  SFNClient,
} from "@aws-sdk/client-sfn";

const checkState = async (
  client: SFNClient,
  input: DescribeExecutionInput,
): Promise<WaiterResult> => {
  let reason: DescribeExecutionOutput | Error;
  try {
    reason = await client.send(new DescribeExecutionCommand(input));

    switch (reason.status) {
      // these are the two active states - keep waiting
      case "RUNNING":
      case "PENDING_REDRIVE":
        return { state: WaiterState.RETRY, reason };
      // other states just match up with the waiter
      case "SUCCEEDED":
        return { state: WaiterState.SUCCESS, reason };
      case "FAILED":
        return { state: WaiterState.FAILURE, reason };
      case "TIMED_OUT":
        return { state: WaiterState.TIMEOUT, reason };
      case "ABORTED":
        return { state: WaiterState.ABORTED, reason };
    }
  } catch (exception: any) {
    // Name Fault Details
    // ExecutionDoesNotExist client The specified execution does not exist.
    // InvalidArn client The provided Amazon Resource Name (ARN) is not valid.
    // KmsAccessDeniedException client Either your KMS key policy or API caller does not have the required permissions.
    // KmsInvalidStateException client The KMS key is not in valid state, for example: Disabled or Deleted.
    // KmsThrottlingException client Received when KMS returns ThrottlingException for a KMS call that Step Functions makes on behalf of the caller.
    // SFNServiceException Base exception class for all service exceptions from SFN service.
    reason = exception;

    if (exception.name && exception.name == "InvalidArn") {
      return { state: WaiterState.FAILURE, reason };
    }
    if (exception.name && exception.name == "ExecutionDoesNotExist") {
      return { state: WaiterState.FAILURE, reason };
    }
  }
  return { state: WaiterState.RETRY, reason };
};

/**
 *
 *  @param params - Waiter configuration options.
 *  @param input - The input to HeadBucketCommand for polling.
 */
export const waitUntilStateMachineFinishes = async (
  params: WaiterConfiguration<SFNClient>,
  input: DescribeExecutionInput,
): Promise<WaiterResult> => {
  const serviceDefaults = { minDelay: 5, maxDelay: 120 };
  const result = await createWaiter(
    { ...serviceDefaults, ...params },
    input,
    checkState,
  );
  return result; // checkExceptions(result);
};
