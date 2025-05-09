#!/bin/bash

# we want to exit immediately on error (especially for Go/Docker build errors)
set -e

docker build . --target lambda -t copy-batch-image-lambda

docker run --rm -p 9000:8080 -v ./lambda-rie-arm64:/aws-lambda --entrypoint /aws-lambda/aws-lambda-rie copy-batch-image-lambda /work/copy-batch-lambda
