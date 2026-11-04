# Simpang bench

A small load-test CLI for the Simpang LLM gateway. It sends chat completion
requests at a chosen concurrency and reports how the gateway performs under a
realistic mix of prompt length, output length and streaming.

It is a separate Go module (`github.com/seppam/simpang/bench`) with only the
standard library, so it does not touch the TypeScript service.

## What it measures and why

The job requirement is to measure serving performance under realistic prompt
lengths, output lengths and concurrency. Each metric answers one part of that:

| Metric | Why it matters |
| --- | --- |
| **TTFT** (time to first token) | What a user waits before anything appears. For streaming it is the time to the first non-empty text delta. For non-streaming it equals the full latency, because nothing arrives earlier. |
| **Tokens/s** (per request) | Generation speed after the first token: `completion_tokens / (total - TTFT)`. Separating it from TTFT shows whether a slow answer is a slow start or slow decoding. |
| **Latency p50 / p95 / p99 / mean** | Full request time. p95 and p99 show the tail that users on a bad day hit. The mean hides it. |
| **Error rate** and errors by status/code | Failures are counted separately and never mixed into latency. A fast 503 must not make the gateway look faster. The breakdown shows whether errors are upstream (`provider_unavailable`), client-side (`timeout`) or transport. |
| **Provider counts** | From the `x-simpang-provider` header. Shows which upstream actually answered, which matters when Simpang routes or falls back. |
| **Throughput** | Successful requests per second and completion tokens per second over wall-clock time. This is what the gateway delivers at the chosen concurrency, and it is the number to compare when changing concurrency. |

Latency, TTFT and tokens/s are computed over **successful requests only**.

Streaming responses are only counted as successful if they reach `data: [DONE]`.
A stream that closes early is recorded as `stream_truncated`, so it cannot
look like a fast success.

## Build and test

From this directory (`bench/`):

```sh
gofmt -l .
go vet ./...
go test ./...
go build -o bench .
```

Go 1.23 or newer is required (the module declares `go 1.23`).

## Usage

The API key is read from `-key` or, if that is not given, from `$SIMPANG_KEY`.
The key is never printed, and it is not shown in `-help` output.

```sh
export SIMPANG_KEY=...   # set in your shell, do not paste it into chat or commit it

# Default: 20 streaming requests, 4 in flight, 50-word prompts, max_tokens 128
./bench -url http://localhost:3000

# Realistic chat load: long prompts, medium outputs, 16 concurrent users
./bench -n 200 -c 16 -prompt-words 400 -max-tokens 256

# Non-streaming baseline, to compare against streaming TTFT
./bench -stream=false -n 100 -c 8

# Machine-readable output for a script or a dashboard
./bench -n 100 -c 8 -json > run.json
```

### Flags

| Flag | Default | Meaning |
| --- | --- | --- |
| `-url` | `http://localhost:3000` | Simpang base URL; `/v1/chat/completions` is appended |
| `-key` | `$SIMPANG_KEY` | Bearer key |
| `-model` | `mock/echo` | `model` sent in the request |
| `-n` | `20` | Total number of requests |
| `-c` | `4` | Maximum requests in flight at once |
| `-prompt-words` | `50` | Words in each prompt (fixed vocabulary, so the size is exact) |
| `-max-tokens` | `128` | `max_tokens` sent with each request |
| `-stream` | `true` | Use SSE streaming; `false` for a single JSON response |
| `-timeout` | `60s` | Timeout per request, covering the whole response |
| `-json` | `false` | Print the summary as JSON instead of a table |

Progress is printed to stderr, so `-json` output on stdout stays parseable.
Pressing Ctrl-C aborts in-flight requests and still prints the partial summary.

## Example output

Streaming run against a local stub that simulates a provider (about 150 ms to
first token, 10 ms per token). The numbers show how the tool reports, not how
the real gateway performs:

```
$ SIMPANG_KEY=... ./bench -url http://127.0.0.1:8799 -n 40 -c 4 -prompt-words 200 -max-tokens 40
bench: 40 requests, concurrency 4, streaming, model mock/echo, target http://127.0.0.1:8799
requests          40
successes         38
error rate        5.00%
errors by code    provider_unavailable=2
errors by status  503=2
providers         stub-provider=38

metric        p50    p95    p99    mean
latency (ms)  640.3  670.9  678.5  640.7
ttft (ms)     167.1  170.4  170.7  166.8

tokens/s (mean per request)  84.5
completion tokens            1520
wall time (s)                6.41
requests/s                   5.93
completion tokens/s          237.1
```

With `-json` the same run produces an object with the fields `requests`,
`successes`, `error_rate`, `errors_by_status`, `errors_by_code`, `providers`,
`latency_ms`, `ttft_ms` (each with `p50`, `p95`, `p99`, `mean`),
`tokens_per_sec_mean`, `completion_tokens`, `estimated_token_results`,
`wall_seconds`, `requests_per_sec` and `completion_tokens_per_sec`.

## Caveats

- **Estimated tokens.** When Simpang sends no `usage` object, streaming counts
  text deltas and non-streaming estimates the output as characters / 4. Those
  requests are flagged in the table (`estimated`) and in
  `estimated_token_results`, so the tokens/s figures can be read with that in
  mind.
- **Identical prompts.** Every request sends the same prompt. If a provider or
  cache in front of it answers repeated prompts faster, the latency numbers are
  optimistic. Compare runs with that in mind, or change the prompt between runs.
- **Client limits.** The client raises its idle connection pool to `-c`, so
  connection setup does not show up in latency. Very high `-c` can still be
  limited by the machine running the benchmark. Run it from a machine with
  spare CPU and a low-latency network path to Simpang.
- **Error codes.** Transport-level failures are reported as `status 0` with
  codes such as `timeout`, `transport_error` and `stream_error`, so they are
  distinguishable from HTTP errors.
