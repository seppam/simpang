package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

const testKey = "test-key"

// fakeSimpang mimics the parts of Simpang that the benchmark touches. mode picks
// the behaviour: "stream" (SSE with usage), "stream-no-usage", "nonstream", or
// "error500" (a failing upstream).
func fakeSimpang(t *testing.T, mode string) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/chat/completions" {
			http.NotFound(w, r)
			return
		}
		if r.Header.Get("Authorization") != "Bearer "+testKey {
			writeJSONError(w, http.StatusUnauthorized, "authentication_error", "invalid_api_key")
			return
		}
		var req chatRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.Messages) != 1 {
			writeJSONError(w, http.StatusBadRequest, "invalid_request_error", "bad_body")
			return
		}
		w.Header().Set("x-simpang-provider", "fake-provider")
		w.Header().Set("x-simpang-model", req.Model)

		switch mode {
		case "error500":
			writeJSONError(w, http.StatusInternalServerError, "server_error", "upstream_failed")
		case "nonstream":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"choices": []any{map[string]any{"message": map[string]string{"role": "assistant", "content": "tok0 tok1 tok2 tok3 tok4"}}},
				"usage":   map[string]int{"prompt_tokens": 9, "completion_tokens": 5, "total_tokens": 14},
			})
		case "stream", "stream-no-usage":
			writeFakeStream(w, mode == "stream")
		default:
			t.Errorf("unknown mode %q", mode)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

func writeJSONError(w http.ResponseWriter, status int, typ, code string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"error": map[string]string{"type": typ, "code": code, "message": "fake error"},
	})
}

// writeFakeStream sends five text deltas, an optional usage chunk and [DONE].
func writeFakeStream(w http.ResponseWriter, withUsage bool) {
	w.Header().Set("Content-Type", "text/event-stream")
	flusher, _ := w.(http.Flusher)
	send := func(v any) {
		b, _ := json.Marshal(v)
		fmt.Fprintf(w, "data: %s\n\n", b)
		if flusher != nil {
			flusher.Flush()
		}
	}
	for i := 0; i < 5; i++ {
		send(map[string]any{"choices": []any{map[string]any{"delta": map[string]string{"content": fmt.Sprintf("tok%d ", i)}}}})
	}
	if withUsage {
		send(map[string]any{"choices": []any{}, "usage": map[string]int{"prompt_tokens": 9, "completion_tokens": 5, "total_tokens": 14}})
	}
	fmt.Fprint(w, "data: [DONE]\n\n")
	if flusher != nil {
		flusher.Flush()
	}
}

func testConfig(url string, stream bool) Config {
	return Config{
		BaseURL:   url,
		Key:       testKey,
		Model:     "mock/echo",
		MaxTokens: 64,
		Stream:    stream,
		Timeout:   5 * time.Second,
	}
}

func TestRunAgainstFakeSimpang(t *testing.T) {
	const n, c = 6, 3
	cases := []struct {
		name   string
		mode   string
		stream bool
		check  func(t *testing.T, results []Result, r Report)
	}{
		{
			name: "streaming with usage", mode: "stream", stream: true,
			check: func(t *testing.T, results []Result, r Report) {
				if r.Successes != n || r.ErrorRate != 0 {
					t.Errorf("successes=%d error_rate=%g, want %d and 0", r.Successes, r.ErrorRate, n)
				}
				if r.Providers["fake-provider"] != n {
					t.Errorf("providers = %v, want fake-provider x%d", r.Providers, n)
				}
				if r.CompletionTokens != n*5 || r.EstimatedTokenResults != 0 {
					t.Errorf("tokens=%d estimated=%d, want %d and 0", r.CompletionTokens, r.EstimatedTokenResults, n*5)
				}
				for i, res := range results {
					if res.TTFT <= 0 || res.TTFT > res.Latency {
						t.Errorf("result %d: TTFT=%v latency=%v, want 0 < TTFT <= latency", i, res.TTFT, res.Latency)
					}
					if res.TokensPerSec <= 0 {
						t.Errorf("result %d: tokens/s not computed", i)
					}
				}
			},
		},
		{
			name: "streaming without usage is estimated", mode: "stream-no-usage", stream: true,
			check: func(t *testing.T, results []Result, r Report) {
				if r.EstimatedTokenResults != n {
					t.Errorf("estimated=%d, want %d", r.EstimatedTokenResults, n)
				}
				// Five text deltas were sent, so the estimate is five per request.
				if r.CompletionTokens != n*5 {
					t.Errorf("tokens=%d, want %d", r.CompletionTokens, n*5)
				}
			},
		},
		{
			name: "non-streaming", mode: "nonstream", stream: false,
			check: func(t *testing.T, results []Result, r Report) {
				if r.Successes != n {
					t.Errorf("successes=%d, want %d", r.Successes, n)
				}
				for i, res := range results {
					if res.TTFT != res.Latency {
						t.Errorf("result %d: non-stream TTFT=%v, want latency %v", i, res.TTFT, res.Latency)
					}
					if res.CompletionTokens != 5 || res.TokensEstimated {
						t.Errorf("result %d: tokens=%d estimated=%v, want 5 and false", i, res.CompletionTokens, res.TokensEstimated)
					}
				}
			},
		},
		{
			name: "upstream 500 is counted as error", mode: "error500", stream: false,
			check: func(t *testing.T, results []Result, r Report) {
				if r.Successes != 0 || r.ErrorRate != 1 {
					t.Errorf("successes=%d error_rate=%g, want 0 and 1", r.Successes, r.ErrorRate)
				}
				if r.ErrorsByStatus[500] != n || r.ErrorsByCode["upstream_failed"] != n {
					t.Errorf("errors status=%v code=%v, want 500 and upstream_failed x%d", r.ErrorsByStatus, r.ErrorsByCode, n)
				}
				if r.LatencyMs != (Dist{}) {
					t.Errorf("latency stats should ignore failures, got %+v", r.LatencyMs)
				}
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv := fakeSimpang(t, tc.mode)
			cfg := testConfig(srv.URL, tc.stream)

			results, wall := Run(context.Background(), cfg, BuildPrompt(8), n, c)
			if len(results) != n {
				t.Fatalf("got %d results, want %d", len(results), n)
			}
			tc.check(t, results, Summarize(results, wall))
		})
	}
}

func TestDoRejectsWrongKey(t *testing.T) {
	srv := fakeSimpang(t, "nonstream")
	cfg := testConfig(srv.URL, false)
	cfg.Key = "wrong"

	res := Do(context.Background(), cfg, "hi")
	if res.Status != http.StatusUnauthorized || res.ErrorCode != "invalid_api_key" {
		t.Errorf("got status=%d code=%q, want 401 invalid_api_key", res.Status, res.ErrorCode)
	}
}

func TestDoTimeoutIsRecorded(t *testing.T) {
	slow := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-time.After(2 * time.Second):
		}
	}))
	t.Cleanup(slow.Close)

	cfg := testConfig(slow.URL, false)
	cfg.Timeout = 50 * time.Millisecond
	res := Do(context.Background(), cfg, "hi")
	if res.ErrorCode != "timeout" || res.Status != 0 {
		t.Errorf("got status=%d code=%q, want status 0 and timeout", res.Status, res.ErrorCode)
	}
}

func TestBuildPromptWordCount(t *testing.T) {
	for _, n := range []int{1, 7, 50, 500} {
		if got := len(strings.Fields(BuildPrompt(n))); got != n {
			t.Errorf("BuildPrompt(%d) has %d words", n, got)
		}
	}
}
