package main

// NOTE: we use a prefix of CB (copy-batch) just so we don't accidentally clash with a real
// env variable that has meaning to AWS or something else

// NOTE: we use environment variables extensively for passing data into this invoke - this is because
// this is a more natural way of invoking things with ECS. i.e. if this was a lambda we would invoke
// it with some structured JSON but that is not an option

const copyBinaryEnvName = "CB_COPY_BINARY"
const taskTokenEnvName = "CB_TASK_TOKEN"
const taskTokenHeartbeatSecondsIntervalEnvName = "CB_TASK_TOKEN_HEARTBEAT_SECONDS_INTERVAL"

// Our parent ECS task (when a SPOT instance) can be sent a TERM signal - we then have a hard
// limit of 120 seconds before the process is hard killed.
// This value here is the number of seconds to wait after receiving the TERM in the hope that our
// jobs might finish
const postTermCleanupSeconds = 90
