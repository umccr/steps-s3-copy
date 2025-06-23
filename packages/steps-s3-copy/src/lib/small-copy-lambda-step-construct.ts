import { Construct } from "constructs";
import { Duration } from "aws-cdk-lib";
import { IRole } from "aws-cdk-lib/aws-iam";
import { LambdaInvoke } from "aws-cdk-lib/aws-stepfunctions-tasks";
import {
  DockerImageCode,
  DockerImageFunction,
  Architecture,
  Function,
} from "aws-cdk-lib/aws-lambda";
import { Platform } from "aws-cdk-lib/aws-ecr-assets";
import { JitterType } from "aws-cdk-lib/aws-stepfunctions";
import { join } from "path";

type Props = {
  readonly writerRole: IRole;
  readonly lambdaStateName: string;
};

export class SmallObjectsCopyLambdaStepConstruct extends Construct {
  public readonly invocableLambda;
  public readonly lambda: Function;
  public readonly lambdaFunction: Function;
  public readonly stateName: string;

  constructor(
    scope: Construct,
    id: string,
    props: Props & { lambdaStateName: string },
  ) {
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

    this.lambda = new DockerImageFunction(this, "SmallObjectsCopyFunction", {
      role: props.writerRole,
      code: code,
      architecture: Architecture.ARM_64,
      memorySize: 128,
      timeout: Duration.minutes(15),
    });

    this.lambdaFunction = this.lambda;
    this.stateName = props.lambdaStateName;

    this.invocableLambda = new LambdaInvoke(this, this.stateName, {
      lambdaFunction: this.lambda,
      payloadResponseOnly: true,
    });

    this.invocableLambda.addRetry({
      errors: ["SlowDown"],
      maxAttempts: 5,
      backoffRate: 2,
      interval: Duration.seconds(30),
      jitterStrategy: JitterType.FULL,
      maxDelay: Duration.minutes(2),
    });
  }
}
