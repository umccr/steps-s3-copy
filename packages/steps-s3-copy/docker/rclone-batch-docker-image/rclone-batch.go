package main

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/secretsmanager"
	"github.com/aws/aws-sdk-go-v2/service/sfn"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// NOTE: we use a prefix of RB (rclone-batch) just so we don't accidentally clash with a real
// env variable that has meaning to rclone (for example)

const rcloneBinaryEnvName = "RB_RCLONE_BINARY"
const destinationEnvName = "RB_DESTINATION"

// some temporary code with the ability to source from GDS

const ICA_BASE_URL = "https://aps2.platform.illumina.com/v1"

type GdsFilesResponse struct {
	Items []struct {
		ID             string    `json:"id,omitempty"`
		Name           string    `json:"name,omitempty"`
		VolumeID       string    `json:"volumeId,omitempty"`
		ParentFolderID string    `json:"parentFolderId,omitempty"`
		VolumeName     string    `json:"volumeName,omitempty"`
		Type           string    `json:"type,omitempty"`
		TenantID       string    `json:"tenantId,omitempty"`
		SubTenantID    string    `json:"subTenantId,omitempty"`
		Path           string    `json:"path,omitempty"`
		TimeCreated    time.Time `json:"timeCreated"`
		CreatedBy      string    `json:"createdBy,omitempty"`
		TimeModified   time.Time `json:"timeModified"`
		ModifiedBy     string    `json:"modifiedBy,omitempty"`
		Urn            string    `json:"urn,omitempty"`
		SizeInBytes    int64     `json:"sizeInBytes"`
		IsUploaded     bool      `json:"isUploaded"`
		ArchiveStatus  string    `json:"archiveStatus,omitempty"`
		StorageTier    string    `json:"storageTier,omitempty"`
		ETag           string    `json:"eTag,omitempty"`
		Format         string    `json:"format,omitempty"`
		FormatEdam     string    `json:"formatEdam,omitempty"`
		Status         string    `json:"status,omitempty"`
		PresignedURL   string    `json:"presignedUrl,omitempty"`
	} `json:"items"`
	ItemCount      int    `json:"itemCount"`
	FirstPageToken string `json:"firstPageToken,omitempty"`
}

// our parent ECS task (when a SPOT instance) can be sent a TERM signal - we then have a hard
// limit of 120 seconds before the process is hard killed
// this value here is the seconds to wait after receiving the TERM in the hope that our
// jobs might finish
const postTermCleanupSeconds = 90

/**
 * A ternaryish operator
 */
func If[T any](cond bool, vtrue, vfalse T) T {
	if cond {
		return vtrue
	}
	return vfalse
}

/**
 * A command line wrapper for invoking rclone one by one and return stats/error messages
 * to the parent caller. Finishes by sending the stats back to the AWS parent task if asked.
 *
 * Inputs
 *   os.Args the source object paths to copy (rclone syntax e.g s3:bucket:key)
 * Env
 *  RB_RCLONE_BINARY the path to an rclone binary to use
 *  RB_DESTINATION the path to send the objects (rclone syntax e.g s3:bucket:key)
 *  RB_TASK_TOKEN if present, the task token to use to send the copy results back to the parent
 *  RB_DEBUG_BANDWIDTH if present, a rclone bandwidth setting (just for debug/testing)
 *  ...any other rclone settings needed...
 *  RCLONE_CONFIG_S3_PROVIDER...
 */
func main() {
	// NOTE: if this was a traditional command line tool we would take these in as command
	// line parameters. However, we are invoking this as an ECS Task and it turns out easier
	// to pass these down via environment variables - saving the command line args *only* for the list
	// of files we want to copy

	rcloneBinary, rcloneBinaryOk := os.LookupEnv(rcloneBinaryEnvName)

	if !rcloneBinaryOk {
		log.Fatalf("No environment variable %s telling us the path to an rclone executable", rcloneBinaryEnvName)
	}

	if !strings.Contains(rcloneBinary, "rclone") {
		// given we are a program that executes another program - just a little sanity check that what we
		// are invoking vaguely makes sense
		// (feel free to remove this if you have a use case where the binary is named otherwise)
		log.Fatalf("The environment variable %s should have the string rclone in it somewhere", rcloneBinaryEnvName)
	}

	destination, destinationOk := os.LookupEnv(destinationEnvName)

	if !destinationOk {
		log.Fatalf("No environment variable %s telling us where to copy the objects", destinationEnvName)
	}

	// a task token that ECS/Steps can pass us so we can return data
	taskToken, taskTokenOk := os.LookupEnv("RB_TASK_TOKEN")

	// now that we know whether we want to use the task token - we will definitely need AWS config to work
	// - so no need starting copying if we will fail at the end
	cfg, err := config.LoadDefaultConfig(context.TODO())

	if taskTokenOk {
		if err != nil {
			log.Fatalf("Unable to load AWS config, %v", err)
		}
	}

	// special environment variables that we can use for some debug/testing
	debugBandwidth, debugBandwidthOk := os.LookupEnv("RB_DEBUG_BANDWIDTH")
	debugSignalWait, debugSignalWaitOk := os.LookupEnv("RB_DEBUG_SIGNAL_WAIT")

	// we end up with a result array entry for each object we have been asked to copy
	results := make([]any, len(os.Args)-1)
	var resultErrorCount int64 = 0

	signalChannel := make(chan os.Signal)

	// set as soon as we receive a SIGTERM - so that we will then just quickly skip the rest of the files
	interrupted := false

	for i := 1; i < len(os.Args); i++ {

		// what we are processing in this iteration
		which := i - 1
		source := os.Args[i]

		log.Printf("Asked to copy %s as the %d object to copy", source, which)

		// setup rclone args that are used by all copy paths
		var copyArgs []string

		copyArgs = append(copyArgs, "--use-json-log",
			// we capture stats (noting that stats are sent to stderr)
			"--stats-one-line",
			"--stats-log-level", "NOTICE",
			// only display stats at the end (after 10000 hours)
			"--stats", "10000h",
			// normally no bandwidth limiting ("0") - but can institute bandwidth limit if asked
			"--bwlimit", If(debugBandwidthOk, debugBandwidth, "0"),
		)

		// umccr specific workaround to make GDS available
		if strings.HasPrefix(source, "s3:production") || strings.HasPrefix(source, "s3:development") {
			secretsSvc := secretsmanager.NewFromConfig(cfg)

			secretResp, secretErr := secretsSvc.GetSecretValue(context.TODO(), &secretsmanager.GetSecretValueInput{
				SecretId: aws.String("IcaSecretsPortal"),
			})

			if secretErr != nil {   // pragma: allowlist secret
				log.Fatalf("Unable to get IcaSecretsPortal secret: %v", secretErr)
			}

			secret := aws.ToString(secretResp.SecretString) // pragma: allowlist secret

			r := regexp.MustCompile(`s3:(?P<Volume>[^/]+)(?P<Path>.+)`)
			p := r.FindStringSubmatch(source)

			url := fmt.Sprintf("%s/files?include=PresignedUrl&volume.name=%s&path=%s", ICA_BASE_URL, p[1], p[2])

			log.Println(url)

			client := http.Client{}
			req, err := http.NewRequest("GET", url, nil)
			if err != nil {
				log.Fatalf("Unable to create request: %v", err)
			}
			req.Header = http.Header{
				"Host":          {"www.host.com"},
				"Content-Type":  {"application/json"},
				"Authorization": {fmt.Sprintf("Bearer %s", secret)},
			}
			resp, err := client.Do(req)
			if err != nil {
				log.Fatalf("Unable to send request: %v", err)
			}

			defer resp.Body.Close()

			body, err := io.ReadAll(resp.Body)

			filesObject := GdsFilesResponse{}

			if err := json.Unmarshal(body, &filesObject); err != nil {
				log.Fatalf("Unable to unmarshal response: %v", err)
			}

			source = filesObject.Items[0].PresignedURL
			copyArgs = append(copyArgs,
				"--auto-filename",
				"--disable-http2",
				"copyurl",
				source,
				destination)
		} else {
			copyArgs = append(copyArgs,
				// because we are transferring between S3 - which has a consistent idea of checksums
				// at src and destination we enable this options
				"--checksum",
				"copy",
				source,
				destination)
		}

		if !interrupted {
			// the constructed command to execute to do the copy
			cmd := exec.Command(rcloneBinary, copyArgs...)

			// we are only interested in stderr
			stderrStringBuilder := new(strings.Builder)
			cmd.Stderr = stderrStringBuilder

			// we need to be able handling getting a SIGTERM when AWS wants to reclaim our SPOT instance
			signal.Notify(signalChannel, os.Interrupt, syscall.SIGTERM)
			go func() {
				sig := <-signalChannel
				switch sig {
				case syscall.SIGTERM:
					// indicate we don't want future rclones to run
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
				log.Printf("rclone Run() failed with %v", runErr)
			} else {
				log.Printf("rclone Run() succeeded")
			}

			foundStats := false

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
								statsValue["source"] = source

								// record the stats block
								results[which] = statsValue

								foundStats = true
							}
						}
					}
				} else {
					// we couldn't parse the line as JSON so it is probably a stderr msg from rclone
					log.Printf("rclone stderr -> %s", line)
				}
			}

			// if`no valid stats block was output by rclone we need to make our own "compatible" one
			if !foundStats {
				// if we get a well structured runtime error result we can work out some
				// specific error messages

				// keep in mind we *only* get here if rclone itself didn't provide JSON stats
				// (which is itself a bug - as rclone does provide stats on every copy)
				if runErr != nil {
					if runExitErr, runExitOk := runErr.(*exec.ExitError); runExitOk {
						// https://rclone.org/docs/#list-of-exit-codes
						switch runExitErr.ExitCode() {
						case 143:
							results[which] = map[string]any{
								"errors":    1,
								"lastError": "interrupted by SIGTERM",
								"source":    source}
							resultErrorCount++
						default:
							results[which] = map[string]any{
								"errors":      1,
								"lastError":   fmt.Sprintf("exit of rclone with code %v but no JSON statistics block generated", runExitErr.ExitCode()),
								"systemError": fmt.Sprintf("%#v", runExitErr),
								"source":      source}
							resultErrorCount++
						}
					}
				}
			}

		} else {
			// if we have previously received a SIGTERM - then for the rest we have been asked to copy we just need to skip
			// create a fake "compatible" stats block
			results[which] = map[string]any{
				"errors":    1,
				"lastError": "skipped due to previous SIGTERM received",
				"source":    source}
			resultErrorCount++
		}

		// if we have fallen through all the way to here without any details then we put in
		// something generic - but we want to make sure every copy operation has a "result" block
		if results[which] == nil {
			results[which] = map[string]any{
				"errors":    1,
				"lastError": "Exit of rclone but no JSON statistics block generated or reason detected",
				"source":    source}
			resultErrorCount++
		}
	}

	// we have now attempted to copy every file and generated a stats dictionary in results[]

	// we need to report this back as JSON though
	resultsJson, err := json.MarshalIndent(results, "", "  ")

	if err != nil {
		log.Fatalf("Could not marshall the rclone outputs to JSON", err)
	}

	resultsString := string(resultsJson)

	// the normal mechanism by which we will send back results to our caller is
	// Steps SendTask - which sends back JSON
	if taskTokenOk {
		sfnSvc := sfn.NewFromConfig(cfg)

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
		sfnSvc.SendTaskSuccess(context.TODO(), &sfn.SendTaskSuccessInput{
			Output:    aws.String(resultsString),
			TaskToken: aws.String(taskToken),
		})
		//}

	} else {
		// if no task token was given then we just print the results
		fmt.Println(resultsString)
	}

	os.Exit(int(resultErrorCount))
}
