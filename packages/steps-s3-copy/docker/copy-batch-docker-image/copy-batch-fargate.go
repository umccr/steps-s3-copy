package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strconv"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/sfn"
)

// - A command line wrapper for invoking a copy binary one by one and return stats/error messages
// - to the parent caller. Finishes by sending the stats back to the AWS parent task if asked.
//
// - Inputs
// - os.Args each argument is a JSON structured CopyArg
//
// - Env
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

	// a task token that ECS/Steps can pass us so we can return data
	// in practice this is always included when run by AWS - but we leave the option of it not being present
	// so we can run things locally/test
	taskToken, taskTokenOk := os.LookupEnv(taskTokenEnvName)

	// get the AWS config if it exists
	awsConfig, awsConfigErr := config.LoadDefaultConfig(context.TODO())

	var heartbeatWorker *HeartbeatWorker

	if taskTokenOk {
		log.Printf("Received task token of %s\n", taskToken)

		// if a task token was passed in, we now know that we need to regularly
		// make AWS calls to signal the parent that we are running

		// fail early if there was no AWS config
		if awsConfigErr != nil {
			log.Fatalf("Unable to load AWS config, %v", awsConfigErr)
		}

		taskTokenHeartbeatIntervalString, taskTokenHeartbeatIntervalOk := os.LookupEnv(taskTokenHeartbeatSecondsIntervalEnvName)

		if !taskTokenHeartbeatIntervalOk {
			log.Fatalf("No environment variable %s telling us the interval for heartbeats", taskTokenHeartbeatSecondsIntervalEnvName)
		}

		taskTokenHeartbeatInterval, taskTokenHeartbeatIntervalErr := strconv.Atoi(taskTokenHeartbeatIntervalString)

		if taskTokenHeartbeatIntervalErr != nil {
			log.Fatalf("Environment variable %s needs to be a string representing a number of integer seconds but was %s", taskTokenHeartbeatSecondsIntervalEnvName, taskTokenHeartbeatIntervalString)
		}

		// make a background worker doing heart beats
		heartbeatWorker = NewHeartbeatWorker(time.Duration(taskTokenHeartbeatInterval)*time.Second, sfn.NewFromConfig(awsConfig), taskToken)

		// and start it
		go heartbeatWorker.Run()
	}

	// special environment variables that we can use for some debug/testing
	//debugBandwidth, debugBandwidthOk := os.LookupEnv("CB_DEBUG_BANDWIDTH")
	debugSignalWait, debugSignalWaitOk := os.LookupEnv("CB_DEBUG_SIGNAL_WAIT")

	copyInterruptWait := postTermCleanupSeconds * time.Second

	if debugSignalWaitOk {
		i, err := strconv.Atoi(debugSignalWait)
		if err == nil {
			copyInterruptWait = time.Duration(i) * time.Second
		}
	}

	toCopy := make([]*CopyArg, len(os.Args)-1)
	toCopyResults := make([]*CopyResult, len(os.Args)-1)

	// because of the way ECS is passed in arguments - we need to convert from a CLI arg strings represented as JSON
	// into real data structures
	for i := 0; i < len(os.Args)-1; i++ {
		copyArgJsonString := os.Args[i+1]

		copyArg := CopyArg{}
		copyArgErr := json.Unmarshal([]byte(copyArgJsonString), &copyArg)

		if copyArgErr != nil {
			toCopyResults[i] = &CopyResult{
				Errors:    1,
				LastError: fmt.Sprintf("command line argument of '%s' could not be unmarshalled into a CopyArg structure with unmarshal error %v", copyArgJsonString, copyArgErr),
			}
			continue
		}

		if copyArg.Source == "" {
			toCopyResults[i] = &CopyResult{
				Errors:    1,
				LastError: fmt.Sprintf("command line argument of '%s' did not have a valid 's' (source) field", copyArgJsonString),
			}
			continue
		}

		if copyArg.Destination == "" {
			toCopyResults[i] = &CopyResult{
				Errors:    1,
				LastError: fmt.Sprintf("command line argument of '%s' did not have a valid 'd' (destination) field", copyArgJsonString),
			}
			continue
		}

		toCopy[i] = &copyArg
	}

	copyRunner(copyBinary, copyInterruptWait, &toCopy, &toCopyResults)

	// we have now attempted to copy every file and generated a stats dictionary in results[]

	// we need to report this back as JSON though
	resultsJson, resultsJsonErr := json.MarshalIndent(toCopyResults, "", "  ")

	if resultsJsonErr != nil {
		log.Fatalf("Could not marshall the results to JSON with message %s\n", resultsJsonErr)
	}

	resultsString := string(resultsJson)

	log.Printf("Results are %v", resultsString)

	// the normal mechanism by which we will send back results to our caller is
	// Steps SendTask - which sends back JSON
	if taskTokenOk {
		sfnSvc := sfn.NewFromConfig(awsConfig)

		// output
		// The JSON output of the task. Length constraints apply to the payload size, and are expressed as bytes in UTF-8 encoding.
		// Type: String
		// Length Constraints: Maximum length of 262144.

		// if we got any errors - we want to signal that up to the steps
		//if resultErrorCount > 0 {
		//    sfnSvc.SendTaskFailure(context.TODO(), &sfn.SendTaskFailureInput{
		//        Output:    aws.String(resultsString),
		//        TaskToken: aws.String(taskToken),
		//    })
		//} else {
		successResult, successErr := sfnSvc.SendTaskSuccess(context.TODO(), &sfn.SendTaskSuccessInput{
			Output:    aws.String(resultsString),
			TaskToken: aws.String(taskToken),
		})
		if successErr != nil {
			log.Fatalf("heartbeat: success signal failure %v\n", successErr)
		} else {
			log.Printf("heartbeat: send success %v\n", successResult)
		}
		//}

		// we can signal we no longer want heartbeats as we are about to finish up
		if heartbeatWorker != nil {
			heartbeatWorker.Shutdown()
		}

	}

	os.Exit(0) // int(resultErrorCount))
}
