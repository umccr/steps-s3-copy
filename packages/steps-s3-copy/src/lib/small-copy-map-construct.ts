import { Construct } from "constructs";
import { IRole } from "aws-cdk-lib/aws-iam";
import { LambdaCopyMapConstruct } from "./lambda-copy-map-construct";

/**
 * Default memory in MiB for the small-object copy Lambda.
 * Keep in sync with SMALL_LAMBDA_MEMORY_MB in lambda/common/constants.ts
 */
export const DEFAULT_SMALL_COPY_MEMORY_SIZE_MIB = 128;

type Props = {
  readonly writerRole: IRole;
  readonly inputPath: string;
  readonly memorySize?: number;
  readonly addThawStep?: boolean;
  readonly aggressiveTimes?: boolean;
};

/**
 * A construct that creates a Steps Distributed Map for performing
 * copies of small files (many per Lambda invocation, low memory).
 */
export class SmallObjectsCopyMapConstruct extends LambdaCopyMapConstruct {
  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, {
      ...props,
      memorySize: props.memorySize ?? DEFAULT_SMALL_COPY_MEMORY_SIZE_MIB,
      batchSizeArg: "smallCopyBatchSize",
      concurrencyArg: "smallCopyConcurrency",
    });
  }
}
