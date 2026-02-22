# Logging Implementation Plan

## Goal

Add structured, OpenTelemetry-compatible logging to the proxy that:
- Captures every request, response, and key transformation step
- Is configurable by log level so dev environments get full visibility and
  production environments emit only essential records without performance impact
- Emits **OTEL LogRecord JSON** (one record per line / NDJSON) that the bundled
  `otelcol` can forward to any OTEL-compatible backend

---

## OpenTelemetry Log Record Format

Reference: [OTEL Log Data Model](https://opentelemetry.io/docs/specs/otel/logs/data-model/)

```json
{
  "Timestamp":      "2024-01-01T00:00:00.000Z",
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

### OTEL Severity Numbers (canonical values used)

| Level | SeverityNumber | SeverityText |
|-------|---------------|--------------|
| DEBUG |  5            | DEBUG        |
| INFO  |  9            | INFO         |
| WARN  | 13            | WARN         |
| ERROR | 17            | ERROR        |

---

## What Is Logged at Each Level

| Level | Records emitted |
|-------|----------------|
| `error` | Connection errors, Ollama response errors, unhandled exceptions |
| `warn`  | Thinking field stripped for non-capable models |
| `info`  | HTTP request received (method, path, requestId); HTTP request completed (status, latency ms) |
| `debug` | Full Anthropic request body; full Ollama request body; full Ollama response body (non-streaming); per-chunk SSE data (streaming) |

### Performance reasoning

At **INFO** level (default, production-safe):
- Two log records per request (in + out) with no body serialisation
- No per-chunk work in streaming handlers
- `shouldLog()` short-circuits before any string or object work

At **DEBUG** level (development):
- Bodies serialised as JSON within the `Attributes` map
- Per-chunk streaming events logged — useful for debugging SSE issues

---

## Architecture

```
CLI (cli.ts)
  ├── reads --log-level / LOG_LEVEL env var / config file
  ├── derives LogLevel (default: "info")
  └── passes logLevel inside ProxyConfig → createServer()

createServer(config)
  ├── createLogger({ level, serviceName, serviceVersion })
  ├── Express middleware: request in (INFO) + response finish (INFO)
  ├── /v1/messages route: debug body, warn thinking strip, debug ollama req
  │   ├── handleNonStreaming: debug ollama response
  │   └── handleStreaming:    debug per-chunk
  └── handleError: error record

Logger (src/logger.ts)
  ├── shouldLog(level): SEVERITY_NUMBERS[level] >= threshold → fast no-op
  └── emit(): JSON.stringify(OtelLogRecord) → process.stdout.write(…)
```

### Why stdout (not stderr)?

The OTEL collector's `filelog` receiver and log-forwarding pipelines typically
read **stdout** as structured NDJSON. stderr is reserved for startup/human
output only. All operational log records go to stdout.

---

## Configuration Surface

### CLI flag (new)

```
--log-level <level>   error | warn | info | debug  (default: info)
```

Environment variable alternative: `LOG_LEVEL=debug`

### Config file (`proxy.config.json`)

```json
{ "logLevel": "debug" }
```

### Precedence

```
config file < LOG_LEVEL env var < --log-level CLI flag
```

### Backward compatibility

The existing `--verbose` flag is kept and now maps to `--log-level debug` if
`--log-level` is not given explicitly.  The `verbose` field in `ProxyConfig`
and `proxy.config.json` remains valid.

---

## `src/logger.ts` API

```typescript
export type LogLevel = "error" | "warn" | "info" | "debug"; // defined in types.ts

export type OtelLogRecord = {
  Timestamp:      string;
  SeverityNumber: number;
  SeverityText:   string;
  Body:           string;
  Attributes:     Record<string, unknown>;
  Resource:       Record<string, string>;
};

export class Logger {
  error(body: string, attributes?: Record<string, unknown>): void;
  warn (body: string, attributes?: Record<string, unknown>): void;
  info (body: string, attributes?: Record<string, unknown>): void;
  debug(body: string, attributes?: Record<string, unknown>): void;
}

export function createLogger(config: {
  level: LogLevel;
  serviceName: string;
  serviceVersion: string;
}): Logger;

export function parseLogLevel(value: string): LogLevel; // throws on invalid
export function generateRequestId(): string;            // "req_<8 hex>"
```

---

## Type Changes

### `src/types.ts`

Add `LogLevel` union type (exported, shared with logger):

```typescript
export type LogLevel = "error" | "warn" | "info" | "debug";
```

Add optional `logLevel` to `ProxyConfig`:

```typescript
export type ProxyConfig = {
  // … existing fields …
  logLevel?: LogLevel;   // if absent, derived from verbose (true → debug, false → info)
};
```

### `src/config.ts`

Add `logLevel?: string` to `ProxyConfigFile`.
Handle in `mergeConfig` with the same pattern as `strictThinking`.

---

## devcontainer / otelcol Integration

The devcontainer ships with `otelcol` (OpenTelemetry Collector) pre-installed at
`/usr/bin/otelcol`. To forward proxy logs to an OTEL backend, configure the
collector to read the proxy's stdout via a `filelog` receiver, or start the
proxy with stdout piped to the collector directly. A sample
`otelcol-config.yaml` is documented in `docs/LOGGING.md`.

---

## Files Affected

| File | Change |
|------|--------|
| `src/logger.ts`         | **new** — Logger class, createLogger, parseLogLevel, generateRequestId |
| `src/types.ts`          | add `LogLevel`; add optional `logLevel` to `ProxyConfig` |
| `src/config.ts`         | add `logLevel` to `ProxyConfigFile`; handle in `mergeConfig` |
| `src/server.ts`         | import logger; add middleware; replace console.* calls |
| `src/cli.ts`            | add `--log-level`; wire `logLevel` into `ProxyConfig` |
| `tests/logger.test.ts`  | **new** — unit tests |
| `tests/server.test.ts`  | add `logLevel: "error"` to test config (suppress noise) |
| `docs/LOGGING.md`       | **new** — comprehensive logging reference + otelcol guide |
| `docs/ARCHITECTURE.md`  | add Logger to architecture diagram |
| `docs/CLI.md`           | add `--log-level` option |
| `AGENTS.md`             | update Essential Commands and Key Design Principles |
| `README.md`             | add Logging section |
