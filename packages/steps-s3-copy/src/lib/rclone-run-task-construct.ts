import { Construct } from "constructs";
import { IRole } from "aws-cdk-lib/aws-iam";
import {
  IntegrationPattern,
  JsonPath,
  Timeout,
} from "aws-cdk-lib/aws-stepfunctions";
import { Duration } from "aws-cdk-lib";
import {
  ContainerDefinition,
  FargatePlatformVersion,
  ICluster,
  TaskDefinition,
} from "aws-cdk-lib/aws-ecs";
import {
  EcsFargateLaunchTargetOptions,
  EcsLaunchTargetConfig,
  EcsRunTask,
  IEcsLaunchTarget,
  LaunchTargetBindOptions,
} from "aws-cdk-lib/aws-stepfunctions-tasks";
import { SubnetType } from "aws-cdk-lib/aws-ec2";

type Props = {
  readonly fargateCluster: ICluster;
  readonly vpcSubnetSelection: SubnetType;

  readonly writerRole: IRole;

  readonly taskDefinition: TaskDefinition;
  readonly containerDefinition: ContainerDefinition;

  /**
   * If present and true, will set some of our default timings to those that
   * are more likely in a dev/test scenario rather than production. i.e. timeouts
   * of hours not days etc.
   */
  readonly aggressiveTimes?: boolean;

  /**
   * If true, will allow the run task to copy to a sourceBucket that is
   * in the same account. Otherwise, and by default, the copy task
   * is set up to not be able to copy to a sourceBucket in the same account as it
   * is installed. This is a security mechanism as writes to buckets in the
   * same account is allowed implicitly but is dangerous. This should only
   * be set to true for development/testing.
   */
  //allowWriteToThisAccount?: boolean; WIP NEED TO IMPLEMENT
};

export class RcloneRunTaskConstruct extends Construct {
  public readonly ecsRunTask: EcsRunTask;

  // how long we will wait before aborting if no heartbeat received
  // (note: the actual heartbeat interval is _less_ than this)
  private readonly HEARTBEAT_TIMEOUT_SECONDS = 30;

  // how long we set as the absolute upper limit for an rclone execution
  // (note: this really is just an absolute safeguard against something somehow
  //  running forever - though there are other timeouts like the overall Steps timeout that
  //  presumably will kick-in before this)
  private readonly RCLONE_TIMEOUT_HOURS = 48;

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id);

    // https://github.com/aws/aws-cdk/issues/20013
    this.ecsRunTask = new EcsRunTask(this, id + "CopyTask", {
      // we use task tokens as we want to return rclone stats/results
      integrationPattern: IntegrationPattern.WAIT_FOR_TASK_TOKEN,
      cluster: props.fargateCluster,
      taskDefinition: props.taskDefinition,
      launchTarget: new EcsFargateNotSpotLaunchTarget({
        platformVersion: FargatePlatformVersion.VERSION1_4,
      }),
      subnets: {
        subnetType: props.vpcSubnetSelection,
      },
      // max length for the overall copy - so think big - this might be 64 invocations of
      // copying a 100 GiB BAM file say...
      taskTimeout: Timeout.duration(Duration.hours(this.RCLONE_TIMEOUT_HOURS)),
      // how many seconds we can go without hearing from the rclone task
      heartbeatTimeout: Timeout.duration(
        Duration.seconds(this.HEARTBEAT_TIMEOUT_SECONDS),
      ),
      // resultPath: "$.rcloneResult",
      containerOverrides: [
        {
          containerDefinition: props.containerDefinition,
          command: JsonPath.listAt("$.Items[*].rcloneSource"),
          environment: [
            {
              name: "RB_DESTINATION",
              // note this might be just a sourceBucket name, or a sourceBucket name with path
              // (that decision is made higher in the stack)
              // as far as rclone binary itself is concerned, it does not matter
              value: JsonPath.stringAt("$.BatchInput.rcloneDestination"),
            },
            {
              name: "RB_TASK_TOKEN",
              value: JsonPath.stringAt("$$.Task.Token"),
            },
            {
              name: "RB_TASK_TOKEN_HEARTBEAT_SECONDS_INTERVAL",
              // we want to attempt to do the heartbeat some factor more often than the actual timeout
              value: Math.floor(this.HEARTBEAT_TIMEOUT_SECONDS / 3).toString(),
            },
          ],
        },
      ],
    });
  }
}

/*class EcsFargateSpotOnlyLaunchTarget implements IEcsLaunchTarget {
  constructor(private readonly options?: EcsFargateLaunchTargetOptions) {}

  public bind(
    _task: EcsRunTask,
    launchTargetOptions: LaunchTargetBindOptions,
  ): EcsLaunchTargetConfig {
    if (!launchTargetOptions.taskDefinition.isFargateCompatible) {
      throw new Error("Supplied TaskDefinition is not compatible with Fargate");
    }

    return {
      parameters: {
        PlatformVersion: this.options?.platformVersion,
        CapacityProviderStrategy: [
          {
            CapacityProvider: "FARGATE_SPOT",
            Weight: 1000
          },
          {
            CapacityProvider: "FARGATE",
            Weight: 0
          }
        ],
        // naughty - this is really nothing to do with LaunchType but this is a way
        // we can set properties in the Steps Run Task ASL
        // in this case we want to be able to track compute used so we propagate
        // through the tags from the task definition (which will come from the Stack/Construct)
        PropagateTags: "TASK_DEFINITION",
      },
    };
  }
} */

class EcsFargateNotSpotLaunchTarget implements IEcsLaunchTarget {
  constructor(private readonly options?: EcsFargateLaunchTargetOptions) {}

  /**
   * Called when the Fargate launch type configured on RunTask
   */
  public bind(
    _task: EcsRunTask,
    launchTargetOptions: LaunchTargetBindOptions,
  ): EcsLaunchTargetConfig {
    if (!launchTargetOptions.taskDefinition.isFargateCompatible) {
      throw new Error("Supplied TaskDefinition is not compatible with Fargate");
    }

    return {
      parameters: {
        PlatformVersion: this.options?.platformVersion,
        CapacityProviderStrategy: [
          {
            CapacityProvider: "FARGATE",
            Weight: 1000,
          },
        ],
        // naughty - this is really nothing to do with LaunchType but this is a way
        // we can set properties in the Steps Run Task ASL
        // in this case we want to be able to track compute used so we propagate
        // through the tags from the task definition (which will come from the Stack/Construct)
        PropagateTags: "TASK_DEFINITION",
      },
    };
  }
}

/*
An example output from an ECS runtask

{
  "Attachments": [
    {
      "Details": [
        {
          "Name": "subnetId",
          "Value": "subnet-035b8252d7f6edee1"
        },
        {
          "Name": "networkInterfaceId",
          "Value": "eni-077e4eb4385083b95"
        },
        {
          "Name": "macAddress",
          "Value": "06:9a:85:f4:35:d8"
        },
        {
          "Name": "privateDnsName",
          "Value": "ip-10-0-64-84.ap-southeast-2.compute.internal"
        },
        {
          "Name": "privateIPv4Address",
          "Value": "10.0.64.84"
        }
      ],
      "Id": "c06f9ba6-3cfb-472a-bbd2-a02cf5d3ef4d",
      "Status": "DELETED",
      "Type": "eni"
    }
  ],
  "Attributes": [
    {
      "Name": "ecs.cpu-architecture",
      "Value": "x86_64"
    }
  ],
  "AvailabilityZone": "ap-southeast-2b",
  "CapacityProviderName": "FARGATE_SPOT",
  "ClusterArn": "arn:aws:ecs:ap-southeast-2:602836945884:cluster/ElsaDataAgCopyOutStack-FargateCluster7CCD5F93-Fqt1RPmV8sGS",
  "Connectivity": "CONNECTED",
  "ConnectivityAt": 1680596446117,
  "Containers": [
    {
      "ContainerArn": "arn:aws:ecs:ap-southeast-2:602836945884:container/ElsaDataAgCopyOutStack-FargateCluster7CCD5F93-Fqt1RPmV8sGS/2696321ed56a477d9fc75f7e4f037ba2/3d49f64d-56af-4106-b027-40c1cd407b66",
      "Cpu": "0",
      "ExitCode": 0,
      "GpuIds": [],
      "Image": "602836945884.dkr.ecr.ap-southeast-2.amazonaws.com/cdk-hnb659fds-container-assets-602836945884-ap-southeast-2:307e4b58f91d748a9d6c233f7e04e6bcd5e19f27290a4481c2e007cc25a2ae93",
      "ImageDigest": "sha256:REDACTED",
      "LastStatus": "STOPPED",
      "ManagedAgents": [],
      "Name": "RcloneContainer",
      "NetworkBindings": [],
      "NetworkInterfaces": [
        {
          "AttachmentId": "c06f9ba6-3cfb-472a-bbd2-a02cf5d3ef4d",
          "PrivateIpv4Address": "10.0.64.84"
        }
      ],
      "RuntimeId": "ABCD-123",
      "TaskArn": "arn:aws:ecs:ap-southeast-2:602836945884:task/ElsaDataAgCopyOutStack-FargateCluster7CCD5F93-Fqt1RPmV8sGS/2696321ed56a477d9fc75f7e4f037ba2"
    }
  ],
  "Cpu": "256",
  "CreatedAt": 1680596442871,
  "DesiredStatus": "STOPPED",
  "EnableExecuteCommand": false,
  "EphemeralStorage": {
    "SizeInGiB": 20
  },
  "ExecutionStoppedAt": 1680596471735,
  "Group": "family:ElsaDataAgCopyOutStackCopyOutRcloneFargateTaskTdC05A385E",
  "InferenceAccelerators": [],
  "LastStatus": "STOPPED",
  "LaunchType": "FARGATE",
  "Memory": "512",
  "Overrides": {
    "ContainerOverrides": [
      {
        "Command": [
          "s3:sourceBucket:1.fastq.gz",
          "s3:sourceBucket:2.fastq.gz",
          "s3:sourceBucket:3.fastq.gz",
          "s3:sourceBucket:4.fastq.gz"
        ],
        "Environment": [
          {
            "Name": "destination",
            "Value": "s3:sourceBucket-at-destination"
          }
        ],
        "EnvironmentFiles": [],
        "Name": "RcloneContainer",
        "ResourceRequirements": []
      }
    ],
    "InferenceAcceleratorOverrides": []
  },
  "PlatformVersion": "1.4.0",
  "PullStartedAt": 1680596461639,
  "PullStoppedAt": 1680596463273,
  "StartedAt": 1680596463814,
  "StartedBy": "AWS Step Functions",
  "StopCode": "EssentialContainerExited",
  "StoppedAt": 1680596504771,
  "StoppedReason": "Essential container in task exited",
  "StoppingAt": 1680596481818,
  "Tags": [],
  "TaskArn": "arn:aws:ecs:ap-southeast-2:602836945884:task/ElsaDataAgCopyOutStack-FargateCluster7CCD5F93-Fqt1RPmV8sGS/2696321ed56a477d9fc75f7e4f037ba2",
  "TaskDefinitionArn": "arn:aws:ecs:ap-southeast-2:602836945884:task-definition/ElsaDataAgCopyOutStackCopyOutRcloneFargateTaskTdC05A385E:1",
  "Version": 5
}
 */
