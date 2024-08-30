# rclone-batch

`rclone-batch` is a Go wrapper around the invocation of `rclone`. Why do we need
a wrapper? Well we want to get the statistics output of `rclone` in a way
that we can standardise and use in our Steps DistributedMap results.

Also, we want optionally to be able to send this info
back to the parent AWS Steps via Task Tokens.

Furthermore, there are aspects of signal
handling that we want to support for Fargate Spot that is not quite the same as
`rclone` out of the box.

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
./test-docker-direct.sh
```

Will build the Docker image that is used by the parent AWS ECS, but then
invokes it directly, with a mount point to bind in a local temporary
directory.

This is good for

- checking the Docker configuration can build
- basic Docker sanity
