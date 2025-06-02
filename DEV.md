# Development

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
pnpm run dev-deploy
```

To remove entirely

```shell
pnpm run dev-destroy
```

## Testing (WIP)

There is a basic test suite that exercises some functionality though the
output leaves a lot to be desired. This is definitely work in progress.

NOTE: this test suite runs against _the deployed_ stack in AWS.

See `package.json` for the test suites. As an example, run

```shell
pnpm run dev-test-e2e
```

## Learnings (out of date)

Some learnings from actual copies.

Switch off AWS Config continuous for SecurityGroup and NetworkInterface.

Items per batch of 100 - caused problems with the filenames occupying too much space in the environment passed into the Task.

Concurrency of 80 caused issues with Throttling and Capacity - putting more sensible Retry policies on RunTask seems to
have fixed the Throttling. We were still seeing capacity issues.

The final copy needed to have a concurrency down to 25 to safely not have any issues.

Creating S3 checksums using S3 Batch (Copy) (as recommended by AWS) does not work for any
objects greater than 5GiB (5368709120). This is the upper limit of the CopyObject
call that is made by S3 Batch.

S3 objects can be constructed with inconsistent part sizes when making a
Multipart Upload.

GetObjectAttributes is the only way to retrieve details about multi part uploads - but
it does not return any details if the objects are not created with "new" checksums.
Objects created with just ETags do not return the parts as an array.

Task definition size Each supported Region: 64 Kilobytes No The maximum size, in KiB, of a task definition. The task definition
accepts the command line arguments when the copier is launched (or values passed in via environment variables) - so sets the
maximum launch size (unless we were to pivot to other services like dynamo)

These names are the object keys. The name for a key is a sequence of Unicode characters whose UTF-8 encoding is at most 1024 bytes long.
The following are some of the rules: The bucket name can be between 3 and 63 characters long, and
can contain only lower-case characters, numbers, periods, and dashes. Each label in the bucket name must start with a lowercase letter or number.
