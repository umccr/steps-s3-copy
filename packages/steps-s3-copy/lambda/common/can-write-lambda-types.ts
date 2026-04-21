import type { StepsS3CopyInvokeArguments } from "../../src/steps-s3-copy-input";
import type { StepsS3CopyInvokeSettings } from "../../src/steps-s3-copy-construct";

export type CanWriteLambdaInvokeEvent = {
  invokeArguments: StepsS3CopyInvokeArguments;
  invokeSettings: StepsS3CopyInvokeSettings;
};

export type CanWriteLambdaResult = {};
