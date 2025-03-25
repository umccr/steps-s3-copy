FROM public.ecr.aws/docker/library/golang:1.24.1-alpine AS builder

# git is needed for go mod download to work
RUN apk add --no-cache git

WORKDIR /build

RUN go env -w GOPROXY=direct

ADD go.mod go.sum ./

RUN go mod download

ADD *.go ./

RUN env GOOS=linux CGO_ENABLED=0 GOARCH=amd64 go build rclone-batch.go


FROM rclone/rclone:1.69.1

# if we want signals to propogate through to the app we need a lightweight initd
RUN apk add --no-cache tini

# this is where rclone binary ends up by default so we will do our work there
WORKDIR /data

COPY --from=builder /build/rclone-batch ./

ENV RB_RCLONE_BINARY="/usr/local/bin/rclone"

ENTRYPOINT ["/sbin/tini", "-vv", "--", "/data/rclone-batch"]
