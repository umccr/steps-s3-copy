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

	toCopy := make([]*CopyArg, len(event.Items))
	toCopyResults := make([]*CopyResult, len(event.Items))

	for i, val := range event.Items {
		toCopy[i] = &val
	}

	copyRunner(copyBinary, -1, &toCopy, &toCopyResults)

	return toCopyResults, nil

	// we need to report this back as JSON though
	/*resultsJson, resultsJsonErr := json.MarshalIndent(results, "", "  ")

	if resultsJsonErr != nil {
		log.Fatalf("Could not marshall the results to JSON with message %s\n", resultsJsonErr)
	}

	resultsString := string(resultsJson)

	response := events.APIGatewayProxyResponse{
		StatusCode: 200,
		Body:       resultsString,
	}
	return response, nil */
}

func main() {
	lambda.Start(handler)
}
