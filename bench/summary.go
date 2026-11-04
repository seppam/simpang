package main

import (
	"cmp"
	"fmt"
	"io"
	"maps"
	"slices"
	"strings"
	"text/tabwriter"
	"time"
)

// Report is the summary of one benchmark run. Latency, TTFT and tokens/s
// are computed over successful requests only; failures are counted separately
// so that a fast failure cannot make the latency look better.
type Report struct {
	Requests       int            `json:"requests"`
	Successes      int            `json:"successes"`
	ErrorRate      float64        `json:"error_rate"`
	ErrorsByStatus map[int]int    `json:"errors_by_status"`
	ErrorsByCode   map[string]int `json:"errors_by_code"`
	Providers      map[string]int `json:"providers"`

	LatencyMs Dist `json:"latency_ms"`
	TTFTMs    Dist `json:"ttft_ms"`
	// TokensPerSecMean is the mean of the per-request rates.
	TokensPerSecMean float64 `json:"tokens_per_sec_mean"`

	CompletionTokens      int `json:"completion_tokens"`
	EstimatedTokenResults int `json:"estimated_token_results"`

	WallSeconds float64 `json:"wall_seconds"`
	// RequestsPerSec counts successful requests over wall-clock time.
	RequestsPerSec float64 `json:"requests_per_sec"`
	// CompletionTokensPerSec is total generated tokens over wall-clock time,
	// i.e. the throughput the gateway delivers with this concurrency.
	CompletionTokensPerSec float64 `json:"completion_tokens_per_sec"`
}

// Summarize aggregates results collected over the given wall-clock duration.
func Summarize(results []Result, wall time.Duration) Report {
	r := Report{
		Requests:       len(results),
		ErrorsByStatus: map[int]int{},
		ErrorsByCode:   map[string]int{},
		Providers:      map[string]int{},
	}

	var latencies, ttfts, rates []float64
	for _, res := range results {
		if res.Provider != "" {
			r.Providers[res.Provider]++
		}
		if !res.OK() {
			r.ErrorsByStatus[res.Status]++
			r.ErrorsByCode[res.ErrorCode]++
			continue
		}
		r.Successes++
		latencies = append(latencies, durationMs(res.Latency))
		if res.TTFT > 0 {
			ttfts = append(ttfts, durationMs(res.TTFT))
		}
		if res.TokensPerSec > 0 {
			rates = append(rates, res.TokensPerSec)
		}
		r.CompletionTokens += res.CompletionTokens
		if res.TokensEstimated {
			r.EstimatedTokenResults++
		}
	}

	if r.Requests > 0 {
		r.ErrorRate = float64(r.Requests-r.Successes) / float64(r.Requests)
	}
	r.LatencyMs = Describe(latencies)
	r.TTFTMs = Describe(ttfts)
	r.TokensPerSecMean = Mean(rates)

	r.WallSeconds = wall.Seconds()
	if r.WallSeconds > 0 {
		r.RequestsPerSec = float64(r.Successes) / r.WallSeconds
		r.CompletionTokensPerSec = float64(r.CompletionTokens) / r.WallSeconds
	}
	return r
}

func durationMs(d time.Duration) float64 {
	return float64(d) / float64(time.Millisecond)
}

// WriteTable prints the report as a human-readable table.
func (r Report) WriteTable(w io.Writer) {
	tw := tabwriter.NewWriter(w, 0, 0, 2, ' ', 0)
	fmt.Fprintf(tw, "requests\t%d\n", r.Requests)
	fmt.Fprintf(tw, "successes\t%d\n", r.Successes)
	fmt.Fprintf(tw, "error rate\t%.2f%%\n", r.ErrorRate*100)
	if len(r.ErrorsByCode) > 0 {
		fmt.Fprintf(tw, "errors by code\t%s\n", formatCounts(r.ErrorsByCode))
		fmt.Fprintf(tw, "errors by status\t%s\n", formatCounts(r.ErrorsByStatus))
	}
	if len(r.Providers) > 0 {
		fmt.Fprintf(tw, "providers\t%s\n", formatCounts(r.Providers))
	}
	fmt.Fprintln(tw)

	fmt.Fprintln(tw, "metric\tp50\tp95\tp99\tmean")
	fmt.Fprintf(tw, "latency (ms)\t%s\t%s\t%s\t%s\n", ms(r.LatencyMs.P50), ms(r.LatencyMs.P95), ms(r.LatencyMs.P99), ms(r.LatencyMs.Mean))
	fmt.Fprintf(tw, "ttft (ms)\t%s\t%s\t%s\t%s\n", ms(r.TTFTMs.P50), ms(r.TTFTMs.P95), ms(r.TTFTMs.P99), ms(r.TTFTMs.Mean))
	fmt.Fprintln(tw)

	fmt.Fprintf(tw, "tokens/s (mean per request)\t%.1f\n", r.TokensPerSecMean)
	est := ""
	if r.EstimatedTokenResults > 0 {
		est = fmt.Sprintf(" (%d request(s) estimated, no usage object)", r.EstimatedTokenResults)
	}
	fmt.Fprintf(tw, "completion tokens\t%d%s\n", r.CompletionTokens, est)
	fmt.Fprintf(tw, "wall time (s)\t%.2f\n", r.WallSeconds)
	fmt.Fprintf(tw, "requests/s\t%.2f\n", r.RequestsPerSec)
	fmt.Fprintf(tw, "completion tokens/s\t%.1f\n", r.CompletionTokensPerSec)
	tw.Flush()
}

func ms(v float64) string { return fmt.Sprintf("%.1f", v) }

// formatCounts renders a count map as "key=n, key=n" with keys in sorted order,
// so the same run always prints the same text.
func formatCounts[K cmp.Ordered](m map[K]int) string {
	keys := slices.Sorted(maps.Keys(m))
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		parts = append(parts, fmt.Sprintf("%v=%d", k, m[k]))
	}
	return strings.Join(parts, ", ")
}
