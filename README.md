# Steps S3 Copy

A CDK construct which enables large scale parallel copying of objects between object stores.

## Development

See [DEV](./DEV.md).

## Use

### Installing the CDK construct

The CDK construct is published as an `npm` package.

An example of the use of the CDK construct is in the `dev` project. It
deploys an example CDK to an arbitrary account - though small changes may need to be
made to make it compatible with your VPC environment.

The configurable properties of the construct itself are:

```typescript
export interface StepsS3CopyConstructProps {
  /**
   * The VPC that any associated compute will be executed in
   */
  readonly vpc: IVpc;

  /**
   * The VPC subnet that will be used for compute units (would generally
   * be "private with egress" - but should work with others if properly
   * configured).
   */
  readonly vpcSubnetSelection: SubnetType;

  /**
   * If present, sets the fixed name of the role that will perform all the S3 operations
   * in the target bucket account. This parameter exists because
   * destination organisations may want a specifically *named*
   * principal for target bucket resource policies.
   *
   * If undefined, CDK will choose the role name.
   */
  readonly writerRoleName?: string;

  /**
   * A bucket in the installation account that will be used for working
   * artifacts such as temporary files, distributed maps outputs etc.
   * These objects will be small, but the bucket can be set with a
   * lifecycle to delete the objects after 30 days (or however long the
   * maximum copy operation may be set to)
   */
  readonly workingBucket: string;

  /**
   * A prefix in the workingBucket that will be used for all artifacts
   * created. Note that the prefix can be something simple such as "temp".
   * The copy out stack will handle making sure there is enough
   * uniqueness in artifacts that they don't clash.
   *
   * If undefined or the empty string, then artifacts will be created in the root
   * of the bucket.
   */
  readonly workingBucketPrefixKey?: string;

  /**
   * Whether the stack should use duration/timeouts that are more suited
   * to demonstration/development. i.e. minutes rather than hours for polling intervals,
   * hours rather than days for copy time-outs.
   */
  readonly aggressiveTimes?: boolean;

  /**
   * Whether the stack should be given any permissions to copy data into
   * the same account it is installed into. For demonstration/development
   * this might be useful - but in general this should be not set - as the
   * primary use case is to copy objects "out" of the account/buckets.
   */
  readonly allowWriteToInstalledAccount?: boolean;
}
```

### Create the set of "copy instructions"

In order to allow copying objects at the scale we expect - the input list of objects to copy (the "copy instructions")
is created as a JSONL formatted object that is stored in the `workingBucket`/`workingBucketPrefixKey`.

Each individual "copy instruction" meets the following schema

```typescript
export type CopyInstruction = {
  // source bucket for object
  sourceBucket: string;

  // key of object or (key + "/*") to indicate a folder
  sourceKey: string;

  // if present, access the source bucket/key anonymously
  sourceNoSignRequest?: boolean;

  // a SUMS checksum definition we are asserting about this object
  // if not present then default to no assertions about checksums.
  // specifying a sums is incompatible with a wildcard sourceKey as sums
  // are checksums for specific objects, not folders
  sums?: string;

  // if present, indicates the portion of the sourceKey that is the root of the folder
  // structure that should be copied. This affects how destination folders are calculated..
  sourceRootFolderKey?: string;

  // -- OR --

  // if present, a folder(s) path to relatively add to destination path prefix (if any)
  destinationRelativeFolderKey?: string;
};
```

Note that by default copy instructions will place objects directly into the destination bucket
and destination folder (see "Invoking" below). That is, the directory structure of the
source objects will not be replicated into the destination - just the base file name.

However, the instructions have two fields that can be used to create directory
structures in the destination (only one of which can be used on any single copy instruction).

### Invoking the Steps orchestration

Once the copy instructions file is created, it should be uploaded to the working bucket. The steps
orchestration can then be invoked with the following input schema.

```typescript
export type StepsS3CopyInvokeArguments = {
  /**
   * The region that source buckets MUST be in.
   *
   * If undefined, will default to the region that the orchestration is installed into.
   */
  readonly sourceRequiredRegion?: string;

  /**
   * The region that destination bucket MUST be in.
   *
   * If undefined, will default to the region that the orchestration is installed into.
   */
  readonly destinationRequiredRegion?: string;

  /**
   * The relative path name (relative to the `workingBucketPrefixKey` of the CDK construct)
   * to a JSONL of "copy instructions". Each "copy instruction" is a JSONL line
   * according to a
   *
   * TODO: NOTE: we need to rename this field!!!
   */
  readonly sourceFilesCsvKey: string;

  /**
   * The destination bucket to copy the objects.
   */
  readonly destinationBucket: string;

  /**
   * A slash terminated folder key in which to root the destination
   * objects, or "" to mean place objects in the root of the bucket.
   */
  readonly destinationFolderKey: string;

  readonly copyConcurrency: number;
  readonly maxItemsPerBatch: number;

  readonly destinationStartCopyRelativeKey: string;
  readonly destinationEndCopyRelativeKey: string;

  /**
   * If present and true, instructs the copier to go through the motions of
   * doing a copy (including checking for existence of all the objects) - but not
   * actually perform the copy.
   */
  readonly dryRun?: boolean;
};
```

Note that the `sourceFilesCsvKey` is actually the JSONL of copy instructions - and is a path
_that is relative_ to the working folder.

For instance if we uploaded the JSONL to `s3://my-working-bucket/a-working-folder/instructions.jsonl`, we would
specify a `sourceFilesCsvKey` of `instructions.jsonl`.
