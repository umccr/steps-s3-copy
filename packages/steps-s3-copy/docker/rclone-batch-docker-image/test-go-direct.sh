#!/bin/bash

# we want to exit immediately on error (especially for Go compile errors)
set -e

# bring in some helpful bash assertions
. test-assert.sh --invariant

# build our rclone-batch executable
go build rclone-batch.go

# make a temporary directory for the copy destination
# NOTE: we do not remove this on a EXIT trap as that interferes with the assert.sh exit codes
TEMPD=$(mktemp -d)
if [ ! -e "$TEMPD" ]; then
    >&2 echo "Failed to create temp directory"
    exit 1
fi

RB_RCLONE_BINARY="$(which rclone)"
if [ ! -e "$RB_RCLONE_BINARY" ]; then
    >&2 echo "Failed to locate rclone binary to use"
    exit 1
fi

export RB_RCLONE_BINARY

# our tests do return exit codes so we need to *not* fail on error
set +e

#
# Test 1
#
echo "Test 1 - copying two files"

RB_DESTINATION="$TEMPD/test1" ./rclone-batch ./testfile1.txt ./testfile2.txt > "$TEMPD/result.json"

test1_exit=$?

cat "$TEMPD/result.json"

assert " echo $test1_exit " "0"
assert " find $TEMPD/test1 -type f  | awk 'END{print NR}' " "2"
assert " cat $TEMPD/result.json | jq -r '.[0] | .bytes' " "20"
assert " cat $TEMPD/result.json | jq -r '.[1] | .bytes' " "37"

rm "$TEMPD/result.json"

#
# Test 2
#
echo "Test 2 - copying two files but one not present/fails"

RB_DESTINATION="$TEMPD/test2" ./rclone-batch ./afilethatdoesnotexist.txt ./testfile2.txt > "$TEMPD/result.json"

test2_exit=$?

cat "$TEMPD/result.json"

assert " echo $test2_exit " "1"
assert "find $TEMPD/test2 -type f | awk 'END{print NR}'" "1"
assert " cat $TEMPD/result.json | jq -r '.[0] | .lastError' " "directory not found"
assert " cat $TEMPD/result.json | jq -r '.[0] | .bytes' " "0"
assert " cat $TEMPD/result.json | jq -r '.[1] | .lastError' " "null"
assert " cat $TEMPD/result.json | jq -r '.[1] | .bytes' " "37"

rm "$TEMPD/result.json"

#
# Test 3
#
# this is a test that app will intercept a SIGTERM, pass it to any running rclone process,
# and return sensible results
#
echo "Test 3 - copying two files but signals tells us to stop"

# we set the bandwidth to 1B so that it is slow enough that our TERM signal will come mid-process
# we set the signal wait because otherwise the test will run for more than a minute
# we start this execution in the background
RB_DESTINATION="$TEMPD/test3" RB_DEBUG_BANDWIDTH="1B" RB_DEBUG_SIGNAL_WAIT="5" ./rclone-batch ./testfile1.txt ./testfile2.txt > "$TEMPD/result.json" &

# wait a small amount
sleep 1

# now send a SIGTERM to the launched job
kill %1

# but still wait for it to finish as it intercepts the SIGTERM
wait %1

cat "$TEMPD/result.json"

assert " cat $TEMPD/result.json | jq -r '.[0] | .lastError' " "interrupted by SIGTERM"
assert " cat $TEMPD/result.json | jq -r '.[1] | .lastError' " "skipped due to previous SIGTERM received"

rm "$TEMPD/result.json"

#
# end overall testing and set return code
#

assert_end examples
