import { Construct } from "constructs";
import { Chain, IChainable } from "aws-cdk-lib/aws-stepfunctions";
import { ThawObjectsMapConstruct } from "./thaw-objects-map-construct";
import { CopyMapConstruct } from "./copy-map-construct";
import { IRole } from "aws-cdk-lib/aws-iam";
import { SubnetType } from "aws-cdk-lib/aws-ec2";
import {
  ICluster,
  TaskDefinition,
  ContainerDefinition,
} from "aws-cdk-lib/aws-ecs";

interface LargeThawedCopyMapProps {
  readonly writerRole: IRole;
  readonly workingBucket: string;
  readonly workingBucketPrefixKey: string;
  readonly inputPath: string;
  readonly aggressiveTimes?: boolean;

  readonly cluster: ICluster;
  readonly clusterVpcSubnetSelection: SubnetType;
  readonly taskDefinition: TaskDefinition;
  readonly containerDefinition: ContainerDefinition;

  readonly maxItemsPerBatch: number;
  readonly maxConcurrency: number;
}

export class LargeThawedCopyMapConstruct extends Construct {
  public readonly chain: IChainable;
  public readonly distributedMap;
  public readonly thawStep;
  public readonly copyStep;

  constructor(scope: Construct, id: string, props: LargeThawedCopyMapProps) {
    super(scope, id);

    const thawStep = new ThawObjectsMapConstruct(this, "ThawLargeObjects", {
      writerRole: props.writerRole,
      workingBucket: props.workingBucket,
      workingBucketPrefixKey: props.workingBucketPrefixKey,
      aggressiveTimes: props.aggressiveTimes,
      inputPath: props.inputPath,
      mapStateName: `${id}`,
    });

    const copyStep = new CopyMapConstruct(this, "CopyLargeObjects", {
      writerRole: props.writerRole,
      inputPath: props.inputPath,
      cluster: props.cluster,
      clusterVpcSubnetSelection: props.clusterVpcSubnetSelection,
      taskDefinition: props.taskDefinition,
      containerDefinition: props.containerDefinition,
      maxItemsPerBatch: props.maxItemsPerBatch,
      maxConcurrency: props.maxConcurrency,
    });

    this.chain = Chain.start(thawStep.distributedMap).next(
      copyStep.distributedMap,
    );
    this.distributedMap = copyStep.distributedMap;
    this.thawStep = thawStep;
    this.copyStep = copyStep;
  }
}
