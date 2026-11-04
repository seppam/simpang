package main

import (
	"math"
	"slices"
)

// Dist summarises one sample of measurements (milliseconds in this tool).
type Dist struct {
	P50  float64 `json:"p50"`
	P95  float64 `json:"p95"`
	P99  float64 `json:"p99"`
	Mean float64 `json:"mean"`
}

// Describe returns the median, p95, p99 and mean of xs. The input slice is not
// modified. An empty sample yields the zero Dist so that a run with no
// successful requests still produces a readable report.
func Describe(xs []float64) Dist {
	if len(xs) == 0 {
		return Dist{}
	}
	sorted := slices.Clone(xs)
	slices.Sort(sorted)
	return Dist{
		P50:  Percentile(sorted, 50),
		P95:  Percentile(sorted, 95),
		P99:  Percentile(sorted, 99),
		Mean: Mean(xs),
	}
}

// Percentile returns the p-th percentile (0-100) of an already sorted sample.
//
// It interpolates linearly between the two closest ranks, the same method as
// Excel's PERCENTILE.INC. Interpolation matters for small runs: a nearest-rank
// p95 over 20 requests is just the 19th value, whereas interpolation gives a
// value that moves smoothly as the sample changes.
func Percentile(sorted []float64, p float64) float64 {
	n := len(sorted)
	if n == 0 {
		return 0
	}
	if n == 1 {
		return sorted[0]
	}
	p = math.Min(math.Max(p, 0), 100)
	rank := p / 100 * float64(n-1)
	lo := int(math.Floor(rank))
	hi := int(math.Ceil(rank))
	frac := rank - float64(lo)
	return sorted[lo] + frac*(sorted[hi]-sorted[lo])
}

// Mean returns the arithmetic mean of xs, or 0 for an empty slice.
func Mean(xs []float64) float64 {
	if len(xs) == 0 {
		return 0
	}
	var sum float64
	for _, x := range xs {
		sum += x
	}
	return sum / float64(len(xs))
}
