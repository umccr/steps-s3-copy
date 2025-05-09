package main

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"log"
	"os"
	"os/exec"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/sfn"
)

func handler(ctx context.Context, event events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	response := events.APIGatewayProxyResponse{
		StatusCode: 200,
		Body:       "\"Hello from Lambda!\"",
	}
	return response, nil
}

func main() {
	lambda.Start(handler)
}

// - A command line wrapper for invoking a copy binary one by one and return stats/error messages
// - to the parent caller. Finishes by sending the stats back to the AWS parent task if asked.
//
// - Inputs
// - os.Args each argument is a JSON structured CopyArg
//
// - Env
// - CB_TASK_TOKEN if present, the task token to use to send the copy results back to the parent
// - CB_DEBUG_BANDWIDTH if present, a rclone bandwidth setting (just for debug/testing)
// - ...any other rclone settings needed...
// - RCLONE_CONFIG_S3_PROVIDER...
func main() {

	copyBinary, copyBinaryOk := os.LookupEnv(copyBinaryEnvName)

	if !copyBinaryOk {
		log.Fatalf("No environment variable %s telling us the path to a copy executable", copyBinaryEnvName)
	}

	// TODO re-enable once we name our binary properly
	// if !strings.Contains(copyBinary, "cloud") {
	// given we are a program that executes another program - just a little sanity check that what we
	// are invoking vaguely makes sense
	// (feel free to remove this if you have a use case where the binary is named otherwise)
	//	log.Fatalf("The environment variable %s should have the string cloud in it somewhere", copyBinaryEnvName)
	// }

	// get the AWS config if it exists
	awsConfig, awsConfigErr := config.LoadDefaultConfig(context.TODO())

	// special environment variables that we can use for some debug/testing
	//debugBandwidth, debugBandwidthOk := os.LookupEnv("CB_DEBUG_BANDWIDTH")
	debugSignalWait, debugSignalWaitOk := os.LookupEnv("CB_DEBUG_SIGNAL_WAIT")

	// we end up with a result array entry for each object we are going to be asked to copy
	// NOTE: we have an entry result *irrespective* of whether the copy arg makes sense or
	//       whether the copy binary was run. If we are passed in 4 arguments - then by definition
	//       we are going to send back 4 result JSONs!
	results := make([]any, len(os.Args)-1)
	var resultErrorCount int64 = 0

	signalChannel := make(chan os.Signal, 1)

	// set as soon as we receive a SIGTERM - so that we will then just quickly skip the rest of the files
	interrupted := false

	// NOTE: we shuffle the [arg] we are referring to by one
	// so when i=0, our actual arg is os.Args[1] - this skips the CLI program name
	for i := 0; i < len(os.Args)-1; i++ {

		copyArgJsonString := os.Args[i+1]
		copyArg := CopyArg{}

		copyArgErr := json.Unmarshal([]byte(copyArgJsonString), &copyArg)

		if copyArgErr != nil {
			results[i] = map[string]any{
				"errors":    1,
				"lastError": fmt.Sprintf("command line argument of '%s' could not be unmarshalled into a CopyArg structure with error %v", copyArgJsonString, copyArgErr),
			}
			resultErrorCount++
			continue
		}

		if copyArg.Source == "" {
			results[i] = map[string]any{
				"errors":    1,
				"lastError": fmt.Sprintf("command line argument of '%s' did not have a valid 's' field", copyArgJsonString),
			}
			resultErrorCount++
			continue
		}

		if copyArg.Destination == "" {
			results[i] = map[string]any{
				"errors":    1,
				"lastError": fmt.Sprintf("command line argument of '%s' did not have a valid 'd' field", copyArgJsonString),
			}
			resultErrorCount++
			continue
		}

		// what we are processing in this iteration
		log.Printf("copy %d: Asked to copy %s to %s\n", i, copyArg.Source, copyArg.Destination)

		var copyArgs []string

		//copyArgs = append(copyArgs)// "--use-json-log",
		// we capture stats (noting that stats are sent to stderr)
		//"--stats-one-line",
		//"--stats-log-level", "NOTICE",
		// only display stats at the end (after 10000 hours)
		//"--stats", "10000h",
		// normally no bandwidth limiting ("0") - but can institute bandwidth limit if asked
		//"--bwlimit", If(debugBandwidthOk, debugBandwidth, "0"),

		copyArgs = append(copyArgs,
			// because we are transferring between S3 - which has a consistent idea of checksums
			// at src and destination we enable this options
			"copy",
			copyArg.Source,
			copyArg.Destination)

		// note that once we are interrupted we still go through the outer loop
		// we just don't actually do any copy operation (i.e. we do not abort/break the
		// loop) - we want a "result" for every object specified in the args
		if interrupted {
			// create a fake "compatible" stats block
			results[i] = map[string]any{
				"errors":      1,
				"lastError":   "skipped due to previous SIGTERM received",
				"source":      copyArg.Source,
				"destination": copyArg.Destination}
			resultErrorCount++
			continue
		}

		// the constructed command to execute to do the copy
		cmd := exec.Command(copyBinary, copyArgs...)

		// we are only interested in the separate message streams
		stderrStringBuilder := new(strings.Builder)
		cmd.Stderr = stderrStringBuilder

		stdoutStringBuilder := new(strings.Builder)
		cmd.Stdout = stdoutStringBuilder

		// we need to be able handling getting a SIGTERM when AWS wants to reclaim a SPOT instance
		signal.Notify(signalChannel, os.Interrupt, syscall.SIGTERM)
		go func() {
			sig := <-signalChannel
			switch sig {
			case syscall.SIGTERM:
				// indicate we don't want future copies to run
				interrupted = true

				// we do however have a 120 second (hard) window in which we might want
				// to let the current rclone finish
				// so lets sleep for a bit before we self-terminate
				// (we have a little debug settable value here to make our tests run quicker)
				if debugSignalWaitOk {
					i, err := strconv.Atoi(debugSignalWait)
					if err == nil {
						time.Sleep(time.Duration(i) * time.Second)
					}
				} else {
					time.Sleep(postTermCleanupSeconds * time.Second)
				}

				// terminate the currently running rclone
				// NOTE we ignore the error here - if the process has already gone away then the
				// signal possibly fails (by which point we should be exiting the process anyhow)
				cmd.Process.Signal(syscall.SIGTERM)
			}
		}()

		runErr := cmd.Run()

		if runErr != nil {
			log.Printf("copy %d: Run() failed with %v", i, runErr)
		} else {
			log.Printf("copy %d: Run() succeeded", i)
		}

		foundStats := false

		/*if false {
			// no matter what the exit code/status of the run is - we are going to (safely!) trawl
			// through the stderr
			// each line of stderr output is stats in JSON format or possibly other random messages
			stderrStringLines := strings.Split(strings.TrimSuffix(stderrStringBuilder.String(), "\n"), "\n")

			// attempt to process each line of log output to stderr as JSON (if not then log it ourselves)
			for _, line := range stderrStringLines {
				var logLineJson map[string]any

				decoder := json.NewDecoder(strings.NewReader(line))
				decoder.UseNumber()

				decoderErr := decoder.Decode(&logLineJson)

				if decoderErr == nil {
					statsValue, statsOk := logLineJson["stats"].(map[string]any)

					if statsOk {
						// an rclone stats block will definitely have a "errors" count
						// so we test for this and then use it
						errorsValue, errorsOk := statsValue["errors"].(json.Number)

						if errorsOk {
							errorsIntValue, errorsIntOk := errorsValue.Int64()

							if errorsIntOk == nil {
								resultErrorCount += errorsIntValue

								// insert information about the file we were copying into the rclone stats block
								statsValue["source"] = copyArg.Source
								statsValue["destination"] = copyArg.Destination

								// record the stats block
								results[i] = statsValue

								foundStats = true
							}
						}
					}
				} else {
					// we couldn't parse the line as JSON so it is probably a stderr msg from rclone
					log.Printf("copy %d: Run() stderr -> %s", i, line)
				}
			}
		} else { */
		stderrString := stderrStringBuilder.String()

		log.Printf("copy %d: Run() stderr -> %s", i, stderrString)

		stdoutString := stdoutStringBuilder.String()

		var logLineJson map[string]any

		decoder := json.NewDecoder(strings.NewReader(stdoutString))
		decoder.UseNumber()

		decoderErr := decoder.Decode(&logLineJson)

		if decoderErr == nil {
			// insert information about the file we were copying into the rclone stats block
			// logLineJson["source"] = copyArg.Source
			// logLineJson["destination"] = copyArg.Destination

			results[i] = logLineJson
			foundStats = true
		} else {
			// we couldn't parse the output as JSON so it is probably a bug!
			log.Printf("copy %d: Run() stdout -> %s", i, stdoutString)
		}

		if foundStats {
			continue
		}

		// if`no valid stats block was output by rclone we need to make our own "compatible" one
		// if we get a well-structured runtime error result we can work out some
		// specific error messages

		// keep in mind we *only* get here if rclone itself didn't provide JSON stats
		// (which is itself a bug - as rclone does provide stats on every copy)
		if runErr != nil {
			if runExitErr, runExitOk := runErr.(*exec.ExitError); runExitOk {
				// https://rclone.org/docs/#list-of-exit-codes
				switch runExitErr.ExitCode() {
				case 143:
					results[i] = map[string]any{
						"errors":      1,
						"lastError":   "interrupted by SIGTERM",
						"source":      copyArg.Source,
						"destination": copyArg.Destination}
					resultErrorCount++
					continue
				default:
					results[i] = map[string]any{
						"errors":      1,
						"lastError":   fmt.Sprintf("exit of copy with code %v but no JSON statistics block generated", runExitErr.ExitCode()),
						"systemError": fmt.Sprintf("%#v", runExitErr),
						"source":      copyArg.Source,
						"destination": copyArg.Destination}
					resultErrorCount++
					continue
				}

			}
		}

		// if we have fallen through all the way to here without any details then we put in
		// something generic - but we want to make sure every copy operation has a "result" block
		results[i] = map[string]any{
			"errors":      1,
			"lastError":   "exit of copy tool but no JSON statistics block generated or reason detected",
			"source":      copyArg.Source,
			"destination": copyArg.Destination}
		resultErrorCount++

	}

	// we have now attempted to copy every file and generated a stats dictionary in results[]

	// we need to report this back as JSON though
	resultsJson, resultsJsonErr := json.MarshalIndent(results, "", "  ")

	if resultsJsonErr != nil {
		log.Fatalf("Could not marshall the results to JSON with message %s\n", resultsJsonErr)
	}

	resultsString := string(resultsJson)

	log.Printf("Results are %v", resultsString)

	os.Exit(0) // int(resultErrorCount))
}
