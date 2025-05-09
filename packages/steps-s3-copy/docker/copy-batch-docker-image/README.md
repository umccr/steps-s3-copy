# copy-batch

`copy-batch` is a Go wrapper around the invocation of a copy binary. Why do we need
a wrapper? Well we want some decent control over the manner and flags for invoking
our copy binary, as well as custom processing of their outputs.

Also, we want optionally to be able to send this info
back to the parent AWS Steps via Task Tokens.

Furthermore, there are aspects of signal
handling that we want to support for Fargate Spot.

## How to dev?

A decent amount of development can be done without deploying anything
to AWS/CDK/Steps.

```shell
./test-go-direct.sh
```

Will compile the application and attempt some test copies. This is a purely
local invocation of the app with local temporary directories, made up local
files, and a local rclone binary.

This is good for

- checking the Go program compiles
- basic program logic

```shell
./test-docker-copy.sh
```

Will build the Docker image that is used by the parent AWS ECS, but then
invokes it directly, with a mount point to bind in a local temporary
directory.

This is good for

- checking the Docker configuration can build
- basic Docker sanity
