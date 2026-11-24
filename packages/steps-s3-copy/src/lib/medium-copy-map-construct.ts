import { Construct } from "constructs";
import { IRole } from "aws-cdk-lib/aws-iam";
import { LambdaCopyMapConstruct } from "./lambda-copy-map-construct";

/**
 * Default memory in MiB for the medium-object copy Lambda. This is the maximum Lambda memory
 * as network bandwidth scales with memory (and the copies are network bound).
 * Keep in sync with MEDIUM_LAMBDA_MEMORY_MB in lambda/common/constants.ts
 */
export const DEFAULT_MEDIUM_COPY_MEMORY_SIZE_MIB = 10240;

type Props = {
  readonly writerRole: IRole;
  readonly inputPath: string;
  readonly memorySize?: number;
  readonly addThawStep?: boolean;
  readonly aggressiveTimes?: boolean;
};

/**
 * A construct that creates a Steps Distributed Map for performing
 * copies of medium sized files (gigabyte range) using a high memory Lambda.
 *
 * It uses the generic Lambda copy template with a high memory (hence high network
 * bandwidth) Lambda, and its own batch size and concurrency performance settings.
 */
export class MediumObjectsCopyMapConstruct extends LambdaCopyMapConstruct {
  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, {
      ...props,
      memorySize: props.memorySize ?? DEFAULT_MEDIUM_COPY_MEMORY_SIZE_MIB,
      batchSizeArg: "mediumCopyBatchSize",
      concurrencyArg: "mediumCopyConcurrency",
    });
  }
}
