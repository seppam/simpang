package main

import (
	"testing"
	"time"
)

func TestParseOptionsDefaults(t *testing.T) {
	opts, err := parseOptions(nil, "env-key")
	if err != nil {
		t.Fatal(err)
	}
	if opts.cfg.BaseURL != "http://localhost:3000" || opts.cfg.Model != "mock/echo" {
		t.Errorf("unexpected defaults: url=%q model=%q", opts.cfg.BaseURL, opts.cfg.Model)
	}
	if opts.n != 20 || opts.c != 4 || opts.promptWords != 50 || opts.cfg.MaxTokens != 128 {
		t.Errorf("unexpected numeric defaults: %+v", opts)
	}
	if !opts.cfg.Stream || opts.cfg.Timeout != 60*time.Second {
		t.Errorf("stream=%v timeout=%v, want true and 60s", opts.cfg.Stream, opts.cfg.Timeout)
	}
	if opts.cfg.Key != "env-key" {
		t.Errorf("key not taken from environment default")
	}
}

func TestParseOptionsFlagKeyWinsOverEnv(t *testing.T) {
	opts, err := parseOptions([]string{"-key", "flag-key", "-stream=false"}, "env-key")
	if err != nil {
		t.Fatal(err)
	}
	if opts.cfg.Key != "flag-key" || opts.cfg.Stream {
		t.Errorf("key=%q stream=%v, want flag-key and false", opts.cfg.Key, opts.cfg.Stream)
	}
}

func TestParseOptionsRejectsBadInput(t *testing.T) {
	cases := map[string][]string{
		"missing key":  {},
		"zero n":       {"-key", "k", "-n", "0"},
		"zero c":       {"-key", "k", "-c", "0"},
		"zero words":   {"-key", "k", "-prompt-words", "0"},
		"zero timeout": {"-key", "k", "-timeout", "0s"},
	}
	for name, args := range cases {
		if _, err := parseOptions(args, ""); err == nil {
			t.Errorf("%s: expected an error", name)
		}
	}
}
