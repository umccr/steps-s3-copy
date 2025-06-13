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

interface ThawLargeCopyMapProps {
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
/**
 * Two-step construct that restores cold-storage objects and then transfers them using Fargate tasks.
 * Composed of ThawObjectsMapConstruct → CopyMapConstruct (from thaw-objects-map-construct and copy-map-construct)
 */
export class ThawLargeCopyMapConstruct extends Construct {
  public readonly chain: IChainable;
  public readonly distributedMap;
  public readonly thawStep;
  public readonly copyStep;

  constructor(scope: Construct, id: string, props: ThawLargeCopyMapProps) {
    super(scope, id);

    // Step 1: Thaw objects from cold storage using a Lambda-driven distributed map
    const thawStep = new ThawObjectsMapConstruct(this, "ThawLargeObjects", {
      writerRole: props.writerRole,
      workingBucket: props.workingBucket,
      workingBucketPrefixKey: props.workingBucketPrefixKey,
      aggressiveTimes: props.aggressiveTimes,
      inputPath: props.inputPath,
      mapStateName: id,
    });

    // Step 2: Copy thawed large objects using Fargate-based tasks
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

    // Define the execution chain: thaw first, then copy
    this.chain = Chain.start(thawStep.distributedMap).next(
      copyStep.distributedMap,
    );
    this.distributedMap = copyStep.distributedMap;
    this.thawStep = thawStep;
    this.copyStep = copyStep;
  }
}
