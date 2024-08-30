# Steps S3 Copy

A service that can be installed (either directly or as a CDK
construct) and which enables parallel file copying into a
destination bucket in the same region.

## Development

On check-out (once only) (note that `pre-commit` is presumed installed externally)

```shell
pre-commit install
```

For package installation (note that `pnpm` is presumed installed externally)

```shell
pnpm install
```

Edit the packages and deploy to dev

```shell
(in the dev folder)
pnpm run deploy
```

## Testing (WIP)

See `dev-testsuite`.

(previously see below)

Because this service is very dependent on the behaviour of AWS Steps
(using distributed maps) - it was too complex to set up a "local" test
that would actually test much of the pieces likely to fail.

Instead, development is done and the CDK project is deployed to a "dev" account (noting
that this sets the minimum dev cadence for trying changes
to minutes rather than seconds).

There is then a test script - that creates samples objects - and launches
test invocations.

## Input

```json
{
  "sourceFilesCsvBucket": "bucket-with-csv",
  "sourceFilesCsvKey": "key-of-source-files.csv",
  "destinationBucket": "a-target-bucket-in-same-region-but-not-same-account",
  "maxItemsPerBatch": 10
}
```

The copy will fan-out wide (to sensible width (~ 100)) - but there is a small AWS Config
cost to the startup/shutdown
of the Fargate tasks. Therefore the `maxItemsPerBatch` controls how many individuals files are attempted per
Fargate task - though noting that we request SPOT tasks.

So there is balance between the likelihood of SPOT interruptions v re-use of Fargate tasks. If
tasks are SPOT interrupted - then the next invocation will skip already transferred files (assuming
at least one is copied) - so it is probably safe and cheapest to leave the items per batch at 10
and be prepared to perhaps re-execute the copy.


## Learnings

Some learnings from actual copies.

Switch off AWS Config continuous for SecurityGroup and NetworkInterface.

Items per batch of 100 - caused problems with the filenames occupying too much space in the environment passed into the Task.

Concurrency of 80 caused issues with Throttling and Capacity - putting more sensible Retry policies on RunTask seems to
have fixed the Throttling. We were still seeing capacity issues.

The final copy needed to have a concurrency down to 25 to safely not have any issues.



## S3 Learnings

Creating S3 checksums using S3 Batch (Copy) (as recommended by AWS) does not work for any
objects greater than 5GiB (5368709120). This is the upper limit of the CopyObject
call that is made by S3 Batch.

S3 objects can be constructed with inconsistent part sizes when making a 
Multipart Upload.

GetObjectAttributes is the only way to retrieve details about multi part uploads - but
it does not return any details if the objects are not created with "new" checksums.
Objects created with just ETags do not return the parts as an array.









