import { Construct } from "constructs";
import { Duration } from "aws-cdk-lib";
import { IRole } from "aws-cdk-lib/aws-iam";
import { LambdaInvoke } from "aws-cdk-lib/aws-stepfunctions-tasks";
import {
  DockerImageCode,
  DockerImageFunction,
  Architecture,
} from "aws-cdk-lib/aws-lambda";
import { Platform } from "aws-cdk-lib/aws-ecr-assets";
import { JitterType } from "aws-cdk-lib/aws-stepfunctions";
import { join } from "path";

type Props = {
  readonly writerRole: IRole;
  readonly lambdaStateName: string;
};

/**
 * A construct that defines a LambdaInvoke step for copying a single small S3 object.
 * Intended to be used inside a Distributed Map where each item is handled independently.
 */
export class SmallObjectsCopyStepConstruct extends Construct {
  public readonly step: LambdaInvoke;

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id);

    const code = DockerImageCode.fromImageAsset(
      join(__dirname, "..", "..", "docker", "copy-batch-docker-image"),
      {
        target: "lambda",
        platform: Platform.LINUX_ARM64,
        buildArgs: {
          provenance: "false",
        },
      },
    );

    const copyLambda = new DockerImageFunction(this, "CopySmallObjectLambda", {
      code,
      role: props.writerRole,
      architecture: Architecture.ARM_64,
      memorySize: 128,
      timeout: Duration.minutes(15),
    });

    this.step = new LambdaInvoke(this, props.lambdaStateName, {
      lambdaFunction: copyLambda,
      payloadResponseOnly: true,
    });

    this.step.addRetry({
      errors: ["SlowDown"],
      maxAttempts: 5,
      backoffRate: 2,
      interval: Duration.seconds(30),
      jitterStrategy: JitterType.FULL,
      maxDelay: Duration.minutes(2),
    });
  }
}
