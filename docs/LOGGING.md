# Logging Reference

`claude-code-ollama-proxy` emits structured, OpenTelemetry-compatible log
records so that every request, response, and translation step can be observed,
aggregated, and queried.

---

## Log Format

Every log record is a single JSON object on its own line (**NDJSON**) written
to **stdout**. The schema follows the
[OTEL LogRecord data model](https://opentelemetry.io/docs/specs/otel/logs/data-model/):

```json
{
  "Timestamp":      "2024-01-01T12:00:00.000Z",
  "SeverityNumber": 9,
  "SeverityText":   "INFO",
  "Body":           "Request received",
  "Attributes": {
    "http.method":       "POST",
    "http.target":       "/v1/messages",
    "proxy.request_id":  "req_a1b2c3d4"
  },
  "Resource": {
    "service.name":    "claude-code-ollama-proxy",
    "service.version": "0.1.0"
  }
}
```

### OTEL Severity Numbers

| `SeverityText` | `SeverityNumber` |
|----------------|-----------------|
| DEBUG          | 5               |
| INFO           | 9               |
| WARN           | 13              |
| ERROR          | 17              |

---

## Log Levels

Configure the minimum level to emit with `--log-level`:

| Level   | Records emitted |
|---------|----------------|
| `error` | Connection errors, Ollama response errors, unhandled exceptions |
| `warn`  | Thinking field stripped for non-thinking-capable models |
| `info`  | HTTP request received + completed (method, path, status, latency) |
| `debug` | Full Anthropic request body, Ollama request/response bodies, per-chunk SSE data |

### Performance

Records below the configured threshold are suppressed **before any body
serialisation**, so running at `info` level (the default) carries zero overhead
for debug-level body logging in streaming hot paths.

---

## Configuration

### CLI flag (highest precedence)

```bash
node dist/cli.js --log-level debug
node dist/cli.js --log-level error     # production minimum
node dist/cli.js --verbose             # shorthand for --log-level debug
```

### Environment variable

```bash
LOG_LEVEL=debug node dist/cli.js
```

### Config file (`proxy.config.json`)

```json
{
  "version": "1",
  "logLevel": "info"
}
```

### Precedence

```
proxy.config.json  <  LOG_LEVEL env var  <  --log-level CLI flag
```

`--verbose` maps to `--log-level debug` when `--log-level` is not given.

---

## What Is Logged

### INFO level (default, production-safe)

Two records per HTTP request:

**Request received:**
```json
{
  "Body": "Request received",
  "Attributes": {
    "http.method":      "POST",
    "http.target":      "/v1/messages",
    "proxy.request_id": "req_a1b2c3d4"
  }
}
```

**Request completed:**
```json
{
  "Body": "Request completed",
  "Attributes": {
    "http.method":       "POST",
    "http.target":       "/v1/messages",
    "http.status_code":  200,
    "proxy.latency_ms":  42,
    "proxy.request_id":  "req_a1b2c3d4"
  }
}
```

### WARN level

Thinking field silently stripped:
```json
{
  "Body": "Thinking field stripped for non-thinking model",
  "Attributes": {
    "proxy.request_id":    "req_a1b2c3d4",
    "proxy.ollama_model":  "llama3.1",
    "proxy.requested_model": "claude-sonnet-4-5"
  }
}
```

### DEBUG level (development)

Full request and response bodies:

| Body | Key attributes |
|------|---------------|
| `"Anthropic request body"` | `proxy.anthropic_request` (full request JSON) |
| `"Ollama request body"` | `proxy.ollama_request` (full Ollama request JSON) |
| `"Ollama response body"` | `proxy.ollama_response` (non-streaming only) |
| `"Ollama stream chunk"` | `proxy.stream_chunk` (one per SSE chunk) |

### ERROR level

```json
{
  "Body": "Request error",
  "Attributes": {
    "proxy.request_id":   "req_a1b2c3d4",
    "error.type":         "api_connection_error",
    "error.message":      "Cannot connect to Ollama at …",
    "http.status_code":   502
  }
}
```

---

## Request Correlation

Every request is assigned a short unique ID (`req_<8 hex chars>`) at the
middleware layer. All log records for a request share the same
`proxy.request_id` attribute, enabling easy filtering:

```bash
# Stream proxy logs and filter by a specific request
node dist/cli.js --log-level debug | grep '"req_a1b2c3d4"'

# With jq
node dist/cli.js --log-level debug | jq 'select(.Attributes["proxy.request_id"] == "req_a1b2c3d4")'
```

---

## OpenTelemetry Collector Integration

The devcontainer ships with `otelcol` (OpenTelemetry Collector) pre-installed.
To forward proxy logs to a backend (Loki, Elasticsearch, OTLP endpoint, etc.):

### Option A — pipe proxy stdout to otelcol

```bash
node dist/cli.js --log-level info | otelcol --config otelcol-config.yaml
```

### Option B — write to a file, use filelog receiver

```bash
# Terminal 1: run proxy with log file
node dist/cli.js --log-level info >> /var/log/proxy.ndjson

# Terminal 2: run otelcol
otelcol --config otelcol-config.yaml
```

### Sample `otelcol-config.yaml`

```yaml
receivers:
  filelog:
    include:
      - /var/log/proxy.ndjson
    operators:
      - type: json_parser
        timestamp:
          parse_from: attributes.Timestamp
          layout: "%Y-%m-%dT%H:%M:%S.%LZ"
        severity:
          parse_from: attributes.SeverityText

exporters:
  otlp:
    endpoint: http://jaeger:4317    # replace with your backend
  debug:
    verbosity: normal               # prints to otelcol stdout for quick testing

service:
  pipelines:
    logs:
      receivers: [filelog]
      exporters: [debug]
```

### Direct OTLP export (advanced)

If you configure an OTLP log exporter, you can send records directly to an
OTLP endpoint without a file intermediary. The NDJSON stdout format is
interchangeable with any OTEL-compatible log ingestion pipeline.

---

## Development Quick-Start

```bash
# Full debug logging to terminal (pretty-print with jq)
node dist/cli.js --log-level debug | jq -r '"[\(.SeverityText)] \(.Body) \(.Attributes | tostring)"'

# Only errors and warnings
node dist/cli.js --log-level warn

# Silence everything except fatal errors (production minimum)
node dist/cli.js --log-level error
```

---

## Implementation Notes

- **`src/logger.ts`** — `Logger` class + `createLogger` factory + `parseLogLevel` + `generateRequestId`
- **`src/server.ts`** — creates a Logger from `config.logLevel`, adds middleware, replaces all `console.*` calls
- **`src/types.ts`** — `LogLevel` type + optional `logLevel` field on `ProxyConfig`
- **`src/config.ts`** — `logLevel` field in `ProxyConfigFile`; merged in `mergeConfig`
