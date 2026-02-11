# cc-proxy logging (OpenTelemetry + JSON)

This document describes the **implemented** logging behavior for `cc-proxy`:

- OpenTelemetry trace correlation (`trace_id`, `span_id`)
- JSON logs with a stable schema
- Request lifecycle + auth decision visibility

## Goals

- **OpenTelemetry-compatible from day 1** (traces + logs; metrics later).
- **One JSON object per log line** for local/dev (easy ingestion into Loki/ELK/Cloud Logging).
- **Per-request traceability** using **`trace_id` / `span_id`** (and optionally `request_id`).
- **Deterministic event names** and **stable field contracts** to keep logs grep-able.

Non-goals (for now):
- Full distributed tracing UI setup (Jaeger/Grafana Tempo/etc.). We’ll emit OTLP; you can plug in any backend.

## Transport: where logs go (recommended)

Recommended default for containers/devcontainers:
- **stdout** JSON logs (best practice; collector handles storage/rotation).
- **OTLP export** (to an OpenTelemetry Collector) for traces (and optionally logs).

Optional (only if you explicitly need local files):
- Rotating file handler (e.g. `/tmp/cc_proxy.jsonl`), time- or size-based.

Avoid:
- Logging to a DB for general request logs (latency + failure coupling).

## Request correlation: prefer `trace_id`, optionally keep `request_id`

With OpenTelemetry, the best cross-system correlation key is the **trace context**:
- `trace_id`
- `span_id`

We also support a human-friendly `request_id` for grep/debug when needed.

### Incoming context

FastAPI/ASGI instrumentation can extract standard trace headers, e.g.:
- `traceparent` (W3C Trace Context)
- `tracestate`
- `baggage`

For `request_id`, prefer:
- `X-Request-ID`
- `X-Correlation-ID`

Else generate a UUID4.

### Propagation rule

Every log line should include:
- `trace_id`
- `span_id`
- and (optionally) `request_id`

so you can trace:
- within a single proxy instance (grep by `request_id`)
- across services/proxies (trace UI by `trace_id`)

## Minimal JSON log schema (stable fields)

Each log entry is a single JSON object with these fields:

- **`ts`**: ISO 8601 timestamp in UTC (e.g. `2026-01-26T23:30:01.123Z`)
- **`level`**: `debug|info|warning|error`
- **`service`**: constant string, e.g. `"cc-proxy"`
- **`event`**: short event name (see taxonomy below)
- **`trace_id`**: hex trace id (OpenTelemetry)
- **`span_id`**: hex span id (OpenTelemetry)
- **`request_id`**: optional (from headers or generated)
- **`method`**: HTTP method
- **`path`**: request path (no query string)
- **`client_ip`**: best-effort client IP (e.g. `request.client.host`)

Common optional fields:

- **`status_code`**: for response/end events
- **`duration_ms`**: request duration (float)
- **`user_agent`**: if helpful (but can be noisy)
- **`error`**: object: `{ "type": "...", "message": "..." }`
- **`meta`**: object for additional event-specific fields (keep flat fields for high-signal keys)

Security rule:
- Never log secrets (`CC_PROXY_AUTH_KEY`, `ANTHROPIC_AUTH_TOKEN`, Authorization header, etc.).

## Event taxonomy (what we log)

### A) HTTP lifecycle (middleware)

In an OpenTelemetry-first setup, you get a **server span** for each request.
We still emit readable events, but they should be implemented as:

- **Span attributes** (stable tags), and/or
- **Span events** (timestamped events attached to the request span), and/or
- **Log records** that include `trace_id`/`span_id`.

Recommended mapping:

- `http.request.start`: log record (and set span attributes)
- `http.request.end`: log record (and set span status, attributes: `http.status_code`, duration)
- `http.request.error`: log record and span status = error

### B) Endpoint-level

- `endpoint.enter` / `endpoint.exit`
  - best as **span events** with attribute `endpoint="POST /v1/messages"`

### C) Auth trace (core requirement)

Auth should be fully traceable with a small number of events:

- `auth.start`
- `auth.check.bearer`
  - include: `present` (bool), `match` (bool)
- `auth.check.x_api_key`
  - include: `present` (bool), `match` (bool)
- `auth.result`
  - include: `authorized` (bool), `reason` (`"ok"|"missing"|"mismatch"|"misconfigured"`)

Notes:
- `present=true` means header existed (not empty after stripping).
- `match=true` means it matched the configured expected key.
- Never log header values; only log presence/match booleans.

OpenTelemetry guidance for auth events:
- Emit `auth.*` as **span events** on the request span so they show up in trace UIs.
- Also emit as JSON log records (same fields) for easy local grepping.

### D) Core pipeline steps (implemented events)

The following events are emitted during request processing:

- `endpoint.enter` / `endpoint.exit`
  - Emitted at route handler boundaries
  - Attributes: `endpoint` (e.g., `"POST /v1/messages"`)
- `model.resolved`
  - Emitted after model alias resolution
  - Attributes: `requested_model`, `resolved_model`
- `thinking.block_handled`
  - Emitted when thinking blocks are dropped for non-capable models
  - Attributes: `model`, `thinking_capable` (bool), `thinking_blocks`, `redacted_blocks`, `dropped_blocks`
- `messages.parse.ok` / `messages.parse.error` (implementation varies by endpoint)
- `backend.request.start` / `backend.request.end` (future - not currently emitted)
- `response.transform.start` / `response.transform.end` (future - not currently emitted)

## Example: auth failure trace (401)

```json
{"ts":"2026-01-26T23:30:01.123Z","level":"info","service":"cc-proxy","event":"http.request.start","trace_id":"4bf92f3577b34da6a3ce929d0e0e4736","span_id":"00f067aa0ba902b7","request_id":"7d2c...","method":"POST","path":"/v1/messages","client_ip":"127.0.0.1"}
{"ts":"2026-01-26T23:30:01.124Z","level":"info","service":"cc-proxy","event":"endpoint.enter","trace_id":"4bf92f3577b34da6a3ce929d0e0e4736","span_id":"00f067aa0ba902b7","request_id":"7d2c...","endpoint":"POST /v1/messages","method":"POST","path":"/v1/messages"}
{"ts":"2026-01-26T23:30:01.124Z","level":"info","service":"cc-proxy","event":"auth.start","trace_id":"4bf92f3577b34da6a3ce929d0e0e4736","span_id":"00f067aa0ba902b7","request_id":"7d2c...","method":"POST","path":"/v1/messages"}
{"ts":"2026-01-26T23:30:01.124Z","level":"info","service":"cc-proxy","event":"auth.check.bearer","trace_id":"4bf92f3577b34da6a3ce929d0e0e4736","span_id":"00f067aa0ba902b7","request_id":"7d2c...","present":true,"match":false}
{"ts":"2026-01-26T23:30:01.124Z","level":"info","service":"cc-proxy","event":"auth.check.x_api_key","trace_id":"4bf92f3577b34da6a3ce929d0e0e4736","span_id":"00f067aa0ba902b7","request_id":"7d2c...","present":false,"match":false}
{"ts":"2026-01-26T23:30:01.125Z","level":"warning","service":"cc-proxy","event":"auth.result","trace_id":"4bf92f3577b34da6a3ce929d0e0e4736","span_id":"00f067aa0ba902b7","request_id":"7d2c...","authorized":false,"reason":"mismatch"}
{"ts":"2026-01-26T23:30:01.129Z","level":"info","service":"cc-proxy","event":"http.request.end","trace_id":"4bf92f3577b34da6a3ce929d0e0e4736","span_id":"00f067aa0ba902b7","request_id":"7d2c...","status_code":401,"duration_ms":6.2}
```

## Example: successful request trace (200)

```json
{"ts":"2026-01-26T23:31:10.001Z","level":"info","service":"cc-proxy","event":"http.request.start","trace_id":"c0de...","span_id":"abcd...","request_id":"a91f...","method":"POST","path":"/v1/messages","client_ip":"127.0.0.1"}
{"ts":"2026-01-26T23:31:10.002Z","level":"info","service":"cc-proxy","event":"endpoint.enter","trace_id":"c0de...","span_id":"abcd...","request_id":"a91f...","endpoint":"POST /v1/messages","method":"POST","path":"/v1/messages"}
{"ts":"2026-01-26T23:31:10.002Z","level":"info","service":"cc-proxy","event":"auth.start","trace_id":"c0de...","span_id":"abcd...","request_id":"a91f...","method":"POST","path":"/v1/messages"}
{"ts":"2026-01-26T23:31:10.002Z","level":"info","service":"cc-proxy","event":"auth.check.bearer","trace_id":"c0de...","span_id":"abcd...","request_id":"a91f...","present":true,"match":true}
{"ts":"2026-01-26T23:31:10.002Z","level":"info","service":"cc-proxy","event":"auth.result","trace_id":"c0de...","span_id":"abcd...","request_id":"a91f...","authorized":true,"reason":"ok"}
{"ts":"2026-01-26T23:31:10.004Z","level":"info","service":"cc-proxy","event":"messages.parse.ok","trace_id":"c0de...","span_id":"abcd...","request_id":"a91f...","method":"POST","path":"/v1/messages"}
{"ts":"2026-01-26T23:31:10.010Z","level":"info","service":"cc-proxy","event":"endpoint.exit","trace_id":"c0de...","span_id":"abcd...","request_id":"a91f...","endpoint":"POST /v1/messages"}
{"ts":"2026-01-26T23:31:10.011Z","level":"info","service":"cc-proxy","event":"http.request.end","trace_id":"c0de...","span_id":"abcd...","request_id":"a91f...","status_code":200,"duration_ms":10.1}
```

## Configuration (runtime)

The proxy loads runtime settings from:

- `~/.cc-proxy/.env` (user-owned)
- Template: `cc_proxy/sample.env`

Key values for OpenTelemetry:

- `OTEL_SERVICE_NAME`
- `OTEL_RESOURCE_ATTRIBUTES`
- `OTEL_EXPORTER_OTLP_ENDPOINT` (dev: `http://localhost:4317`)
- `OTEL_TRACES_EXPORTER` (typically `otlp`)
- `OTEL_LOGS_EXPORTER` (optional)

## Operational notes

- The OpenTelemetry Collector runs **outside** the proxy process (sidecar/agent/service). `cc-proxy` only exports via OTLP.
- For local debugging, filter logs by `request_id` or `trace_id`.
- Avoid logging secrets (auth headers, proxy keys, tokens).

