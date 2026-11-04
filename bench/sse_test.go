package main

import (
	"errors"
	"io"
	"reflect"
	"strings"
	"testing"
	"testing/iotest"
)

func collectEvents(t *testing.T, r io.Reader) []string {
	t.Helper()
	var got []string
	err := ReadEvents(r, func(data string) error {
		got = append(got, data)
		return nil
	})
	if err != nil {
		t.Fatalf("ReadEvents: %v", err)
	}
	return got
}

func TestReadEventsHandlesChunksSplitMidLine(t *testing.T) {
	stream := "data: {\"a\":1}\n\ndata: {\"b\":2}\n\n"
	// OneByteReader delivers one byte per Read, so every line and every JSON
	// token is split across reads. This is the realistic worst case for TCP.
	got := collectEvents(t, iotest.OneByteReader(strings.NewReader(stream)))
	want := []string{`{"a":1}`, `{"b":2}`}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestReadEventsJoinsMultilineData(t *testing.T) {
	got := collectEvents(t, strings.NewReader("data: line1\ndata: line2\n\n"))
	if !reflect.DeepEqual(got, []string{"line1\nline2"}) {
		t.Errorf("got %q, want one event joined with newline", got)
	}
}

func TestReadEventsIgnoresCommentsAndAcceptsCRLF(t *testing.T) {
	stream := ": keep-alive\r\n\r\ndata: x\r\n\r\n"
	got := collectEvents(t, strings.NewReader(stream))
	if !reflect.DeepEqual(got, []string{"x"}) {
		t.Errorf("got %q, want [x]", got)
	}
}

func TestReadEventsDeliversTrailingEventAtEOF(t *testing.T) {
	got := collectEvents(t, strings.NewReader("data: last"))
	if !reflect.DeepEqual(got, []string{"last"}) {
		t.Errorf("got %q, want [last]", got)
	}
}

func TestReadEventsLongLine(t *testing.T) {
	// Larger than bufio.Scanner's default 64 KiB token limit.
	big := strings.Repeat("x", 200*1024)
	got := collectEvents(t, strings.NewReader("data: "+big+"\n\n"))
	if len(got) != 1 || got[0] != big {
		t.Fatalf("long line not delivered intact: got %d events", len(got))
	}
}

func TestReadEventsStopsOnCallbackError(t *testing.T) {
	stop := errors.New("stop")
	calls := 0
	err := ReadEvents(strings.NewReader("data: a\n\ndata: b\n\n"), func(string) error {
		calls++
		return stop
	})
	if !errors.Is(err, stop) || calls != 1 {
		t.Errorf("err=%v calls=%d, want stop error after one call", err, calls)
	}
}

func TestStreamSequenceEndsWithDone(t *testing.T) {
	stream := "data: {\"choices\":[{\"delta\":{\"content\":\"Hi\"}}]}\n\n" +
		"data: {\"choices\":[],\"usage\":{\"prompt_tokens\":3,\"completion_tokens\":1,\"total_tokens\":4}}\n\n" +
		"data: [DONE]\n\n"
	got := collectEvents(t, strings.NewReader(stream))
	if len(got) != 3 || got[len(got)-1] != DoneMarker {
		t.Fatalf("got %d events, last %q; want 3 ending with [DONE]", len(got), got)
	}
}

func TestParseChunkText(t *testing.T) {
	c, err := ParseChunk(`{"choices":[{"delta":{"content":"hello"}}]}`)
	if err != nil {
		t.Fatal(err)
	}
	if c.Text() != "hello" || c.Usage != nil || c.Error != nil {
		t.Errorf("unexpected chunk: %+v", c)
	}
}

func TestParseChunkEmptyChoicesText(t *testing.T) {
	c, err := ParseChunk(`{"choices":[]}`)
	if err != nil {
		t.Fatal(err)
	}
	if c.Text() != "" {
		t.Errorf("Text() = %q, want empty", c.Text())
	}
}

func TestParseChunkUsage(t *testing.T) {
	c, err := ParseChunk(`{"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":7,"total_tokens":10}}`)
	if err != nil {
		t.Fatal(err)
	}
	if c.Usage == nil || c.Usage.CompletionTokens != 7 || c.Usage.TotalTokens != 10 {
		t.Errorf("usage not parsed: %+v", c.Usage)
	}
}

func TestParseChunkError(t *testing.T) {
	c, err := ParseChunk(`{"error":{"type":"upstream_error","code":"provider_timeout","message":"slow"}}`)
	if err != nil {
		t.Fatal(err)
	}
	if c.Error == nil || c.Error.ErrorCode() != "provider_timeout" {
		t.Errorf("error chunk not parsed: %+v", c.Error)
	}
}

func TestAPIErrorCodeFallbacks(t *testing.T) {
	cases := []struct {
		name string
		err  APIError
		want string
	}{
		{"code wins", APIError{Type: "t", Code: "c"}, "c"},
		{"falls back to type", APIError{Type: "t"}, "t"},
		{"numeric code", APIError{Code: float64(429)}, "429"},
		{"nothing set", APIError{}, "unknown"},
	}
	for _, tc := range cases {
		if got := tc.err.ErrorCode(); got != tc.want {
			t.Errorf("%s: got %q, want %q", tc.name, got, tc.want)
		}
	}
}
