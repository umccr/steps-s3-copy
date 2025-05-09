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

// copyRunner invokes a UNIX CLI tool to perform a set of object copy operations
func copyRunner(copyBinary string, copyInterruptWait time.Duration, toCopy *[]*CopyArg, toCopyResults *[]*CopyResult) {

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

		var cliArgs []string

		cliArgs = append(cliArgs,
			"copy",
			//"--...",
			copyArg.Source,
			copyArg.Destination)

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

		// the stdout of the copier should be a JSON representing stats of the copy
		var logLineJson map[string]interface{}

		decoder := json.NewDecoder(strings.NewReader(stdoutString))
		decoder.UseNumber()
		decoderErr := decoder.Decode(&logLineJson)

		if decoderErr == nil {

			if runErr != nil {
				var runExitErr *exec.ExitError
				if errors.As(runErr, &runExitErr) {
					(*toCopyResults)[i] = &CopyResult{
						Errors:      1,
						LastError:   strings.TrimSpace(stderrString),
						SystemError: fmt.Sprintf("%v", runExitErr.ExitCode()),
						Source:      copyArg.Source,
						Destination: copyArg.Destination}
				}
			} else {
				// reparsing the stats block by hand is probably not the best way - revisit
				elapsedTime, elapsedTimeErr := logLineJson["elapsed_seconds"].(json.Number).Float64()
				bytesTransferred, bytesTransferredErr := logLineJson["bytes_transferred"].(json.Number).Int64()

				(*toCopyResults)[i] = &CopyResult{
					Errors:           0,
					ElapsedSeconds:   If(elapsedTimeErr == nil, elapsedTime, 0),
					BytesTransferred: If(bytesTransferredErr == nil, uint64(bytesTransferred), 0),
					CopyMode:         logLineJson["copy_mode"].(string),
					Source:           logLineJson["source"].(string),
					Destination:      logLineJson["destination"].(string)}

				continue
			}
		}

		// if we get here then
		// we couldn't parse the output as JSON so it is probably our bug!
		// as`no valid stats block was output by the copier we need to make our own "compatible" one

		// keep in mind we *only* get here if copier itself didn't provide JSON stats
		// try to use the runtime error codes to gain some insight!
		if runErr != nil {
			var runExitErr *exec.ExitError
			if errors.As(runErr, &runExitErr) {
				switch runExitErr.ExitCode() {
				/*case 143:
				results[i] = CopyResult{
					errors: 1,
					lastError: "interrupted by SIGTERM",
					source: copyArg.Source,
					destination: copyArg.Destination}
				resultErrorCount++
				continue */
				default:
					(*toCopyResults)[i] = &CopyResult{
						Errors:      1,
						LastError:   fmt.Sprintf("exit of copy with code %v but no JSON statistics block generated", runExitErr.ExitCode()),
						SystemError: fmt.Sprintf("%#v", runExitErr),
						Source:      copyArg.Source,
						Destination: copyArg.Destination}
					continue
				}

			}
		}

		// if we have fallen through all the way to here without any details, then we put in
		// something generic - but we want to make sure every copy operation has a "result" block
		(*toCopyResults)[i] = &CopyResult{
			Errors:      1,
			LastError:   "exit of copy tool but no JSON statistics block generated or reason detected",
			Source:      copyArg.Source,
			Destination: copyArg.Destination}
	}

	for i, val := range *toCopyResults {
		log.Printf("Result[%d] = %v", i, *val)
	}
}
