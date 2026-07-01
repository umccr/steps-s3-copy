package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"os/exec"
	"os/signal"
	"strings"
	"syscall"
	"time"
)

// countCopyErrors returns how many copy results recorded at least one error.
func countCopyErrors(results []*CopyResult) int {
	count := 0
	for _, r := range results {
		if r != nil && r.Errors > 0 {
			count++
		}
	}
	return count
}

// copyErrorSummary builds a JSON report of the copy errors. This will truncate if the sized
// is too large.
func copyErrorSummary(results []*CopyResult) string {
	// Steps allows up to 32768 characters for a cause, so keep it well under to avoid errors:
	// https://docs.aws.amazon.com/step-functions/latest/apireference/API_SendTaskFailure.html#API_SendTaskFailure_RequestSyntax
	const maxSummaryLength = 10000

	failedCount := countCopyErrors(results)

	report := CopyErrorReport{
		Message:     fmt.Sprintf("%d of %d copies failed", failedCount, len(results)),
		FailedCount: failedCount,
		TotalCount:  len(results),
		Errors:      make([]CopyErrorDetail, 0, failedCount),
	}

	for _, r := range results {
		if r == nil || r.Errors == 0 {
			continue
		}

		message := r.LastError
		if message == "" {
			message = r.SystemError
		}
		if message == "" {
			message = "unknown error"
		}

		report.Errors = append(report.Errors, CopyErrorDetail{
			Source: r.Source,
			Error:  message,
		})
	}

	for {
		encoded, err := json.Marshal(report)
		if err != nil {
			// A struct of strings should not fail, so fallback to default to keep a valid JSON.
			message, _ := json.Marshal(report.Message)
			return fmt.Sprintf(`{"message":%s,"failedCount":%d,"totalCount":%d,"truncated":true,"errors":[]}`,
				message, report.FailedCount, report.TotalCount)
		}

		if len(encoded) <= maxSummaryLength || len(report.Errors) == 0 {
			return string(encoded)
		}

		report.Errors = report.Errors[:len(report.Errors)-1]
		report.Truncated = true
	}
}

// copyriteStats is the copyrite JSON stats block that copy-batch consumes.
type copyriteStats struct {
	ElapsedSeconds     float64         `json:"elapsed_seconds"`
	BytesTransferred   uint64          `json:"bytes_transferred"`
	CopyMode           string          `json:"copy_mode"`
	Source             string          `json:"source"`
	Destination        string          `json:"destination"`
	UnrecoverableError json.RawMessage `json:"unrecoverable_error"`
}

// copyriteError extracts the failure reason from stderr that copyrite produces when it
// exits with an error.
func copyriteError(stdout string, stats copyriteStats, statsErr error, stderr string) string {
	if statsErr == nil {
		if len(stats.UnrecoverableError) > 0 {
			return string(stats.UnrecoverableError)
		}
		if trimmed := strings.TrimSpace(stdout); trimmed != "" {
			return trimmed
		}
	}

	if trimmed := strings.TrimSpace(stderr); trimmed != "" {
		return trimmed
	}

	return "copy failed but copyrite produced no error output"
}

// bucketNameFromS3Uri extracts the bucket name from an "s3://bucket/key" URI.
func bucketNameFromS3Uri(uri string) string {
	trimmed := strings.TrimPrefix(uri, "s3://")
	parts := strings.SplitN(trimmed, "/", 2)
	return parts[0]
}

// appendBucketFlags appends copyrite CLI flags for a bucket definition.
func appendBucketFlags(args []string, prefix string, def BucketDefinition) []string {
	if def.CredentialProvider != "" {
		args = append(args, fmt.Sprintf("--%scredential-provider", prefix), def.CredentialProvider)
	}
	if def.Secret != "" {
		args = append(args, fmt.Sprintf("--%ssecret", prefix), def.Secret)
	}
	if def.Region != "" {
		args = append(args, fmt.Sprintf("--%sregion", prefix), def.Region)
	}
	if def.EndpointUrl != "" {
		args = append(args, fmt.Sprintf("--%sendpoint-url", prefix), def.EndpointUrl)
	}

	s3Compatible := def.EndpointUrl != ""
	// Override this if set.
	if def.S3Compatible != nil {
		s3Compatible = *def.S3Compatible
	}
	// Otherwise it's based on the value of EndpointUrl
	if s3Compatible {
		args = append(args, fmt.Sprintf("--%ss3-compatible", prefix))
	}

	return args
}

// copyRunner invokes a UNIX CLI tool to perform a set of object copy operations
func copyRunner(copyBinary string, copyInterruptWait time.Duration, bucketDefinitions map[string]BucketDefinition, toCopy *[]*CopyArg, toCopyResults *[]*CopyResult) {

	// NOTE that the signal TERM handling is only _used_ where copyInterruptWait is positive (so we can switch
	// it off in lambdas etc) - however we set up the signal channel no matter what as there is no downside
	signalChannel := make(chan os.Signal, 1)
	// set as soon as we receive a SIGTERM - so that we will then just quickly skip the rest of the files
	interrupted := false

	for i := 0; i < len(*toCopy); i++ {

		// if we fail to create a copy arg (can't parse the input for instance) then we set it to nil
		// then we just skip processing
		// that entry - and our calling code will set the corresponding copy result entry
		if (*toCopy)[i] == nil {
			continue
		}

		copyArg := *(*toCopy)[i]

		// debug we are processing in this iteration
		log.Printf("copy %d: Asked to copy %s to %s\n", i, copyArg.Source, copyArg.Destination)

		// note that once we are interrupted we still go through the outer loop
		// we just don't actually do any copy operation (i.e. we do not abort/break the
		// loop) - we want a "result" for every object specified in the args
		if interrupted {
			// create a fake "compatible" stats block
			(*toCopyResults)[i] = &CopyResult{
				Errors:      1,
				LastError:   "skipped due to previous SIGTERM received",
				Source:      copyArg.Source,
				Destination: copyArg.Destination}
			continue
		}

		var cliArgs = []string{"copy", "--concurrency", "1"}
		if bucketDefinitions != nil {
			srcBucket := bucketNameFromS3Uri(copyArg.Source)
			dstBucket := bucketNameFromS3Uri(copyArg.Destination)
			// If there is a definition, append the flags, otherwise proceed with default behaviour.
			if def, ok := bucketDefinitions[srcBucket]; ok {
				cliArgs = appendBucketFlags(cliArgs, "source-", def)
			}
			if def, ok := bucketDefinitions[dstBucket]; ok {
				cliArgs = appendBucketFlags(cliArgs, "destination-", def)
			}
		}
		cliArgs = append(cliArgs, copyArg.Source, copyArg.Destination)

		// construct the command that will do the execution - though not trigger it yet
		cmd := exec.Command(copyBinary, cliArgs...)

		// we are only interested in the separate message streams
		stderrStringBuilder := new(strings.Builder)
		cmd.Stderr = stderrStringBuilder

		stdoutStringBuilder := new(strings.Builder)
		cmd.Stdout = stdoutStringBuilder

		// we only want to do this signal handling in environments where TERMs are possible (ECS SPOT)
		// so we allow the caller to switch it off by passing in negative duration
		if copyInterruptWait >= 0 {
			// we need to be able handling getting a SIGTERM when AWS wants to reclaim a SPOT instance
			signal.Notify(signalChannel, os.Interrupt, syscall.SIGTERM)
			go func() {
				sig := <-signalChannel
				switch sig {
				case syscall.SIGTERM:
					// indicate we don't want future copies to run
					interrupted = true

					// we do however have a 120 second (hard) window in which we might want
					// to let the current copy finish. so let's sleep for a bit before we self-terminate
					time.Sleep(copyInterruptWait)

					// terminate the currently running copy
					// NOTE we ignore the error here - if the process has already gone away then the
					// signal possibly fails (by which point we should be exiting the process anyhow)
					_ = cmd.Process.Signal(syscall.SIGTERM)
				}
			}()
		}

		runErr := cmd.Run()

		if runErr != nil {
			log.Printf("copy %d: Run() failed with %v", i, runErr)
		} else {
			log.Printf("copy %d: Run() succeeded", i)
		}

		stderrString := stderrStringBuilder.String()

		log.Printf("copy %d: Run() stderr -> %s", i, stderrString)

		stdoutString := stdoutStringBuilder.String()

		log.Printf("copy %d: Run() stdout -> %s", i, stdoutString)

		var stats copyriteStats
		statsErr := json.Unmarshal([]byte(strings.TrimSpace(stdoutString)), &stats)

		if runErr != nil {
			// on failure copyrite serialises a stats block carrying the "unrecoverable_error" to
			// stderr.
			result := &CopyResult{
				Errors:      1,
				LastError:   copyriteError(stdoutString, stats, statsErr, stderrString),
				Source:      copyArg.Source,
				Destination: copyArg.Destination,
			}

			var runExitErr *exec.ExitError
			if errors.As(runErr, &runExitErr) {
				result.SystemError = fmt.Sprintf("exit code %d", runExitErr.ExitCode())
			} else {
				result.SystemError = runErr.Error()
			}

			(*toCopyResults)[i] = result
			continue
		}

		if statsErr != nil {
			// copyrite reported success but we could not parse its stats. This should still be considered
			// a success, as the file would have been properly copied.
			log.Printf("copy %d: succeeded but stats block could not be parsed: %v", i, statsErr)
			(*toCopyResults)[i] = &CopyResult{
				Errors:      0,
				Source:      copyArg.Source,
				Destination: copyArg.Destination,
			}
			continue
		}

		(*toCopyResults)[i] = &CopyResult{
			Errors:           0,
			ElapsedSeconds:   stats.ElapsedSeconds,
			BytesTransferred: stats.BytesTransferred,
			CopyMode:         stats.CopyMode,
			Source:           stats.Source,
			Destination:      stats.Destination}
	}

	for i, val := range *toCopyResults {
		log.Printf("Result[%d] = %v", i, *val)
	}
}
