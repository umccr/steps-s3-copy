#!/bin/bash

# we want to exit immediately on error (especially for Go/Docker build errors)
set -e

docker build . -t copy-batch-image

docker run --rm -it --entrypoint /bin/bash copy-batch-image
