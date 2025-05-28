package main

import (
	"context"
	"github.com/aws/aws-lambda-go/lambda"
	"log"
	"os"
)

type StepsDistributedMapBatch struct {
	BatchInput any
	Items      []CopyArg
}

func handler(ctx context.Context, event StepsDistributedMapBatch) (any, error) {

	log.Printf("Lamba context: %#v\n", ctx)
	log.Printf("Lamba event: %#v\n", event)

	copyBinary, copyBinaryOk := os.LookupEnv(copyBinaryEnvName)

	if !copyBinaryOk {
		log.Fatalf("No environment variable %s telling us the path to a copy executable", copyBinaryEnvName)
	}

    // our guarantee to the caller is that if passed in an array of 4 items, we will return
    // a result with 4 items
	toCopy := make([]*CopyArg, len(event.Items))
	toCopyResults := make([]*CopyResult, len(event.Items))

	for i, val := range event.Items {
		toCopy[i] = &val
	}

    // passing in -1 to signify we don't want SIGTERM handling
	copyRunner(copyBinary, -1, &toCopy, &toCopyResults)

	return toCopyResults, nil
}

func main() {
	lambda.Start(handler)
}
