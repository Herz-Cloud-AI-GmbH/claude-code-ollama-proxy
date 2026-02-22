# Logging Tasks and Tests

## Task List

### T1 — `src/types.ts`: Add `LogLevel` and update `ProxyConfig`

- [ ] Export `LogLevel = "error" | "warn" | "info" | "debug"`
- [ ] Add optional `logLevel?: LogLevel` to `ProxyConfig`

### T2 — `src/logger.ts`: Implement OTEL Logger

- [ ] Define `OtelLogRecord` type matching OTEL LogRecord data model
- [ ] Implement `Logger` class with `error/warn/info/debug` methods
  - [ ] Each method calls internal `emit()` only if level passes threshold
  - [ ] `emit()` writes `JSON.stringify(record) + "\n"` to `process.stdout`
- [ ] Export `createLogger(config)` factory
- [ ] Export `parseLogLevel(value: string): LogLevel` — throws on invalid
- [ ] Export `generateRequestId(): string` — `"req_" + randomBytes(4).hex()`

### T3 — `src/config.ts`: Add `logLevel` to config file

- [ ] Add optional `logLevel?: string` to `ProxyConfigFile`
- [ ] Handle `logLevel` in `mergeConfig` (same pattern as `strictThinking`)

### T4 — `src/server.ts`: Wire logger

- [ ] Import `createLogger`, `generateRequestId` from `./logger.js`
- [ ] Create logger at top of `createServer()` using
      `config.logLevel ?? (config.verbose ? "debug" : "info")`
- [ ] Add request-in/request-out middleware (INFO level):
  - `"Request received"` with `http.method`, `http.target`, `proxy.request_id`
  - `res.on("finish")` → `"Request completed"` with `http.status_code`,
    `proxy.latency_ms`, `proxy.request_id`
- [ ] In `/v1/messages` route:
  - [ ] DEBUG: log full Anthropic request body
  - [ ] WARN (replace console.warn): thinking stripped
  - [ ] DEBUG: log Ollama request body after translation
- [ ] In `handleNonStreaming`: DEBUG log Ollama response body
- [ ] In `handleStreaming`: DEBUG log per-chunk
- [ ] In `handleError`: ERROR log with `error.type`, `error.message`, `http.status_code`
- [ ] Remove all `if (config.verbose)` console.log blocks

### T5 — `src/cli.ts`: Add `--log-level`

- [ ] Import `parseLogLevel` from `./logger.js`
- [ ] Add `.option("--log-level <level>", ..., process.env.LOG_LEVEL ?? "")`
- [ ] In `.action()`: derive effective `logLevel`:
  - if `--log-level` given → `parseLogLevel(options.logLevel)`
  - else if `--verbose` → `"debug"`
  - else → `"info"`
- [ ] Pass `logLevel` into config built for `mergeConfig`
- [ ] Show log level in startup banner (replace "Verbose logging: …")

### T6 — `tests/logger.test.ts`: Logger unit tests (see below)

### T7 — `tests/server.test.ts`: Minor update

- [ ] Add `logLevel: "error"` to the top-level `config` object to suppress
  info-level request logs from polluting test output

---

## Test Plan — `tests/logger.test.ts`

### T6.1 — OTEL Record Structure

```
describe("Logger — OTEL record structure")
  it("emits valid OTEL JSON with correct fields for info()")
     → Timestamp is ISO string
     → SeverityNumber = 9, SeverityText = "INFO"
     → Body = provided string
     → Attributes = provided object
     → Resource["service.name"] and Resource["service.version"] correct

  it("emits valid OTEL JSON for warn()")
     → SeverityNumber = 13, SeverityText = "WARN"

  it("emits valid OTEL JSON for error()")
     → SeverityNumber = 17, SeverityText = "ERROR"

  it("emits valid OTEL JSON for debug()")
     → SeverityNumber = 5, SeverityText = "DEBUG"

  it("emits record with empty Attributes when none provided")
  it("Timestamp is parseable ISO date string")
```

### T6.2 — Level Filtering

```
describe("Logger — level filtering")
  it("INFO logger suppresses debug()")
  it("INFO logger suppresses debug() but emits info()")
  it("WARN logger suppresses info()")
  it("WARN logger suppresses debug()")
  it("WARN logger emits warn()")
  it("WARN logger emits error()")
  it("ERROR logger suppresses warn()")
  it("ERROR logger suppresses info()")
  it("ERROR logger emits error()")
  it("DEBUG logger emits all four levels")
```

### T6.3 — parseLogLevel

```
describe("parseLogLevel")
  it("accepts 'error'")
  it("accepts 'warn'")
  it("accepts 'info'")
  it("accepts 'debug'")
  it("is case-insensitive — 'INFO' → 'info'")
  it("throws on empty string")
  it("throws on unknown value 'trace'")
  it("throws on unknown value 'verbose'")
```

### T6.4 — generateRequestId

```
describe("generateRequestId")
  it("returns string starting with 'req_'")
  it("returns unique values on consecutive calls")
  it("id portion is 8 hex characters")
```

---

## Review Checklist (pre-implementation)

- [x] OTEL severity numbers match spec (DEBUG=5, INFO=9, WARN=13, ERROR=17)
- [x] No new production dependencies required (pure Node.js implementation)
- [x] backward compat: `verbose: true` maps to debug, `verbose: false` maps to info
- [x] `logLevel` is optional in `ProxyConfig` → existing test code unchanged except
      the explicit `logLevel: "error"` added to silence test logs
- [x] All existing 130 tests must continue to pass
- [x] `handleError` accepts optional logger to avoid breaking module-level call sites
- [x] Streaming: per-chunk logging is guard-checked (no-op at INFO level)
