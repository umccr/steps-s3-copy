FROM public.ecr.aws/docker/library/golang:1.24.1-alpine AS builder

# git is needed for go mod download to work
RUN apk add --no-cache git

WORKDIR /build

# fetch packages for the go project
RUN go env -w GOPROXY=direct
ADD go.mod go.sum ./
RUN go mod download

# compile two binaries
ADD *.go ./

RUN go build copy-batch-fargate.go ecs-heartbeat.go copy-runner.go constants.go types.go utils.go

# the tag removes some legacy Go 1.x support from the AWS lambda library
RUN go build -tags lambda.norpc copy-batch-lambda.go copy-runner.go constants.go types.go utils.go

ADD https://github.com/umccr/cloud-checksum/releases/download/0.2.5/cloud-checksum-aarch64-unknown-linux-gnu.tar.gz .

RUN gzip -dc cloud-checksum-aarch64-unknown-linux-gnu.tar.gz | tar xf -


FROM amazon/aws-cli:latest AS fargate

WORKDIR /work

# RUN install_packages bash
COPY --from=builder /build/copy-batch-fargate ./
COPY --from=builder /build/cloud-checksum ./

#ENV CB_COPY_BINARY="/opt/bitnami/aws-cli/venv/bin/aws"
#ENV CB_COPY_BINARY="/usr/bin/cp"
ENV CB_COPY_BINARY="/work/cloud-checksum"

# NOTE: the control application uses signals - and hence should be invoked via an init.d style
# bootstrap - in our case we set ECS flags to make this happen elsewhere
# (we used to install tini and execute it ourselves but no longer do that)
ENTRYPOINT ["/work/copy-batch-fargate"]

FROM amazon/aws-cli:latest AS lambda

WORKDIR /work

COPY --from=builder /build/copy-batch-lambda ./
COPY --from=builder /build/cloud-checksum ./

ENV CB_COPY_BINARY="/work/cloud-checksum"

ENTRYPOINT ["/work/copy-batch-lambda"]


FROM amazon/aws-cli:latest AS wontbuild

# we very explicitly don't want a "default" build - we ALWAYS want to specify a target (fargate or lambda)
# so this line will make any build without a --target fail
COPY nothing nowhere
