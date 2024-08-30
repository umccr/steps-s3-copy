import { StepsS3CopyConstruct } from "steps-s3-copy";
import { SubnetType, Vpc } from "aws-cdk-lib/aws-ec2";
import {
  App,
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  StackProps,
} from "aws-cdk-lib";
import { Construct } from "constructs";
import { Bucket } from "aws-cdk-lib/aws-s3";

const app = new App();

const description = "A steps orchestration for S3 object copying";

// our working bucket can perform in a sub-folder so we do that to test that
// functionality out
const WORKING_BUCKET_PREFIX = "a-working-folder/";

/**
 * Development test deployment of the Steps S3 Copy functionality.
 */
class StepsS3CopyStack extends Stack {
  constructor(scope?: Construct, id?: string, props?: StackProps) {
    super(scope, id, props);

    // use the basic UMCCR vpc
    const vpc = Vpc.fromLookup(this, "VPC", {
      vpcName: "main-vpc",
    });

    // we constantly create temporary files here as part of the test suite
    // and we want them to autoexpire
    // if you want to set up permanent demonstrations/tests for copying
    // then need to do that in another bucket
    const sourceBucket = new Bucket(this, "Source", {
      versioned: false,
      lifecycleRules: [
        {
          enabled: true,
          expiration: Duration.days(1),
          abortIncompleteMultipartUploadAfter: Duration.days(1),
        },
      ],
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true
    });

    const workingBucket = new Bucket(this, "Working", {
      versioned: false,
      lifecycleRules: [
        {
          enabled: true,
          expiration: Duration.days(1),
          abortIncompleteMultipartUploadAfter: Duration.days(1),
        },
      ],
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true
    });

    const destinationBucket = new Bucket(this, "Destination", {
      versioned: false,
      lifecycleRules: [
        {
          enabled: true,
          expiration: Duration.days(1),
          abortIncompleteMultipartUploadAfter: Duration.days(1),
        },
      ],
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true
    });

    const stepsS3Copy = new StepsS3CopyConstruct(this, "StepsS3Copy", {
      vpc: vpc,
      vpcSubnetSelection: SubnetType.PRIVATE_WITH_EGRESS,
      workingBucket: workingBucket.bucketName,
      workingBucketPrefixKey: WORKING_BUCKET_PREFIX,
      aggressiveTimes: true,
      writerRoleName: "umccr-wehi-data-sharing-role",
      allowWriteToInstalledAccount: true,
    });

    new CfnOutput(this, "StateMachineArn", {
      value: stepsS3Copy.stateMachine.stateMachineArn,
    });
    new CfnOutput(this, "SourceBucket", {
      value: sourceBucket.bucketName,
    });
    new CfnOutput(this, "WorkingBucket", {
      value: workingBucket.bucketName,
    });
    new CfnOutput(this, "DestinationBucket", {
      value: destinationBucket.bucketName,
    });
  }
}

new StepsS3CopyStack(app, "StepsS3Copy", {
  // the stack can only be deployed to 'dev'
  env: {
    account: "843407916570",
    region: "ap-southeast-2",
  },
  tags: {
    "umccr-org:Product": "StepsS3Copy",
    "umccr-org:Stack": "StepsS3Copy",
  },
  description: description,
});
