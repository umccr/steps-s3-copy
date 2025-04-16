#!/bin/bash

# we want to exit immediately on error (especially for Go/Docker build errors)
set -e

docker build . -t copy-batch-image

# make a temporary directory for the copy destination
# NOTE: we do not remove this on a EXIT trap as that interferes with the assert.sh exit codes
TEMPD=$(mktemp -d)
if [ ! -e "$TEMPD" ]; then
    >&2 echo "Failed to create temp directory"
    exit 1
fi

set +e

# note the /etc files here are not important! We are just using them as source files
# that happen to already exist in the docker image by default
docker run --rm \
       --env CB_COPY_SRC_0="/etc/issue.net" \
       --env CB_COPY_DST_0="/tmp/issue-net-renamed" \
       --env CB_COPY_SRC_1="/etc/os-release" \
       --env CB_COPY_DST_1="/tmp/os-release" \
       --env CB_COPY_SRC_2="/etc/a-file-that-does-not-exist" \
       --env CB_COPY_DST_2="/tmp/does-not-matter" \
       --mount "type=bind,source=$TEMPD,target=/tmp" \
       copy-batch-image

# need to write some assertions here (need to separate out various outputs)

ls -al $TEMPD
