package main

import (
	"math"
	"testing"
)

func approxEqual(a, b, eps float64) bool {
	return math.Abs(a-b) <= eps
}

func TestPercentileInterpolatesBetweenRanks(t *testing.T) {
	sorted := []float64{1, 2, 3, 4}
	cases := []struct {
		p    float64
		want float64
	}{
		{0, 1},
		{25, 1.75},
		{50, 2.5},
		{95, 3.85},
		{100, 4},
	}
	for _, tc := range cases {
		got := Percentile(sorted, tc.p)
		if !approxEqual(got, tc.want, 1e-9) {
			t.Errorf("Percentile(%v, %g) = %g, want %g", sorted, tc.p, got, tc.want)
		}
	}
}

func TestPercentileEdgeCases(t *testing.T) {
	if got := Percentile(nil, 95); got != 0 {
		t.Errorf("empty sample: got %g, want 0", got)
	}
	if got := Percentile([]float64{7}, 99); got != 7 {
		t.Errorf("single value: got %g, want 7", got)
	}
	// Out-of-range p is clamped rather than indexing outside the slice.
	if got := Percentile([]float64{1, 2}, 150); got != 2 {
		t.Errorf("p>100: got %g, want 2", got)
	}
}

func TestDescribeSortsCopyAndComputesTails(t *testing.T) {
	xs := make([]float64, 0, 100)
	for i := 100; i >= 1; i-- { // deliberately unsorted input
		xs = append(xs, float64(i))
	}
	original := append([]float64(nil), xs...)

	d := Describe(xs)

	for i := range xs {
		if xs[i] != original[i] {
			t.Fatalf("Describe modified its input at index %d", i)
		}
	}
	// For 1..100 with linear interpolation: rank = p/100*99.
	if !approxEqual(d.P50, 50.5, 1e-9) {
		t.Errorf("P50 = %g, want 50.5", d.P50)
	}
	if !approxEqual(d.P95, 95.05, 1e-9) {
		t.Errorf("P95 = %g, want 95.05", d.P95)
	}
	if !approxEqual(d.P99, 99.01, 1e-9) {
		t.Errorf("P99 = %g, want 99.01", d.P99)
	}
	if !approxEqual(d.Mean, 50.5, 1e-9) {
		t.Errorf("Mean = %g, want 50.5", d.Mean)
	}
}

func TestDescribeEmpty(t *testing.T) {
	if d := Describe(nil); d != (Dist{}) {
		t.Errorf("empty sample: got %+v, want zero Dist", d)
	}
	if m := Mean(nil); m != 0 {
		t.Errorf("Mean(nil) = %g, want 0", m)
	}
}
