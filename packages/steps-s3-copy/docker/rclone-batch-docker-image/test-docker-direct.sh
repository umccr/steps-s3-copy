#!/bin/bash

# we want to exit immediately on error (especially for Go/Docker build errors)
set -e

docker build . -t rclone-batch-image

# make a temporary directory for the copy destination
# NOTE: we do not remove this on a EXIT trap as that interferes with the assert.sh exit codes
TEMPD=$(mktemp -d)
if [ ! -e "$TEMPD" ]; then
    >&2 echo "Failed to create temp directory"
    exit 1
fi

# note the /etc files here are not important! We are just using them as source files
# that happen to already exist in the docker image by default
docker run --rm \
       --env RB_DESTINATION=/tmp \
       --mount "type=bind,source=$TEMPD,target=/tmp" \
       rclone-batch-image \
       /etc/alpine-release /etc/os-release /etc/services

# need to write some assertions here (need to separate out various outputs)

ls -al $TEMPD
