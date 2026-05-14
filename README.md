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
  readonly workingBucketPrefix?: string;

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
stored in `workingBucket`/`workingBucketPrefix`/... .

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
   * The region that source buckets MUST be in. If undefined, defaults to the region the
   * orchestration is installed in.
   */
  readonly sourceRequiredRegion?: string;

  /**
   * The region that the destination bucket MUST be in. If undefined, defaults to the region
   * the orchestration is installed in.
   */
  readonly destinationRequiredRegion?: string;

  /**
   * The destination bucket to copy the objects.
   */
  readonly destinationBucket: string;

  /**
   * A slash-terminated prefix in the destination bucket under which copied objects (and the
   * markers / reports below) are placed. Use `""` to copy into the root of the bucket.
   */
  readonly destinationPrefix?: string;

  /**
   * Slash-terminated prefix (relative to the deploy-time `workingBucketPrefix`) that holds the
   * input copy-instructions JSONL. Distributed-map result manifests and any retained outputs are
   * also written here. Use `""` to place at the root of `workingBucketPrefix`.
   */
  readonly instructionsPrefix: string;

  /**
   * Key (relative to `instructionsPrefix`) of the JSONL copy-instructions file. Defaults to
   * `INSTRUCTIONS.jsonl`. May contain slashes to place the file under a sub-prefix.
   */
  readonly instructionsKey?: string;

  /**
   * Key (relative to `destinationPrefix`) of the start-of-copy marker object. Defaults to
   * `STARTED_COPY.txt`.
   */
  readonly startMarkerKey?: string;

  /**
   * Key (relative to `destinationPrefix`) of the end-of-copy CSV summary. Defaults to
   * `ENDED_COPY.csv`.
   */
  readonly summaryCsvKey?: string;

  /**
   * Key (relative to `destinationPrefix`) of the end-of-copy HTML report, written when
   * `htmlReport` is true. Defaults to `ENDED_COPY_REPORT.html`.
   */
  readonly htmlReportKey?: string;

  /**
   * If true, generate and write the HTML report to `destinationPrefix/htmlReportKey` in the
   * destination bucket. Defaults to false.
   */
  readonly htmlReport?: boolean;

  /**
   * If true, also save the HTML report in the working bucket at
   * `<workingBucketPrefix><instructionsPrefix><htmlReportKey>`. Generates the report even when
   * `htmlReport` is false. Defaults to false.
   */
  readonly retainHtmlReport?: boolean;

  /**
   * If true, also save the end-of-copy CSV in the working bucket at
   * `<workingBucketPrefix><instructionsPrefix><summaryCsvKey>`. Defaults to false.
   */
  readonly retainSummaryCsv?: boolean;

  /**
   * If true, go through the motions of doing a copy (including checking for existence of all the
   * objects) - but do not actually perform the copy. Defaults to false.
   */
  readonly dryRun?: boolean;

  readonly copyConcurrency?: number;
  readonly maxItemsPerBatch?: number;

  /**
   * Optional thawing parameters. Missing `thawParams` is normalised to `{}` by the state machine,
   * and per-field defaults are applied by the thaw step Lambda (`*ThawDays` = 1, `*ThawSpeed` = "Bulk").
   */
  readonly thawParams?: {
    readonly glacierFlexibleRetrievalThawDays?: number;
    readonly glacierFlexibleRetrievalThawSpeed?:
      | "Bulk"
      | "Standard"
      | "Expedited";

    readonly glacierDeepArchiveThawDays?: number;
    readonly glacierDeepArchiveThawSpeed?: "Bulk" | "Standard";

    readonly intelligentTieringArchiveThawDays?: number;
    readonly intelligentTieringArchiveThawSpeed?:
      | "Bulk"
      | "Standard"
      | "Expedited";

    readonly intelligentTieringDeepArchiveThawDays?: number;
    readonly intelligentTieringDeepArchiveThawSpeed?: "Bulk" | "Standard";
  };

  /**
   * When a source or destination bucket matches a key in this map, the `BucketDefinition` is used to
   * configure the credentials used to access the bucket.
   *
   * Settings here will override `sourceRequiredRegion`, `destinationRequiredRegion`, or `sourceNoSignRequest` if
   * using the no-credential `CredentialProvider`.
   */
  readonly bucketDefinitions?: Record<string, BucketDefinition>;
};

/**
 * Common fields shared by all bucket definitions.
 */
type BaseBucketDefinition = {
  /**
   * The AWS region for this bucket.
   */
  readonly region?: string;

  /**
   * A custom S3 endpoint URL
   */
  readonly endpointUrl?: string;

  /**
   * Enables compatibility mode for S3-compatible endpoints.
   * Defaults to `true` when `endpointUrl` is set. Set explicitly to override this.
   */
  readonly s3Compatible?: boolean;
};

/**
 * Specifies how the copier should connect to a specific bucket.
 *
 * - `"default-environment"` - use the default SDK credential chain.
 * - `"no-credentials"` - no request signing.
 * - `"aws-secret"` - fetch credentials from an AWS Secrets Manager secret.
 *   The secret must contain JSON with `access_key_id`, `secret_access_key`,
 *   and optionally `session_token`.
 */
export type BucketDefinition = BaseBucketDefinition &
  (
    | { readonly credentialProvider?: "default-environment" | "no-credentials" }
    | { readonly credentialProvider: "aws-secret"; readonly secret: string }
  );
```

`instructionsPrefix` points to the slash-terminated prefix (relative to the working folder) that
holds the JSONL copy-instructions file, and `instructionsKey` names the file itself.
For instance, if we uploaded the JSONL copy instructions to
`s3://my-working-bucket/a-working-folder/job/INSTRUCTIONS.jsonl`, we would specify
`instructionsPrefix` of `job/` and leave `instructionsKey` unset (or set it to
`INSTRUCTIONS.jsonl`).

Outputs of the copy run also land in this same prefix, e.g. CSV/HTML reports if
`retainSummaryCsv`/`retainHtmlReport` are set, and the distributed-map result manifests.

Note, it is expected that `instructionsPrefix` represents a single copy invocation. A new copy
should have a different `instructionsPrefix`. If it is re-used, the reports and output files will be
overwritten.

### File structure in the working and destination buckets

Two buckets are involved in any copy run:

- The **working bucket** (set at deploy time via `workingBucket` + `workingBucketPrefix`) holds
  the JSONL copy-instructions, the per-map result manifests, and any retained copies of the
  CSV summary and HTML report.
- The **destination bucket** (set per invocation via `destinationBucket` + `destinationPrefix`)
  receives the copied objects, the start copy marker, the CSV summary, and optionally the HTML report.

The `workingBucketPrefix`, `instructionsPrefix`, and `destinationPrefix` inputs must be either an empty string `""`
or end with a slash.

#### Where each file lands

The below table summarises each output:

| Artifact                         | Bucket      | Key                                                                                                          | Controlled by                                                |
| -------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| Copy instructions JSONL          | working     | `<workingBucketPrefix><instructionsPrefix><instructionsKey>`                                                 | uploaded by caller before invocation                         |
| Distributed map result manifests | working     | `<workingBucketPrefix><instructionsPrefix><MapRunArn>/manifest.json` and `<...><MapRunArn>/SUCCEEDED_*.json` | HeadObjects, Small, Large, NeedThawSmall, NeedThawLarge maps |
| Copy set JSONL files             | working     | `<workingBucketPrefix><instructionsPrefix><HeadObjectsMapRunArn>/{small,large,smallThaw,largeThaw}.jsonl`    | CoordinateCopy lambda                                        |
| Retained CSV summary             | working     | `<workingBucketPrefix><instructionsPrefix><summaryCsvKey>`                                                   | `retainSummaryCsv: true`                                     |
| Retained HTML report             | working     | `<workingBucketPrefix><instructionsPrefix><htmlReportKey>`                                                   | `retainHtmlReport: true`                                     |
| Start copy marker                | destination | `<destinationPrefix><startMarkerKey>`                                                                        | CanWrite lambda                                              |
| End copy CSV                     | destination | `<destinationPrefix><summaryCsvKey>`                                                                         | SummariseCopy lambda                                         |
| HTML report                      | destination | `<destinationPrefix><htmlReportKey>`                                                                         | `htmlReport: true`                                           |
| Copied objects                   | destination | `<destinationPrefix><destinationKey>`                                                                        | per copy-instruction                                         |

For example, take the following settings to see how files would be laid out.

Construct props:

```typescript
new StepsS3CopyConstruct(this, "Copy", {
  vpc,
  vpcSubnetSelection: SubnetType.PRIVATE_WITH_EGRESS,
  workingBucket: "my-working-bucket",
  workingBucketPrefix: "copy-out/",
});
```

Invoke args:

```json
{
  "instructionsPrefix": "job-a/",
  "destinationBucket": "destination",
  "destinationPrefix": "datasets/release/",
  "htmlReport": true,
  "retainHtmlReport": true,
  "retainSummaryCsv": true,
  "copyConcurrency": 80,
  "maxItemsPerBatch": 8
}
```

In the working bucket, the following would be the structure:

```
s3://my-working-bucket/
└── copy-out/
    └── job-a/
        ├── INSTRUCTIONS.jsonl
        ├── ENDED_COPY.csv
        ├── ENDED_COPY_REPORT.html
        └── <HeadObjects/Small/Large/NeedThaw*MapRunArn>/{manifest.json, ...}
```

In the destination bucket, the following would be the structure:

```
s3://destination/
└── datasets/
    └── release/
        ├── STARTED_COPY.txt
        ├── ENDED_COPY.csv
        ├── ENDED_COPY_REPORT.html
        └── <copied objects>
```

### Copying to S3-compatible endpoints

To copy objects to a non-AWS S3-compatible endpoint like Ceph, use `bucketDefinitions`
to configure the destination bucket with the custom endpoint and credentials. `bucketDefinitions`
is a set of key-value definitions where the key represents the bucket name, and the value
configures credentials and access for that bucket in source and destinations across steps-s3-copy.

For example, copying to a Ceph bucket using credentials in Secrets Manager:

```json
{
  "instructionsPrefix": "job/",
  "destinationBucket": "<bucket-name>",
  "destinationPrefix": "output/",
  "bucketDefinitions": {
    "<bucket-name>": {
      "credentialProvider": "aws-secret",
      "secret": "<secret-name-or-arn>",
      "region": "ap-southeast-2",
      "endpointUrl": "https://objects.storage.example.com",
      "s3Compatible": true
    }
  }
}
```

Existing options that define bucket access like `sourceRequiredRegion`, `destinationRequiredRegion` and `sourceNoSignRequest`
are still supported, however any `bucketDefinitions` will override these values for specific buckets. For example,
using `"credentialProvider" = "no-credentials"` will have the same effect, and override, `sourceNoSignRequest` for that
bucket.

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
