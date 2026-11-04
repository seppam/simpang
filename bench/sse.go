package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"strings"
)

// DoneMarker is the data payload Simpang sends as the last event of a stream.
const DoneMarker = "[DONE]"

// ReadEvents parses a Server-Sent Events stream and calls fn with the data of
// every complete event. It implements the parts of the SSE framing that
// Simpang uses:
//
//   - an event ends at a blank line; it is delivered only once that line has
//     been seen (or at EOF, if the stream ends without a blank line);
//   - several "data:" lines in one event are joined with "\n";
//   - lines starting with ":" are comments (keep-alives) and are ignored;
//   - CRLF and LF line endings are both accepted.
//
// It reads with bufio.Reader rather than bufio.Scanner on purpose: Scanner
// fails on lines longer than 64 KiB, and a single large chunk must not abort
// a benchmark. If fn returns an error, parsing stops and that error is returned.
func ReadEvents(r io.Reader, fn func(data string) error) error {
	br := bufio.NewReader(r)
	var data []string
	hasData := false

	flush := func() error {
		if !hasData {
			return nil
		}
		payload := strings.Join(data, "\n")
		data = data[:0]
		hasData = false
		return fn(payload)
	}

	for {
		// ReadString returns a partial line together with io.EOF, so the
		// line is handled before the error is checked.
		line, err := br.ReadString('\n')
		if len(line) > 0 {
			line = strings.TrimRight(line, "\r\n")
			switch {
			case line == "":
				if ferr := flush(); ferr != nil {
					return ferr
				}
			case strings.HasPrefix(line, ":"):
				// Comment or keep-alive: nothing to measure.
			case strings.HasPrefix(line, "data:"):
				// The spec allows one optional space after the colon.
				value := strings.TrimPrefix(strings.TrimPrefix(line, "data:"), " ")
				data = append(data, value)
				hasData = true
			default:
				// Other fields (event:, id:, retry:) are not used by Simpang.
			}
		}
		if err == io.EOF {
			return flush()
		}
		if err != nil {
			return err
		}
	}
}

// Usage is the token accounting Simpang reports, when it has it.
type Usage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
}

// APIError is the error object used both in HTTP error bodies and inside a stream.
type APIError struct {
	Type    string `json:"type"`
	Code    any    `json:"code"`
	Message string `json:"message"`
}

// ErrorCode returns the most specific identifier available: the code if set,
// otherwise the type, otherwise "unknown". Codes are kept as strings so that
// they can be used as map keys in the summary.
func (e APIError) ErrorCode() string {
	switch code := e.Code.(type) {
	case string:
		if code != "" {
			return code
		}
	case nil:
	default:
		return fmt.Sprint(code)
	}
	if e.Type != "" {
		return e.Type
	}
	return "unknown"
}

// Chunk is one JSON payload of a Simpang stream. A chunk carries either a
// text delta, a usage object (near the end), or an in-stream error.
type Chunk struct {
	Choices []ChunkChoice `json:"choices"`
	Usage   *Usage        `json:"usage,omitempty"`
	Error   *APIError     `json:"error,omitempty"`
}

// ChunkChoice holds one streamed alternative.
type ChunkChoice struct {
	Delta struct {
		Content string `json:"content"`
	} `json:"delta"`
}

// Text returns the text delta of the first choice, or "" if there is none.
func (c Chunk) Text() string {
	if len(c.Choices) == 0 {
		return ""
	}
	return c.Choices[0].Delta.Content
}

// ParseChunk decodes one event payload. The [DONE] marker must be checked by
// the caller before calling ParseChunk, since it is not JSON.
func ParseChunk(data string) (Chunk, error) {
	var c Chunk
	err := json.Unmarshal([]byte(data), &c)
	return c, err
}
