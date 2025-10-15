import { StepsS3CopyConstruct } from "steps-s3-copy";
import { TEST_BUCKET_ONE_DAY_PREFIX } from "../dev-constants/constants";
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

// Our working sourceBucket can perform in a sub-folder. You can test that
// functionality out with e.g. const WORKING_BUCKET_PREFIX = "a-working-folder/";
const WORKING_BUCKET_PREFIX = "";

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
    // then need to do that in another sourceBucket
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
      // whilst we don't want to keep any objects and can feel free to delete
      // these buckets, given the lifecycle rules they will generally be empty anyway
      // (setting autoDeleteObjects adds extra lambda/roles that clog everything up)
      autoDeleteObjects: false,
    });

    const workingBucket = new Bucket(this, "Working", {
      versioned: false,
      lifecycleRules: [
        // the working bucket holds manifests and reports of copies - which all tend to be small files
        // so we find it useful to keep them around for a bit
        {
          enabled: true,
          expiration: Duration.days(30),
          abortIncompleteMultipartUploadAfter: Duration.days(1),
        },
        // if we do some testing we may create objects in the working bucket
        // so we have a prefix that ensures they don't hang around
        {
          enabled: true,
          prefix: TEST_BUCKET_ONE_DAY_PREFIX,
          expiration: Duration.days(1),
          abortIncompleteMultipartUploadAfter: Duration.days(1),
        },
      ],
      removalPolicy: RemovalPolicy.DESTROY,
      // whilst we don't want to keep any objects and can feel free to delete
      // these buckets, given the lifecycle rules they will generally be empty anyway
      // (setting autoDeleteObjects adds extra lambda/roles that clog everything up)
      autoDeleteObjects: false,
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
      // whilst we don't want to keep any objects and can feel free to delete
      // these buckets, given the lifecycle rules they will generally be empty anyway
      // (setting autoDeleteObjects adds extra lambda/roles that clog everything up)
      autoDeleteObjects: false,
    });

    const stepsS3Copy = new StepsS3CopyConstruct(this, "StepsS3Copy", {
      vpc: vpc,
      // note for dev we use a public subnet as that is most likely to always be available in a default VPC
      vpcSubnetSelection: SubnetType.PUBLIC,
      workingBucket: workingBucket.bucketName,
      workingBucketPrefixKey: WORKING_BUCKET_PREFIX,
      aggressiveTimes: true,
      writerRoleName: "steps-s3-copy-role",
      allowWriteToInstalledAccount: true,
    });

    new CfnOutput(this, "StateMachineArn", {
      value: stepsS3Copy.stateMachine.stateMachineArn,
    });
    new CfnOutput(this, "StateMachineRoleArn", {
      value: stepsS3Copy.stateMachine.role.roleArn,
    });
    new CfnOutput(this, "StateMachineCanWriteLambdaAslStateName", {
      value: stepsS3Copy.canWriteLambdaAslStateName,
    });
    new CfnOutput(this, "StateMachineHeadObjectsLambdaAslStateName", {
      value: stepsS3Copy.headObjectsLambdaAslStateName,
    });
    new CfnOutput(this, "SourceBucket", {
      value: sourceBucket.bucketName,
    });
    new CfnOutput(this, "WorkingBucket", {
      value: workingBucket.bucketName,
    });
    new CfnOutput(this, "WorkingBucketPrefix", {
      value: WORKING_BUCKET_PREFIX,
    });
    new CfnOutput(this, "DestinationBucket", {
      value: destinationBucket.bucketName,
    });
  }
}

new StepsS3CopyStack(app, "StepsS3Copy", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  description: description,
});
