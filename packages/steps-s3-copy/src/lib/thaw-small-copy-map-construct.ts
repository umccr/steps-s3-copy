import { Construct } from "constructs";
import { Chain, IChainable } from "aws-cdk-lib/aws-stepfunctions";
import { ThawObjectsMapConstruct } from "./thaw-objects-map-construct";
import { SmallObjectsCopyMapConstruct } from "./small-objects-copy-map-construct";
import { IRole } from "aws-cdk-lib/aws-iam";

interface ThawSmallCopyMapProps {
  readonly writerRole: IRole;
  readonly workingBucket: string;
  readonly workingBucketPrefixKey: string;
  readonly inputPath: string;
  readonly aggressiveTimes?: boolean;
}
/**
 * Two-step construct that restores cold-storage objects and then transfers them in batches using Lambda.
 * Composed of ThawObjectsMapConstruct → SmallObjectsCopyMapConstruct (from thaw-objects-map-construct and small-objects-copy-map-construct)
 */
export class ThawSmallCopyMapConstruct extends Construct {
  public readonly chain: IChainable;
  public readonly distributedMap;
  public readonly thawStep;
  public readonly copyStep;

  constructor(scope: Construct, id: string, props: ThawSmallCopyMapProps) {
    super(scope, id);

    // Step 1: Thaw objects from cold storage using a Lambda-driven distributed map
    const thawStep = new ThawObjectsMapConstruct(this, "ThawSmallObjects", {
      writerRole: props.writerRole,
      workingBucket: props.workingBucket,
      workingBucketPrefixKey: props.workingBucketPrefixKey,
      aggressiveTimes: props.aggressiveTimes,
      inputPath: props.inputPath,
      mapStateName: id,
    });

    // Step 2: Copy thawed small objects in batches using a Lambda-based copy construct
    const copyStep = new SmallObjectsCopyMapConstruct(
      this,
      "CopySmallObjects",
      {
        writerRole: props.writerRole,
        inputPath: props.inputPath,
        maxItemsPerBatch: 128,
        lambdaStateName: "SmallThawedCopyLambda",
      },
    );

    // Define the execution chain: thaw first, then copy
    this.chain = Chain.start(thawStep.distributedMap).next(
      copyStep.distributedMap,
    );
    this.distributedMap = copyStep.distributedMap;
    this.thawStep = thawStep;
    this.copyStep = copyStep;
  }
}
