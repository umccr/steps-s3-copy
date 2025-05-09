package main

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
