# Steps S3 Copy

A CDK construct which creates a standalone service for large-scale parallel
copying of objects between object stores.

The origin of the service is the world of genomic datasets, which involve
transferring terabytes of large (10 GiB+) objects between object stores.
However, there is nothing inherently restricting the service from working
with all types of objects, big or small.

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

In order to allow copying objects at the scale we expect (potentially millions of objects) - the input
list of objects to copy (the "copy instructions")
is created as a JSONL formatted text file. That file must be
stored in `workingBucket`/`workingBucketPrefixKey`/... .

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

  /**
   * Optional thawing parameters. Missing `thawParams` is normalised to `{}` by the state machine,
   * and per-field defaults are applied by the thaw step Lambda (`*ThawDays` = 1, `*ThawSpeed` = "Bulk").
   */
  readonly thawParams?: {
    readonly glacierFlexibleRetrievalThawDays?: number;
    readonly glacierFlexibleRetrievalThawSpeed?: string;

    readonly glacierDeepArchiveThawDays?: number;
    readonly glacierDeepArchiveThawSpeed?: string;

    readonly intelligentTieringArchiveThawDays?: number;
    readonly intelligentTieringArchiveThawSpeed?: string;

    readonly intelligentTieringDeepArchiveThawDays?: number;
    readonly intelligentTieringDeepArchiveThawSpeed?: string;
  };
};
```

Note that the `sourceFilesCsvKey` is actually the JSONL of copy instructions - and is a path
_that is relative_ to the working folder.

For instance if we uploaded the JSONL copy
instructions to `s3://my-working-bucket/a-working-folder/instructions.jsonl`, we would
specify a `sourceFilesCsvKey` of `instructions.jsonl`.

## Thawing objects from cold storage

S3 objects stored in cold or archival tiers (Glacier, Deep Archive, or Intelligent-Tiering archive tiers)
cannot be copied immediately, so the service can request a restore (thaw) before attempting the copy.

Whether thawing is required is determined during the coordinate / classification phase of the workflow.
The CoordinateCopy step classifies each object by size (using a 5 MiB threshold, the minimum S3 multipart
upload part size) and storage class. Each group is written as a separate copy set (JSONL file) in the
working bucket, with objects requiring restore placed into dedicated sets:

- `smallThaw` / `largeThaw`: must be thawed first, then copied
- `small` / `large`: can be copied immediately

The workflow then runs four distributed maps in parallel (small/large plus thawed variants), and the thawed copy paths execute a thaw step before copying.

### Thawing behaviour

The same thawing logic is applied to both small and large objects. Thawing is handled by a
single Lambda step (implemented by `ThawObjectsLambdaStepConstruct` and reused by both
`smallThaw` and `largeThaw` copy paths), which, for each object:

1. checks whether the object is currently readable / available in active storage
2. if not available, triggers an S3 restore request (`RestoreObject`)
3. if the object is still thawing, the Lambda throws `IsThawingError`

Step Functions is configured to **retry** on `IsThawingError`, which effectively turns this into
a polling loop until the object becomes available.

See [Restore settings](#restore-settings) for `thawParams`.

### Restore settings

S3 restore requests support different **restore duration** and **retrieval tiers** with typical restore times:

- **Bulk**: hours to days

  - ~5–12 hours (Glacier Flexible Retrieval)
  - ~24–48 hours (Glacier Deep Archive)

- **Standard**: a few hours (Intelligent-Tiering archive classes)

- **Expedited**: typically **1–5 minutes** for small objects.

Restore requests use **conservative defaults** intended to minimise cost, but callers can optionally
override restore duration (days) and retrieval tier (speed) via the `thawParams` state machine input.

If a field is not provided in `thawParams`, the thaw step Lambda applies defaults at runtime:

- restore duration defaults to **1 day**
- retrieval tier defaults to **Bulk**

If `thawParams` itself is omitted, it is normalised to `{}` by the state machine and all restore
settings fall back to these defaults.

**Retry / polling behaviour**

Retry cadence when handling `IsThawingError` is controlled by the `aggressiveTimes` construct property:

- `aggressiveTimes = false` (default): retry every **1 hour**, up to **50** attempts (≈ 50 hours)
- `aggressiveTimes = true`: retry every **1 minute**, up to **3** attempts

Note that `aggressiveTimes` is enabled for **development and testing only**, where restores are
expected to complete quickly and faster feedback is desirable. However, if `aggressiveTimes: true` and
a caller selects a slow retrieval tier (e.g. `Bulk`) via `thawParams`, retries may be exhausted
and the workflow can fail while the restore is still in progress.
