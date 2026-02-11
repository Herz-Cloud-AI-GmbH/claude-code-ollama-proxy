# cc_proxy — AI Agent Onboarding Guide

This document provides everything you need to work effectively in the `cc_proxy` codebase.

---

## 1. Goals and Purpose

`cc_proxy` is a **FastAPI gateway** that makes Claude Code work reliably with local Ollama models. It acts as an Anthropic-compatible façade, translating requests and responses while adding observability and authentication.

### Key Goals
- **Anthropic API compatibility**: Expose `GET /health` and `POST /v1/messages` endpoints that Claude Code can use as `ANTHROPIC_BASE_URL`
- **Ollama integration**: Forward requests to Ollama's Anthropic-compatible `/v1/messages` endpoint
- **Authentication**: Enforce API key validation (accepts `Authorization: Bearer` or `x-api-key`)
- **Observability**: Structured JSON logging with OpenTelemetry trace correlation
- **Content block preservation**: Pass through text, thinking, tool_use, and tool_result blocks
- **Thinking policy**: Drop thinking blocks for non-thinking-capable models with warnings
- **Tool calling support**: Pass through tool definitions, inject tool-use system instructions on "use_tools", repair malformed tool_use blocks, and enforce tool capability checks
- **Streaming support**: Server-Sent Events (SSE) streaming with tool repair applied in real-time

### Current Limitations
- Token counting endpoint (`/v1/messages/count_tokens` - future work)

---

## 2. Repository Structure

```
repo/
├── AGENTS.md              # This file — AI agent onboarding
├── cc-proxy.yaml          # Routing config: aliases, thinking-capable models, promises
├── sample.env             # Template for user environment variables
├── app/
│   ├── main.py            # FastAPI app, routes, lifespan, endpoint handlers
│   ├── auth.py            # Authentication dependency (Bearer + x-api-key)
│   ├── settings.py        # Centralized configuration (Settings class)
│   ├── models_anthropic.py # Pydantic models for Anthropic API shapes
│   ├── models_ollama.py   # Pydantic models for Ollama API shapes
│   ├── adapt_request.py   # Request adaptation (field filtering, thinking policy)
│   ├── adapt_response.py  # Response adaptation (Anthropic compat + tool repair)
│   ├── routing.py         # Model alias resolution, routing config loading
│   ├── transport.py       # HTTP client for Ollama upstream (with connection pooling)
│   ├── capability.py      # Tool capability detection + cache
│   ├── tool_repair.py     # Tool use repair helpers
│   ├── observability.py   # JSON logging, OTel setup, LogEvent constants, emit_span_event helper
│   ├── middleware_request_logging.py  # Request lifecycle logging
│   ├── request_context.py # request_id contextvar management
│   └── apps_env.py        # Environment loading utilities
├── tests/
│   ├── conftest.py        # pytest fixtures, shared test utilities (load_jsonl_fixture, has_tool_use, etc.)
│   ├── utils.py           # Test utilities (subprocess helpers, env manipulation, assert_ollama_reachable)
│   ├── json_log_utils.py  # JSON log parsing utilities for tests
│   └── test_*.py          # Individual test files (see Testing Patterns)
└── docs/
    ├── cc-proxy-architecture.md      # Architecture overview
    ├── cc-proxy-translation.md       # Request/response translation rules
    ├── cc-proxy-thinking.md          # Thinking block handling
    ├── cc-proxy-streaming.md         # Streaming support implementation
    ├── cc-proxy-authentication.md    # Auth contract details
    ├── cc-proxy-logging.md           # Logging and observability
    ├── cc-proxy-token-count-logic.md # Token counting (future)
    └── cc-implementation-plan.md     # Detailed phase-by-phase plan
```

---

## 3. Code Flow

### Request Lifecycle

```
Claude Code → POST /v1/messages
    ↓
Middleware (assign request_id, log start)
    ↓
Auth Dependency (Bearer or x-api-key validation)
    ↓
Endpoint Handler (main.py::messages)
    ↓
Model Resolution (routing.py::resolve_model)
    ↓
Request Adaptation (adapt_request.py::prepare_anthropic_payload)
    - Drop unsupported fields
    - Apply thinking policy (drop blocks if model not capable)
    ↓
Capability Check (capability.py::get_tool_capability)
    - 400 if model cannot use tools and tools were provided
    ↓
Upstream Call (transport.py::OllamaClient.chat_anthropic_compat)
    → POST {OLLAMA_BASE_URL}/v1/messages
    ↓
Response Adaptation (adapt_response.py::from_anthropic_compat)
    - Repair malformed tool_use blocks (ids, input JSON, invalid names)
    ↓
Return Anthropic-shaped response to Claude Code
    ↓
Middleware (log end, add X-Request-ID header)
```

### Key Data Flows

1. **Authentication**: `auth.py::auth_dependency` → `require_auth()` checks both Bearer and x-api-key headers
2. **Model Resolution**: Request model alias (e.g., "sonnet") → resolved to actual Ollama model (e.g., "qwen3:14b")
3. **Thinking Policy**: If model not in `thinking_capable_models` list, thinking/redacted_thinking blocks are dropped
4. **Tool Capability**: `get_tool_capability()` checks whitelist + `/api/show` capabilities
5. **Tool Repair**: `repair_tool_use_blocks()` fixes ids, parses inputs, and drops invalid tool names
6. **Timeout Handling**: Supports `OLLAMA_TIMEOUT_SECONDS` with unit suffixes (ms, s, m, h)

---

## 4. Module Reference

### Core Modules

| Module | Purpose | Key Classes/Functions |
|--------|---------|----------------------|
| `main.py` | FastAPI app, lifespan, routes | `app`, `lifespan()`, `health()`, `messages()` |
| `auth.py` | Authentication | `auth_dependency()`, `require_auth()` |
| `settings.py` | Centralized configuration | `Settings`, `get_settings()`, `parse_timeout_seconds()` |
| `routing.py` | Model routing config | `RoutingConfig`, `load_routing_config()`, `resolve_model()` |
| `adapt_request.py` | Request transformation | `prepare_anthropic_payload()`, `to_anthropic_compat()`, `apply_thinking_policy()` |
| `adapt_response.py` | Response transformation | `from_anthropic_compat()` |
| `transport.py` | Ollama HTTP client (pooled) | `OllamaClient`, `chat_anthropic_compat()`, `show_model()`, `close()` |
| `models_anthropic.py` | Anthropic API models | `MessagesRequest`, `MessagesResponse`, content block types |
| `models_ollama.py` | Ollama API models | `OpenAIChatCompletionsRequest`, etc. |

### Supporting Modules

| Module | Purpose |
|--------|---------|
| `capability.py` | Tool capability detection + in-memory cache |
| `tool_repair.py` | Tool use repair helpers |
| `observability.py` | JSON logging, OTel trace setup, `LogEvent` constants, `emit_span_event()` helper |
| `middleware_request_logging.py` | Request/response lifecycle logging |
| `request_context.py` | `request_id` contextvar for correlation |
| `apps_env.py` | Load environment from `.env` |

---

## 5. Architecture

### Deployment Model
- **Claude Code** runs inside the devcontainer
- **cc_proxy** runs inside the devcontainer (port 3456 default)
- **Ollama** runs on the host (accessed via `host.docker.internal:11434`)

### Configuration Sources (in order of precedence)
1. Environment variables
2. `~/.config/cc-proxy/cc-proxy.user.yaml` (user config, configurable via `cc-proxy.yaml`)
3. `cc-proxy.yaml` (base config)

### Key Configuration Files

**`cc-proxy.yaml`**:
```yaml
schema_version: 1
default_alias: sonnet
thinking_capable_models:
  - qwen3:14b
  - qwen3:8b
  - qwen3:4b
tool_calling_capable_models:
  - qwen3:8b
verbose_tool_logging: false
aliases:
  sonnet:
    promise:
      tool_calling: planned
  haiku:
    promise:
      tool_calling: planned
  opus:
    promise:
      tool_calling: planned
```

**Note**: Model mappings for aliases are defined in user config (default `~/.config/cc-proxy/cc-proxy.user.yaml`, configurable via `user_config_path` in `cc-proxy.yaml`), not in the base config. The base config only defines the promise/capability declarations.

**Environment Variables**:
- `CC_PROXY_AUTH_KEY` — Required auth key
- `OLLAMA_BASE_URL` — Default: `http://host.docker.internal:11434`
- `OLLAMA_TIMEOUT_SECONDS` — Request timeout (supports units: ms, s, m, h)
- `OTEL_EXPORTER_OTLP_ENDPOINT` — OTel Collector endpoint (optional)

---

## 6. Testing Patterns

### Test Organization

| Test File Pattern | Purpose |
|-------------------|---------|
| `test_api_*.py` | API endpoint tests (auth, messages, events, thinking warnings) |
| `test_repo_*.py` | Repository/workflow integration tests (setup, lifecycle, config) |
| `test_adapt_*.py` | Request/response adapter unit tests |
| `test_transport_*.py` | HTTP transport tests (OpenAI-compat, Anthropic-compat) |
| `test_models_*.py` | Pydantic model validation tests |
| `test_routing_*.py` | Routing and alias resolution tests |
| `test_thinking_*.py` | Thinking block policy tests |
| `test_tool_*.py` | Tool calling support tests (passthrough, sequence patterns, use_tools marker) |
| `test_streaming.py` | Streaming response tests (SSE format, tool repair in streaming) |
| `test_claude_*.py` | Claude Code CLI integration tests |
| `test_logging_*.py` | Logging and observability tests |

### Common Testing Patterns

**1. FastAPI TestClient with monkeypatching**:
```python
from fastapi.testclient import TestClient
from app.main import app
from app.transport import OllamaClient

def test_example(monkeypatch) -> None:
    monkeypatch.setenv("CC_PROXY_AUTH_KEY", "test-key")

    # Mock upstream
    async def fake_chat(self, request):
        return {"id": "msg", "content": [{"type": "text", "text": "ok"}], ...}
    monkeypatch.setattr(OllamaClient, "chat_anthropic_compat", fake_chat)

    client = TestClient(app)
    response = client.post("/v1/messages", json={...}, headers={...})
    assert response.status_code == 200
```

**2. JSON Log Assertion** (using caplog):
```python
def test_logs_auth_event(caplog):
    with caplog.at_level("INFO", logger="cc-proxy"):
        # ... make request ...
        assert any("auth.result" in r.message for r in caplog.records)
```

**3. Subprocess Integration Tests** (in `test_repo_*.py`):
```python
from tests.utils import run_manage, wait_for_health_ok

def test_proxy_lifecycle():
    result = run_manage(["proxy-start"], timeout_s=10)
    assert result.returncode == 0
    wait_for_health_ok(port=3456, timeout_s=6)
    # ... test ...
    run_manage(["proxy-stop"], timeout_s=8)
```

### Test Safety
- `conftest.py` has an autouse fixture `_ensure_cc_proxy_not_left_running` that stops the proxy after each test
- Always use timeouts for subprocess tests
- Use `monkeypatch` to set `CC_PROXY_AUTH_KEY` to avoid 500 errors

### Running Tests

```bash
# All tests
pytest tests/

# Specific test file
pytest tests/test_api_auth.py

# With verbose output
pytest -v tests/test_api_auth.py

# Repo workflow tests (slower, starts real processes)
pytest tests/test_repo_*.py
```

---

## 7. Logging and Observability

### Log Output Location
Logs are written to **stdout** as JSON lines (structured logging). In devcontainer setup, these appear in the terminal where the proxy runs.

### Log Format
Each line is a JSON object with stable fields:
```json
{
  "ts": "2026-01-26T23:30:01.123Z",
  "level": "info",
  "service": "cc-proxy",
  "event": "auth.result",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "span_id": "00f067aa0ba902b7",
  "request_id": "uuid",
  "method": "POST",
  "path": "/v1/messages"
}
```

### Key Event Names

| Event | Description |
|-------|-------------|
| `http.request.start` | Request received |
| `http.request.end` | Request completed (includes duration_ms, status_code) |
| `http.request.error` | Exception during request handling |
| `endpoint.enter` / `endpoint.exit` | Route handler boundaries |
| `auth.start` / `auth.result` | Authentication flow |
| `auth.check.bearer` / `auth.check.x_api_key` | Specific auth scheme checks |
| `model.resolved` | Model alias resolution |
| `thinking.block_handled` | Thinking policy applied (blocks dropped/kept) |

### Debug Logging
Enable via `~/.config/cc-proxy/cc-proxy.user.yaml`:
```yaml
debug_logging:
  request_headers: true
  request_body: true
  response_headers: true
  response_body: true
```

**Warning**: Body logging truncates at 10,000 chars and redacts sensitive headers.

### OpenTelemetry
- Trace context is automatically extracted/injected via standard headers (`traceparent`)
- OTLP export to collector if `OTEL_EXPORTER_OTLP_ENDPOINT` is set
- Spans include events for auth, endpoint enter/exit

### Viewing Logs
```bash
# If proxy is running via make
make proxy-start
# Logs appear in terminal

# Tail logs with jq filtering
make proxy-start 2>&1 | jq 'select(.event == "auth.result")'

# Check specific request by ID
curl -H "X-Request-ID: my-test" http://localhost:3456/health
# Then grep logs for my-test
```

---

## 8. Development Patterns

### Code Style
- **Python 3.11+** with `from __future__ import annotations`
- **Type hints** required on all public functions
- **Pydantic v2** for all API models (use `ConfigDict(extra="allow")` for forward compatibility)
- **Dataclasses** for internal structures

### Error Handling
- Use `fastapi.HTTPException` for HTTP errors
- Transport errors map to 502 (Bad Gateway) with sanitized details
- Never expose internal error details to client in production

### Environment Access
- Use the `Settings` class from `settings.py` for configuration access
- Settings properties read env vars at access time (not import time), enabling monkeypatching in tests
- Use `get_settings()` to get the singleton Settings instance
- For timeout parsing with unit suffixes, use `parse_timeout_seconds()` from `settings.py`

### Adding New Endpoints
```python
from .observability import emit_span_event, LogEvent

@app.post("/v1/new-endpoint")
async def new_endpoint(
    request: SomeRequest,
    _auth: Annotated[None, Depends(auth_dependency)],
) -> SomeResponse:
    logger = logging.getLogger("cc-proxy")
    endpoint = "POST /v1/new-endpoint"
    logger.info("", extra={"event": LogEvent.ENDPOINT_ENTER, "endpoint": endpoint})
    emit_span_event(LogEvent.ENDPOINT_ENTER, endpoint=endpoint)
    try:
        # ... implementation ...
        return response
    finally:
        logger.info("", extra={"event": LogEvent.ENDPOINT_EXIT, "endpoint": endpoint})
        emit_span_event(LogEvent.ENDPOINT_EXIT, endpoint=endpoint)
```

### Adding Tests
1. Choose the right test file based on pattern (see Testing Patterns)
2. Use `monkeypatch.setenv("CC_PROXY_AUTH_KEY", "test")` at test start
3. Mock `OllamaClient` methods for unit tests
4. Add span/log assertions where relevant
5. Use fixtures from `conftest.py` for lifecycle management

### Model Changes
When adding fields to Anthropic models:
1. Update `models_anthropic.py` with new field
2. Use `extra="allow"` on model config for forward compatibility
3. Update adaptation logic if field needs special handling
4. Add test in appropriate `test_models_*.py` or `test_adapt_*.py`

### Configuration Changes
- Base defaults: `cc-proxy.yaml`
- User overrides: path from `user_config_path` in `cc-proxy.yaml` (default `~/.config/cc-proxy/cc-proxy.user.yaml`)
- Never commit user configs

---

## 9. Quick Reference

### Start Development
```bash
# 1. Setup environment
cp sample.env .env
# Edit .env to set CC_PROXY_AUTH_KEY

# 2. Install dependencies
pip install -r requirements.txt  # if exists, or use pyproject.toml

# 3. Run tests
pytest tests/ -v

# 4. Start proxy manually for manual testing
python -m uvicorn app.main:app --port 3456 --reload
```

### Common Commands
```bash
# Via Makefile
make proxy-start      # Start cc-proxy
make proxy-stop       # Stop cc-proxy
make status           # Check profile and service status

# Direct pytest
pytest tests/test_api_auth.py -v
pytest tests/test_adapt_request.py -v

# Streaming tests
pytest -m streaming tests/ -v

# With coverage
pytest tests/ --cov=app --cov-report=html
```

### Debugging Tips
1. **Enable debug logging** in `~/.config/cc-proxy/cc-proxy.user.yaml`
2. **Check logs for trace_id** to correlate across services
3. **Use X-Request-ID header** to grep for specific requests
4. **Test auth separately**: `curl -H "Authorization: Bearer $KEY" http://localhost:3456/health`
5. **Test streaming**: `curl -N -X POST http://localhost:3456/v1/messages -H "Authorization: Bearer $KEY" -d '{"model":"sonnet","messages":[{"role":"user","content":"Count to 10"}],"max_tokens":100,"stream":true}'`

---

## 10. Further Reading

- **Architecture**: `docs/cc-proxy-architecture.md`
- **Translation rules**: `docs/cc-proxy-translation.md`
- **Thinking handling**: `docs/cc-proxy-thinking.md`
- **Authentication**: `docs/cc-proxy-authentication.md`
- **Logging**: `docs/cc-proxy-logging.md`
- **Streaming support**: `docs/cc-proxy-streaming.md`
- **Implementation plan**: `docs/cc-implementation-plan.md`
