package main

// BucketDefinition configures access for a specific S3 bucket. These fields are directly
// mapped to copyrite CLI flags.
type BucketDefinition struct {
	CredentialProvider string `json:"credentialProvider,omitempty"`
	Secret             string `json:"secret,omitempty"`
	Region             string `json:"region,omitempty"`
	EndpointUrl        string `json:"endpointUrl,omitempty"`
	S3Compatible       *bool  `json:"s3Compatible,omitempty"`
}

// BatchInput is the input passed into copy-batch from the steps functions.
type BatchInput struct {
	BucketDefinitions map[string]BucketDefinition `json:"bucketDefinitions,omitempty"`
	// ContinueOnError when true, makes a best-effort attempt to continue even if there was an error.
	ContinueOnError bool `json:"continueOnError,omitempty"`
}

// CopyError An error in a copy batch that shows failures.
type CopyError struct {
	Message string
}

// Error get the error message.
func (e *CopyError) Error() string {
	return e.Message
}

// CopyErrorDetail describes a single failed copy within a CopyErrorReport.
type CopyErrorDetail struct {
	Source string `json:"source"`
	Error  string `json:"error"`
}

// CopyErrorReport is the description of the copy failures that aborts a batch.
type CopyErrorReport struct {
	Message     string            `json:"message"`
	FailedCount int               `json:"failedCount"`
	TotalCount  int               `json:"totalCount"`
	Truncated   bool              `json:"truncated"`
	Errors      []CopyErrorDetail `json:"errors"`
}

type CopyArg struct {
	Source      string `json:"s"`
	Destination string `json:"d"`
	// Sums        string      `json:"c"`
}

type CopyResult struct {
	Errors           int8    `json:"errors,omitempty"`
	LastError        string  `json:"lastError,omitempty"`
	SystemError      string  `json:"systemError,omitempty"`
	Source           string  `json:"source,omitempty"`
	Destination      string  `json:"destination,omitempty"`
	ElapsedSeconds   float64 `json:"elapsedSeconds,omitempty"`
	CopyMode         string  `json:"copyMode,omitempty"`
	BytesTransferred uint64  `json:"bytesTransferred,omitempty"`
}
