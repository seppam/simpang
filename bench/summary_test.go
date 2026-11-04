package main

import (
	"bytes"
	"math"
	"strings"
	"testing"
	"time"
)

func TestSummarizeSeparatesFailuresAndCountsRates(t *testing.T) {
	results := []Result{
		{Status: 200, Provider: "a", Latency: 1000 * time.Millisecond, TTFT: 200 * time.Millisecond, CompletionTokens: 10, TokensPerSec: 12.5},
		{Status: 200, Provider: "a", Latency: 2000 * time.Millisecond, TTFT: 400 * time.Millisecond, CompletionTokens: 20, TokensPerSec: 7.5, TokensEstimated: true},
		{Status: 500, Provider: "b", Latency: 50 * time.Millisecond, ErrorCode: "upstream_failed"},
		{Status: 0, ErrorCode: "timeout"},
	}

	r := Summarize(results, 4*time.Second)

	if r.Requests != 4 || r.Successes != 2 {
		t.Fatalf("requests=%d successes=%d, want 4 and 2", r.Requests, r.Successes)
	}
	if math.Abs(r.ErrorRate-0.5) > 1e-9 {
		t.Errorf("error rate = %g, want 0.5", r.ErrorRate)
	}
	if r.ErrorsByStatus[500] != 1 || r.ErrorsByStatus[0] != 1 {
		t.Errorf("errors by status = %v", r.ErrorsByStatus)
	}
	if r.ErrorsByCode["timeout"] != 1 || r.ErrorsByCode["upstream_failed"] != 1 {
		t.Errorf("errors by code = %v", r.ErrorsByCode)
	}
	if r.Providers["a"] != 2 || r.Providers["b"] != 1 {
		t.Errorf("providers = %v", r.Providers)
	}
	// Latency is over the two successes only: 1000 ms and 2000 ms.
	if math.Abs(r.LatencyMs.P50-1500) > 1e-9 || math.Abs(r.LatencyMs.Mean-1500) > 1e-9 {
		t.Errorf("latency p50=%g mean=%g, want 1500", r.LatencyMs.P50, r.LatencyMs.Mean)
	}
	if math.Abs(r.TokensPerSecMean-10) > 1e-9 {
		t.Errorf("tokens/s mean = %g, want 10", r.TokensPerSecMean)
	}
	if r.CompletionTokens != 30 || r.EstimatedTokenResults != 1 {
		t.Errorf("completion tokens=%d estimated=%d, want 30 and 1", r.CompletionTokens, r.EstimatedTokenResults)
	}
	// Throughput uses the wall clock: 2 successes in 4 s, 30 tokens in 4 s.
	if math.Abs(r.RequestsPerSec-0.5) > 1e-9 || math.Abs(r.CompletionTokensPerSec-7.5) > 1e-9 {
		t.Errorf("rps=%g tps=%g, want 0.5 and 7.5", r.RequestsPerSec, r.CompletionTokensPerSec)
	}
}

func TestSummarizeAllFailuresDoesNotDivideByZero(t *testing.T) {
	r := Summarize([]Result{{Status: 503, ErrorCode: "unavailable"}}, 0)
	if r.ErrorRate != 1 || r.Successes != 0 {
		t.Errorf("error rate=%g successes=%d", r.ErrorRate, r.Successes)
	}
	if r.RequestsPerSec != 0 || r.CompletionTokensPerSec != 0 {
		t.Errorf("throughput should be 0 for zero wall time")
	}
	if r.LatencyMs != (Dist{}) {
		t.Errorf("latency = %+v, want zero", r.LatencyMs)
	}
}

func TestWriteTableMentionsEstimatedTokens(t *testing.T) {
	r := Summarize([]Result{{Status: 200, Latency: time.Second, TTFT: time.Millisecond, CompletionTokens: 4, TokensPerSec: 4, TokensEstimated: true}}, time.Second)
	var buf bytes.Buffer
	r.WriteTable(&buf)
	out := buf.String()
	for _, want := range []string{"error rate", "p95", "ttft (ms)", "estimated"} {
		if !strings.Contains(out, want) {
			t.Errorf("table missing %q:\n%s", want, out)
		}
	}
}
