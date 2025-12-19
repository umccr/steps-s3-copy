# Test suite

## Setup

Requires bun >= 1.3.5 installed externally (via brew etc).

```
bun install --frozen-lockfile
```

We have chosen to pivot this to Bun as a runtime - in anticipation
of moving the rest over to Bun at some point. Bun makes the
setup all easier as it can directly execute Typescript and has a
built-in test runner.

## Unit tests

WIP!

## End-to-end tests

A collection of tests that exercise full end to end functionality. These can be run in
any AWS account with Steps installed - and will attempt to detect configuration/settings
by looking up the installed CloudFormation.

These tests will establish a source or destination (per test) folder in the working
bucket and copy from one to the other. The test objects should expire after 1 day
(using lifecycle rules in a folder called "1day/").

| Test                    | Time Est | Rationale                                                                |
| ----------------------- | -------- | ------------------------------------------------------------------------ |
| `bun run e2e-dryrun`    | < 1min   | Creates a few files and executes in dryrun mode (does no actual copying) |
| `bun run e2e-thawing`   | hours    | Creates a variety of sized files in cold storage and restore/copies them |
| `bun run e2e-koalas`    | < 5min   | Copies some external data (AWS OpenData koala genomes)                   |
| `bun run e2e-realistic` | < 5min   | Generates a realistic set of files and copies them including wildcards   |
