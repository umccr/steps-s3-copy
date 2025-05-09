FROM public.ecr.aws/docker/library/golang:1.24.1-alpine AS builder

# git is needed for go mod download to work
RUN apk add --no-cache git

WORKDIR /build

RUN go env -w GOPROXY=direct

ADD go.mod go.sum ./

RUN go mod download

ADD *.go ./

RUN go build copy-batch-fargate.go
RUN go build copy-batch-lambda.go

ADD https://github.com/umccr/cloud-checksum/releases/download/0.2.4/cloud-checksum-aarch64-unknown-linux-gnu.tar.gz .

RUN gzip -dc cloud-checksum-aarch64-unknown-linux-gnu.tar.gz | tar xf -


FROM bitnami/aws-cli:latest

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
