//go:build integration

package integration

import (
	"context"
	"encoding/json"
	"io"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"
)

const (
	imageTag   = "copy-batch-integration:test"
	dataDir    = "/tmp"
	objectBody = "test\n"
	runTimeout = 2 * time.Minute
)

// TestCopyBatchIntegration builds the copy-batch image and runs a local file copy.
func TestCopyBatchIntegration(t *testing.T) {
	ctx := context.Background()

	buildImage(t)

	t.Run("successful copy writes destination file", func(t *testing.T) {
		src, dst := dataDir+"/src.txt", dataDir+"/dest.txt"

		logs, container := runCopyBatch(t, ctx, map[string]string{src: objectBody}, copyArgJSON(src, dst))
		t.Logf("copy-batch logs:\n%s", logs)

		assert.Equal(t, objectBody, readFileFromContainer(t, ctx, container, dst))
		assert.NotContains(t, logs, `"errors"`)
	})

	t.Run("failed copy reports an error", func(t *testing.T) {
		src, dst := dataDir+"/does-not-exist-src.txt", dataDir+"/does-not-exist-dest.txt"

		logs, container := runCopyBatch(t, ctx, nil, copyArgJSON(src, dst))
		t.Logf("copy-batch logs:\n%s", logs)

		assert.Contains(t, logs, `"errors": 1`)
		assert.Contains(t, logs, `"lastError"`)
		assert.False(t, fileExistsInContainer(t, ctx, container, dst))
	})
}

// buildImage builds the copy-batch image for the tests. Not using testcontainers as it's clearer this way.
func buildImage(t *testing.T) {
	t.Helper()

	cmd := exec.Command("docker", "build",
		"--target", "fargate",
		"-t", imageTag,
		"-f", "../Dockerfile",
		"..",
	)
	_, err := cmd.CombinedOutput()
	require.NoError(t, err)
}

// runCopyBatch runs the copy-batch container for a single copy argument and returns its
// output and the test container.
func runCopyBatch(t *testing.T, ctx context.Context, seed map[string]string, copyArg string) (string, testcontainers.Container) {
	t.Helper()

	var files []testcontainers.ContainerFile
	for path, body := range seed {
		files = append(files, testcontainers.ContainerFile{
			Reader:            strings.NewReader(body),
			ContainerFilePath: path,
			FileMode:          0o644,
		})
	}

	req := testcontainers.ContainerRequest{
		Image:      imageTag,
		Files:      files,
		Cmd:        []string{copyArg},
		WaitingFor: wait.ForExit().WithExitTimeout(runTimeout),
	}

	container, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: req,
		Started:          true,
	})
	require.NoError(t, err)
	t.Cleanup(func() { _ = testcontainers.TerminateContainer(container) })

	return containerLogs(t, ctx, container), container
}

// containerLogs reads a finished container's stdout and stderr into a single string.
func containerLogs(t *testing.T, ctx context.Context, container testcontainers.Container) string {
	t.Helper()

	reader, err := container.Logs(ctx)
	require.NoError(t, err)
	defer func(reader io.ReadCloser) {
		require.NoError(t, reader.Close())
	}(reader)

	body, err := io.ReadAll(reader)
	require.NoError(t, err)

	return string(body)
}

// readFileFromContainer reads a file out of the container.
func readFileFromContainer(t *testing.T, ctx context.Context, container testcontainers.Container, path string) string {
	t.Helper()

	reader, err := container.CopyFileFromContainer(ctx, path)
	require.NoError(t, err)
	defer func(reader io.ReadCloser) {
		require.NoError(t, reader.Close())
	}(reader)

	body, err := io.ReadAll(reader)
	require.NoError(t, err)

	return string(body)
}

// fileExistsInContainer reports whether a path is present in the container.
func fileExistsInContainer(t *testing.T, ctx context.Context, container testcontainers.Container, path string) bool {
	t.Helper()

	reader, err := container.CopyFileFromContainer(ctx, path)
	if err != nil {
		return false
	}
	err = reader.Close()
	require.NoError(t, err)

	return true
}

func copyArgJSON(source, destination string) string {
	encoded, err := json.Marshal(map[string]string{"s": source, "d": destination})
	if err != nil {
		panic(err)
	}
	return string(encoded)
}
