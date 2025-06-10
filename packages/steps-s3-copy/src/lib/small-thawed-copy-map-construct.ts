import { Construct } from "constructs";
import { Chain, IChainable } from "aws-cdk-lib/aws-stepfunctions";
import { ThawObjectsMapConstruct } from "./thaw-objects-map-construct";
import { SmallObjectsCopyMapConstruct } from "./small-objects-copy-map-construct";
import { IRole } from "aws-cdk-lib/aws-iam";

interface SmallThawedCopyMapProps {
  readonly writerRole: IRole;
  readonly workingBucket: string;
  readonly workingBucketPrefixKey: string;
  readonly inputPath: string;
  readonly mapStateName: string;
  readonly aggressiveTimes?: boolean;
}

export class SmallThawedCopyMapConstruct extends Construct {
  public readonly chain: IChainable;
  public readonly distributedMap;
  public readonly thawStep;
  public readonly copyStep;

  constructor(scope: Construct, id: string, props: SmallThawedCopyMapProps) {
    super(scope, id);

    const thawStep = new ThawObjectsMapConstruct(this, "ThawSmallObjects", {
      writerRole: props.writerRole,
      workingBucket: props.workingBucket,
      workingBucketPrefixKey: props.workingBucketPrefixKey,
      aggressiveTimes: props.aggressiveTimes,
      inputPath: props.inputPath,
      mapStateName: props.mapStateName,
    });

    const copyStep = new SmallObjectsCopyMapConstruct(
      this,
      "CopySmallObjects",
      {
        writerRole: props.writerRole,
        inputPath: props.inputPath,
        maxItemsPerBatch: 128,
        lambdaStateName: "SmallThawedCopyLambda",
        mapStateName: "SmallThawedCopyMap",
      },
    );

    this.chain = Chain.start(thawStep.distributedMap).next(
      copyStep.distributedMap,
    );
    this.distributedMap = copyStep.distributedMap;
    this.thawStep = thawStep;
    this.copyStep = copyStep;
  }
}
