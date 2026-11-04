// Command bench is a load-test and benchmark CLI for the Simpang LLM gateway.
//
// It sends chat completion requests with a configurable prompt size, output
// length, concurrency and streaming mode, and reports latency, time to first
// token, tokens per second, error rate and throughput. See README.md.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"time"
)

type options struct {
	cfg         Config
	n           int
	c           int
	promptWords int
	jsonOut     bool
}

func main() {
	opts, err := parseOptions(os.Args[1:], os.Getenv("SIMPANG_KEY"))
	if err != nil {
		if errors.Is(err, flag.ErrHelp) {
			os.Exit(0)
		}
		fmt.Fprintln(os.Stderr, "bench:", err)
		os.Exit(2)
	}

	// Ctrl-C cancels the context: in-flight requests are aborted and recorded as
	// "cancelled" failures, so the partial run is still summarised.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	// The default transport keeps only 2 idle connections per host. With more
	// workers than that, most requests would open a new TCP connection and the
	// latency numbers would include connection setup.
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.MaxIdleConnsPerHost = opts.c
	opts.cfg.Client = &http.Client{Transport: transport}

	mode := "non-streaming"
	if opts.cfg.Stream {
		mode = "streaming"
	}
	// Progress goes to stderr so that -json output on stdout stays parseable.
	// The key is deliberately not printed.
	fmt.Fprintf(os.Stderr, "bench: %d requests, concurrency %d, %s, model %s, target %s\n",
		opts.n, opts.c, mode, opts.cfg.Model, opts.cfg.BaseURL)

	prompt := BuildPrompt(opts.promptWords)
	results, wall := Run(ctx, opts.cfg, prompt, opts.n, opts.c)
	report := Summarize(results, wall)

	if opts.jsonOut {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		if err := enc.Encode(report); err != nil {
			fmt.Fprintln(os.Stderr, "bench:", err)
			os.Exit(1)
		}
		return
	}
	report.WriteTable(os.Stdout)
}

// parseOptions reads the command line. defaultKey is used when -key is not
// given; main passes $SIMPANG_KEY so that tests can exercise the logic without
// touching the environment.
func parseOptions(args []string, defaultKey string) (options, error) {
	var opts options
	fs := flag.NewFlagSet("bench", flag.ContinueOnError)
	fs.StringVar(&opts.cfg.BaseURL, "url", "http://localhost:3000", "Simpang base URL")
	// The key is not used as the flag default: flag would print it in -help.
	fs.StringVar(&opts.cfg.Key, "key", "", "Simpang API key (default: $SIMPANG_KEY)")
	fs.StringVar(&opts.cfg.Model, "model", "mock/echo", "model id to request")
	fs.IntVar(&opts.n, "n", 20, "total number of requests")
	fs.IntVar(&opts.c, "c", 4, "number of requests in flight at once")
	fs.IntVar(&opts.promptWords, "prompt-words", 50, "number of words in each prompt")
	fs.IntVar(&opts.cfg.MaxTokens, "max-tokens", 128, "max_tokens sent with each request")
	fs.BoolVar(&opts.cfg.Stream, "stream", true, "use streaming (SSE) responses")
	fs.DurationVar(&opts.cfg.Timeout, "timeout", 60*time.Second, "timeout per request")
	fs.BoolVar(&opts.jsonOut, "json", false, "print the summary as JSON")
	if err := fs.Parse(args); err != nil {
		return options{}, err
	}
	if opts.cfg.Key == "" {
		opts.cfg.Key = defaultKey
	}

	switch {
	case opts.cfg.Key == "":
		return options{}, errors.New("no API key: pass -key or set SIMPANG_KEY")
	case opts.n < 1:
		return options{}, errors.New("-n must be at least 1")
	case opts.c < 1:
		return options{}, errors.New("-c must be at least 1")
	case opts.promptWords < 1:
		return options{}, errors.New("-prompt-words must be at least 1")
	case opts.cfg.MaxTokens < 1:
		return options{}, errors.New("-max-tokens must be at least 1")
	case opts.cfg.Timeout <= 0:
		return options{}, errors.New("-timeout must be positive")
	}
	return opts, nil
}
