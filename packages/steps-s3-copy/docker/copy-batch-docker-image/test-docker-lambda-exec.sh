#!/bin/bash

# we want to exit immediately on error (especially for Go/Docker build errors)
set -e

curl "http://localhost:9000/2015-03-31/functions/function/invocations" -d '{ "Items": [ { "s":"/etc/issue","d":"/tmp/file" } ] }'
