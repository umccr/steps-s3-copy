package main

import (
	"context"
	"log"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/sfn"
)

// BASED ON
// https://www.ardanlabs.com/blog/2013/09/timer-routines-and-graceful-shutdowns.html
// https://bbengfort.github.io/2016/06/background-work-goroutines-timer/

// HeartbeatWorker Worker will do its Action once every interval, making up for lost time that
// happened during the Action by only waiting the time left in the interval.
type HeartbeatWorker struct {
	SfnClient       *sfn.Client   // The client we need to do heart beat
	TaskToken       string        // The task token to ping as a heart beat
	Stopped         bool          // A flag determining the state of the worker
	ShutdownChannel chan string   // A channel to communicate to the routine
	Interval        time.Duration // The interval with which to run the Action
}

// NewHeartbeatWorker creates a new worker and instantiates all the data structures required.
func NewHeartbeatWorker(interval time.Duration, sfnClient *sfn.Client, taskToken string) *HeartbeatWorker {
	return &HeartbeatWorker{
		SfnClient:       sfnClient,
		TaskToken:       taskToken,
		Stopped:         false,
		ShutdownChannel: make(chan string),
		Interval:        interval,
	}
}

// Run starts the worker and listens for a shutdown call.
func (w *HeartbeatWorker) Run() {

	log.Printf("heartbeat: worker started with interval %v\n", w.Interval)

	// Loop that runs forever
	for {
		// activity first - send a heartbeat
		heartbeatSuccess, heartbeatErr := w.SfnClient.SendTaskHeartbeat(context.TODO(), &sfn.SendTaskHeartbeatInput{
			TaskToken: aws.String(w.TaskToken),
		})
		if heartbeatErr != nil {
			log.Printf("heartbeat: signal failed with %v\n", heartbeatErr)
		} else {
			log.Printf("heartbeat: signal sent %v\n", heartbeatSuccess)
		}

		select {
		case <-time.After(w.Interval):
			// do nothing.
		case <-w.ShutdownChannel:
			w.ShutdownChannel <- "Down"
			// this is our exit path out of the infinite for loop
			return
		}

		log.Printf("heartbeat: after delay\n")
	}
}

// Shutdown is a graceful shutdown mechanism
func (w *HeartbeatWorker) Shutdown() {
	w.Stopped = true

	w.ShutdownChannel <- "Down"
	<-w.ShutdownChannel

	close(w.ShutdownChannel)
}
