package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

// Config holds what one benchmark run needs to talk to Simpang.
type Config struct {
	BaseURL   string
	Key       string
	Model     string
	MaxTokens int
	Stream    bool
	Timeout   time.Duration
	// Client is optional; nil means http.DefaultClient. The timeout is applied
	// per request through the context, so the client needs no Timeout itself.
	Client *http.Client
}

// Result is the measurement of a single request.
type Result struct {
	Status   int    // HTTP status; 0 when no response was received
	Provider string // x-simpang-provider header, empty if absent

	Latency time.Duration // request start until the response body was fully read
	// TTFT is the time from request start to the first non-empty text delta.
	// For non-streaming requests the whole body arrives at once, so TTFT equals
	// Latency. It is 0 when no content arrived at all.
	TTFT time.Duration

	CompletionTokens int
	// TokensEstimated is true when Simpang sent no usage object. The count is
	// then a proxy (see Do) and not a tokenizer count.
	TokensEstimated bool
	// TokensPerSec is 0 when it cannot be computed (failed request, no content).
	TokensPerSec float64

	// ErrorCode is empty on success. Otherwise it names the failure, for example
	// the API error code, "timeout", "transport_error" or "stream_truncated".
	ErrorCode string
}

// OK reports whether the request completed successfully.
func (r Result) OK() bool { return r.ErrorCode == "" }

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type chatRequest struct {
	Model     string        `json:"model"`
	Messages  []chatMessage `json:"messages"`
	MaxTokens int           `json:"max_tokens"`
	Stream    bool          `json:"stream"`
}

// maxErrorBody bounds how much of an error response is read. Error bodies are
// small JSON objects; the limit only protects against a misbehaving server.
const maxErrorBody = 64 << 10

// Do sends one chat completion request and measures it. It does not return an
// error: every failure is recorded in the Result so the run can count it.
func Do(parent context.Context, cfg Config, prompt string) Result {
	ctx, cancel := context.WithTimeout(parent, cfg.Timeout)
	defer cancel()

	body, err := json.Marshal(chatRequest{
		Model:     cfg.Model,
		Messages:  []chatMessage{{Role: "user", Content: prompt}},
		MaxTokens: cfg.MaxTokens,
		Stream:    cfg.Stream,
	})
	if err != nil {
		return Result{ErrorCode: "bad_request"}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		strings.TrimRight(cfg.BaseURL, "/")+"/v1/chat/completions", bytes.NewReader(body))
	if err != nil {
		return Result{ErrorCode: "bad_request"}
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+cfg.Key)
	if cfg.Stream {
		req.Header.Set("Accept", "text/event-stream")
	}

	client := cfg.Client
	if client == nil {
		client = http.DefaultClient
	}

	start := time.Now()
	resp, err := client.Do(req)
	if err != nil {
		return Result{ErrorCode: transportErrorCode(ctx), Latency: time.Since(start)}
	}
	defer resp.Body.Close()

	res := Result{Status: resp.StatusCode, Provider: resp.Header.Get("x-simpang-provider")}
	switch {
	case resp.StatusCode < 200 || resp.StatusCode > 299:
		// Simpang answers failures with a non-2xx status and a JSON error body.
		res.ErrorCode = httpErrorCode(resp.Body)
	case cfg.Stream:
		readStream(ctx, resp.Body, start, &res)
	default:
		readJSON(resp.Body, &res)
	}
	res.Latency = time.Since(start)
	if !cfg.Stream && res.OK() {
		// Nothing is streamed, so the first token only exists once the whole
		// response has arrived: TTFT is the full latency.
		res.TTFT = res.Latency
	}
	res.computeRate(cfg.Stream)
	return res
}

// transportErrorCode names a failure that happened before a response arrived.
func transportErrorCode(ctx context.Context) string {
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return "timeout"
	}
	return "transport_error"
}

// httpErrorCode reads a non-2xx body and returns its API error code.
func httpErrorCode(body io.Reader) string {
	var parsed struct {
		Error *APIError `json:"error"`
	}
	if err := json.NewDecoder(io.LimitReader(body, maxErrorBody)).Decode(&parsed); err != nil || parsed.Error == nil {
		return "http_error"
	}
	return parsed.Error.ErrorCode()
}

// readStream consumes an SSE body. It sets TTFT at the first text delta, and
// token counts from the usage chunk. The stream is only a success if it reaches
// [DONE]; a stream that stops early would otherwise look fast and successful.
func readStream(ctx context.Context, body io.Reader, start time.Time, res *Result) {
	var (
		usage  *Usage
		deltas int
		done   bool
	)
	// errStop ends ReadEvents early once we know the outcome.
	errStop := errors.New("stop")

	err := ReadEvents(body, func(data string) error {
		if data == DoneMarker {
			done = true
			return errStop
		}
		chunk, err := ParseChunk(data)
		if err != nil {
			res.ErrorCode = "bad_chunk"
			return errStop
		}
		if chunk.Error != nil {
			// Simpang can fail after the 200 status was already sent.
			res.ErrorCode = chunk.Error.ErrorCode()
			return errStop
		}
		if chunk.Usage != nil {
			usage = chunk.Usage
		}
		if chunk.Text() != "" {
			deltas++
			if deltas == 1 {
				res.TTFT = time.Since(start)
			}
		}
		return nil
	})

	switch {
	case res.ErrorCode != "":
		// Already set by an in-stream error or a bad chunk.
	case err != nil && !errors.Is(err, errStop):
		// The connection broke or the deadline passed while reading the body.
		res.ErrorCode = "stream_error"
		if ctx.Err() != nil {
			res.ErrorCode = transportErrorCode(ctx)
		}
	case !done:
		res.ErrorCode = "stream_truncated"
	}

	if usage != nil {
		res.CompletionTokens = usage.CompletionTokens
	} else {
		// No usage object: fall back to the number of text deltas. Usually one
		// delta is about one token, but this is an estimate and is flagged as one.
		res.CompletionTokens = deltas
		res.TokensEstimated = true
	}
}

// readJSON consumes a non-streaming chat completion response.
func readJSON(body io.Reader, res *Result) {
	var parsed struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
		Usage *Usage    `json:"usage"`
		Error *APIError `json:"error"`
	}
	if err := json.NewDecoder(body).Decode(&parsed); err != nil {
		res.ErrorCode = "bad_response"
		return
	}
	if parsed.Error != nil {
		res.ErrorCode = parsed.Error.ErrorCode()
		return
	}
	if parsed.Usage != nil {
		res.CompletionTokens = parsed.Usage.CompletionTokens
		return
	}
	// No usage: estimate from characters, using the common rule of thumb of
	// roughly four characters per token for English text.
	if len(parsed.Choices) > 0 {
		res.CompletionTokens = (len(parsed.Choices[0].Message.Content) + 3) / 4
	}
	res.TokensEstimated = true
}

// computeRate sets TokensPerSec. For streams the rate is measured over the
// generation phase only (Latency minus TTFT), so that waiting for the first
// token does not dilute the decoding speed. For non-streams the whole latency
// is the generation phase.
func (r *Result) computeRate(stream bool) {
	if !r.OK() || r.CompletionTokens == 0 {
		return
	}
	gen := r.Latency
	if stream {
		if r.TTFT == 0 {
			return
		}
		gen = r.Latency - r.TTFT
	}
	if gen > 0 {
		r.TokensPerSec = float64(r.CompletionTokens) / gen.Seconds()
	}
}

// Run executes n requests with at most c in flight and returns the results in
// request order, plus the wall-clock time the whole run took.
func Run(ctx context.Context, cfg Config, prompt string, n, c int) ([]Result, time.Duration) {
	if c > n {
		c = n // no point in more workers than requests
	}
	results := make([]Result, n)
	jobs := make(chan int)

	var wg sync.WaitGroup
	start := time.Now()
	for w := 0; w < c; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range jobs {
				// Each worker writes only its own index, so no locking is needed.
				results[i] = Do(ctx, cfg, prompt)
			}
		}()
	}
	for i := 0; i < n; i++ {
		jobs <- i
	}
	close(jobs)
	wg.Wait()
	return results, time.Since(start)
}

var vocabulary = strings.Fields(`the quick brown fox jumps over a lazy dog while
engineers measure latency throughput and tail behaviour across providers
under realistic load with mixed prompts answers streaming tokens arrive steadily
gateway routes each request to the healthiest model before the next retry`)

// BuildPrompt returns a prompt of exactly the given number of words. The words
// come from a fixed vocabulary, so every run sends the same text for the same
// size. Keep in mind that identical prompts can hit provider-side caches.
func BuildPrompt(words int) string {
	if words < 1 {
		words = 1
	}
	var b strings.Builder
	for i := 0; i < words; i++ {
		if i > 0 {
			b.WriteByte(' ')
		}
		b.WriteString(vocabulary[i%len(vocabulary)])
	}
	return b.String()
}
