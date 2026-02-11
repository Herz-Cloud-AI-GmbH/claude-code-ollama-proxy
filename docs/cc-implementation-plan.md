# CC Proxy Implementation Plan

This document contains the detailed implementation strategy and module-by-module tasks.

## Implementation Status (Current State)

**Completed Phases:**
- ✅ **Phase 0**: Client/repo integration (Makefile, scripts/manage.py, .env handling)
- ✅ **Phase 1**: Claude settings + authentication handshake (Bearer + x-api-key support)
- ✅ **Phase 2**: Minimal `/v1/messages` pass-through (Anthropic-compatible upstream to Ollama)
- ✅ **Phase 3a**: Content block passthrough (preserves text, thinking, tool blocks)
- ✅ **Phase 3b**: Thinking/redacted_thinking handling (policy-based dropping with warnings)
- ✅ **Phase 3c**: Tool calling support (passthrough, "use_tools" marker, tool_use repair, tool name validation)
- ✅ **Phase 4**: Capability detection + caching (hybrid whitelist + Ollama metadata with in-memory cache)
- ✅ **Phase 6**: Streaming support (SSE format, tool repair in streaming context)

**Not Yet Implemented:**
- ❌ **Phase 7**: OpenAI-compat backend support (deferred)
- ❌ **Phase 7**: OpenAI-compat backend support (deferred; current focus is Anthropic-compat only)

**Partially Implemented:**
- ⚠️ **Phase 5**: Some repo UX improvements done (status, config loading)

---

## Publish readiness checklist (before release)

**Required to publish:**
- Implement or stub `POST /v1/messages/count_tokens` to avoid Claude Code 404s.
- Expand streaming tool‑repair beyond `content_block_start` (or clearly document limitations).
- Align docs with actual behavior (streaming/tool‑repair feature flags, experimental status).
- Complete Phase 5 UX hardening (status output, capability reporting, diagnostics).
- Provide a model capability profile list and/or measured repair success notes.
- Ensure test suite is green for streaming/tool‑repair/capability, with integration tests clearly marked and documented.
- Verify security hygiene (no secrets in docs/logs; runtime artifacts ignored).
- Confirm README/marketing does not imply OpenAI‑compat backend unless Phase 7 is implemented.

---

## Original Implementation Strategy

This document contains the detailed implementation strategy and module-by-module tasks previously embedded in `docs/cc-proxy-architecture.md`.

## Implementation strategy (recommended breakdown + order)

This section is the **practical build plan** for Option 3 in Python/FastAPI: what modules to build, in what order, and what tests gate each step.

### Guiding rules

- **Ship a working façade early**: get `POST /v1/messages` working end-to-end before adding “smart” features.
- **Keep every transformation pure + testable**: repair/adaptation logic should be small functions with deterministic tests.
- **Prefer “repair + warn” over “drop silently”**: when we change the request/response semantics, emit logs and/or response headers.

### Phase 0 — client/repo integration first (Makefile + `.env` + `scripts/manage.py`) (½–1 day)

**Goal:** the *client-side workflow* is correct and testable **before** we build any proxy functionality.

At the end of this phase:
- `make help` shows the correct targets
- `make setup-ollama-proxy` exists and does the right thing for env/profile selection
- the devcontainer `.env` contract is clear and consistent
- the FastAPI app can be a near-empty stub (health only), but it must be startable/stoppable via the repo workflow
- **tests for this phase are in their own file and green**

Implement (repo-only wiring; proxy can remain empty):
1. **`.devcontainer/sample.env` contract**
   - Ensure the only Ollama path described is `PROFILE=ollama-proxy`.
   - Required vars for this phase:
     - `PROFILE=ollama-proxy`
     - `CC_PROXY_PORT=3456` (or document default)
     - `CC_PROXY_AUTH_KEY=<placeholder>` (document that it must be replaced/generated)
2. **`Makefile` UX**
   - Provide stable targets for the proxy workflow:
     - `setup-ollama-proxy` (delegates to `scripts/manage.py setup ollama-proxy`)
     - `proxy-start` / `proxy-stop`
     - `status`
3. **`scripts/manage.py` scaffolding**
   - Loads `.devcontainer/.env`
   - Implements `setup ollama-proxy` *as a workflow* (even if the proxy is empty):
     - sets `PROFILE=ollama-proxy`
     - ensures `CC_PROXY_AUTH_KEY` exists (generate if placeholder/missing)
     - can start/stop the proxy process (PID/log files) even if proxy only serves `/health`
4. **Empty proxy stub**
   - A minimal FastAPI app with `GET /health` so `manage.py` can do a readiness check.

Tests (own file; must be green before Phase 1):
- `cc_proxy/tests/test_phase0_repo_integration.py` (or similar)
  - Verifies that:
    - `scripts/manage.py setup ollama-proxy` writes/updates `.devcontainer/.env` as expected
    - `scripts/manage.py proxy-start` results in `/health` reachable on `CC_PROXY_PORT`
    - `scripts/manage.py proxy-stop` stops the process cleanly
  - **Hard requirement:** all process-invoking tests use timeouts and kill-on-timeout to avoid “hung CI”.

### Phase 1 — Claude settings + authentication handshake (still stub proxy) (½–1 day)

**Goal:** Claude Code uses the gateway settings (no login prompt), and the proxy enforces auth correctly.

At the end of this phase:
- `~/.claude/settings.json` is written correctly by `scripts/manage.py`
- running `claude` no longer shows “Select login method”
- the proxy **auth gate** is correct for Claude Code **even if Claude uses either header scheme**
- the proxy can accept an authenticated `POST /v1/messages` and return a minimal valid Anthropic-shaped response (a stub) — no Ollama calls yet
- **tests for this phase are in their own file and green**

Implement:
1. **Write Claude gateway settings**
   - `scripts/manage.py setup ollama-proxy` writes `~/.claude/settings.json` with:
     - `ANTHROPIC_BASE_URL=http://localhost:<CC_PROXY_PORT>`
     - exactly one of `ANTHROPIC_AUTH_TOKEN` or `ANTHROPIC_API_KEY` (avoid conflicts)
2. **Proxy auth compatibility**
   - Even if we write only one env var, Claude Code may send auth as either:
     - `Authorization: Bearer <key>` **or**
     - `x-api-key: <key>`
   - Therefore the proxy must accept **either header** if the key matches.
3. **Stub `/v1/messages`**
   - Implement a minimal `POST /v1/messages` handler that:
     - requires auth
     - returns a minimal Anthropic Messages response shape (e.g., a single `text` block)
   - This is purely to prove Claude Code can talk to the gateway without interactive login.

Tests (own file; must be green before Phase 2):
- `cc_proxy/tests/test_phase1_claude_auth_handshake.py`
  - Proxy-level:
    - missing/wrong auth → 401
    - bearer auth ok
    - x-api-key auth ok
    - authenticated `POST /v1/messages` returns an Anthropic-shaped JSON stub
  - Claude CLI smoke (gating):
    - `timeout 8s claude --settings ~/.claude/settings.json --setting-sources user -p "ping" --output-format json`
    - Fail if output includes:
      - “Select login method”
    - Always run under a hard timeout; treat `exit=124` (timeout) as failure.

### Phase 2 — minimal `/v1/messages` pass-through (MVP, 1–2 days)

**Goal:** proxy calls Ollama and returns a normal text completion (no tools yet). This phase establishes the end‑to‑end request/response plumbing and prepares the capability surface area without enforcing tool calling.

**Note:** Current implementation uses Ollama's Anthropic-compatible `/v1/messages` endpoint. OpenAI-compat (`/v1/chat/completions`) support is deferred to Phase 7.

#### Detailed steps (code + behavior)

1. **Anthropic request/response models (minimal, permissive)**
   - `cc_proxy/app/models_anthropic.py`:
     - Keep `MessagesRequest` permissive (`extra="allow"`), but explicitly require `model` + `messages`.
     - Ensure `MessagesResponse` has `content: [{type:"text", text:"..."}]` for basic completions.

2. **Backend models for Ollama (OpenAI‑compat path first)**
   - `cc_proxy/app/models_ollama.py`:
     - Add minimal request/response shapes for `POST /v1/chat/completions` (OpenAI‑compat).
     - Keep fields minimal: `model`, `messages`, `temperature`, `max_tokens`, `stream=False`.

3. **Backend transport**
   - `cc_proxy/app/transport.py`:
     - `OllamaClient` with `chat_openai_compat(request)` using `httpx.AsyncClient`.
     - Map connection/timeouts to `502` with sanitized error payloads.
     - Base URL defaults to `http://host.docker.internal:11434` (devcontainer reality).

4. **Routing + alias mapping**
   - `cc_proxy/app/routing.py`:
     - Map Claude Code model aliases to local models:
       - `sonnet` → `qwen3:14b`
       - `haiku` → `qwen3:8b`
       - `opus` → `qwen2.5-coder:14b` (or keep as configurable default)
     - Keep policies minimal for Phase 2 (no tool schema simplification yet).

5. **RequestAdapter (minimal)**
   - `cc_proxy/app/adapt_request.py`:
     - Convert Anthropic Messages API → OpenAI‑compat `chat/completions`.
     - Drop unsupported Anthropic fields (`thinking`, `reasoning_effort`, prompt caching/metadata).
     - Preserve `messages` order and roles; do not emit tools in Phase 2.

6. **ResponseAdapter (minimal)**
   - `cc_proxy/app/adapt_response.py`:
     - Convert OpenAI‑style response to Anthropic Messages response:
       - Read `choices[0].message.content` → `ContentBlockText`.
       - Map `usage` if present (otherwise default zeros).

7. **Route handler (real backend call)**
   - `cc_proxy/app/main.py`:
     - Replace stub in `POST /v1/messages` with:
       - resolve model alias → route
       - adapt request → OpenAI‑compat payload
       - call transport → response
       - adapt response → `MessagesResponse`
     - Keep existing auth + logging + tracing events.

#### Code flow (Phase 2)

1. `POST /v1/messages` (Anthropic‑shape)
2. **Auth** (`Authorization: Bearer` or `x-api-key`)
3. **Model resolve** (`sonnet` → `qwen3:14b`)
4. **Adapt request** → OpenAI‑compat `chat/completions`
5. **Transport** → `http://host.docker.internal:11434/v1/chat/completions`
6. **Adapt response** → Anthropic `MessagesResponse` (text only)
7. **Return** to Claude Code

#### API requirements (Phase 2)

- **Input**: `POST /v1/messages` with `model` + `messages` (tools ignored for this phase).
- **Output**: Anthropic‑compatible response with:
  - `id`, `type: "message"`, `role: "assistant"`, `model`,
  - `content: [{type:"text", text:"..."}]`,
  - `stop_reason`, `usage` (default zeros if unknown).

#### Payload examples (Phase 2)

**1) Incoming Anthropic Messages request (from Claude Code → proxy)**

```json
{
  "model": "sonnet",
  "messages": [
    {"role": "user", "content": "Write a short summary of this file."}
  ],
  "max_tokens": 256,
  "reasoning_effort": "medium",
  "thinking": {"type": "enabled", "budget_tokens": 512}
}
```

**2) Adapted OpenAI‑compat request (proxy → Ollama)**

```json
{
  "model": "qwen3:14b",
  "messages": [
    {"role": "user", "content": "Write a short summary of this file."}
  ],
  "max_tokens": 256,
  "temperature": 0.2,
  "stream": false
}
```

**3) OpenAI‑compat response (Ollama → proxy)**

```json
{
  "id": "chatcmpl-123",
  "model": "qwen3:14b",
  "choices": [
    {
      "index": 0,
      "message": {"role": "assistant", "content": "Here is a concise summary..."},
      "finish_reason": "stop"
    }
  ],
  "usage": {"prompt_tokens": 28, "completion_tokens": 42}
}
```

**4) Anthropic Messages response (proxy → Claude Code)**

```json
{
  "id": "msg_abc123",
  "type": "message",
  "role": "assistant",
  "model": "sonnet",
  "content": [{"type": "text", "text": "Here is a concise summary..."}],
  "stop_reason": "end_turn",
  "usage": {"input_tokens": 28, "output_tokens": 42}
}
```

#### Proxy modules touched (Phase 2)

- `cc_proxy/app/models_anthropic.py`
- `cc_proxy/app/models_ollama.py`
- `cc_proxy/app/routing.py`
- `cc_proxy/app/adapt_request.py`
- `cc_proxy/app/adapt_response.py`
- `cc_proxy/app/transport.py`
- `cc_proxy/app/main.py`

#### Request and response propagation (Phase 2)

- **Request**: Anthropic Messages → adapter → OpenAI‑compat `chat/completions`.
- **Response**: OpenAI‑compat → adapter → Anthropic Messages with `content` text only.
- **Headers**: Auth headers are consumed by the proxy; upstream Ollama receives only its own API payload.

#### Capability promise (Phase 2 baseline)

We will anchor capability handling to the **models currently installed locally** and treat them as the initial baseline set:

- `qwen2.5-coder:7b`
- `qwen3:8b`
- `qwen3:14b`
- `qwen2.5-coder:14b`
- `gemma3:12b`

Phase 2 does **not** enforce tool‑calling capabilities yet, but the routing map should explicitly choose from this list and document the chosen defaults. This ensures the proxy’s later capability detection (Phase 4) aligns with real local inventory from day one.

#### Tests (must pass before continuing)

- **Unit**: request mapping removes specified fields and maps model aliases.
- **Unit**: response mapping returns a valid `MessagesResponse` with `content[]`.
- **Contract**: `POST /v1/messages` returns valid JSON with `content[]`.
- **Integration (recommended)**: proxy → Ollama returns non‑empty text for `qwen3:14b`.

### Phase 3 — structured content handling (3a/3b/3c) (2–4 days)

**Goal:** make structured content reliable and explicit, in ordered steps:
1) text block mapping (3a), 2) thinking blocks (3b), 3) tool calling (3c).

All transformations must be explicitly documented in `docs/cc-proxy-translation.md`.

#### Phase 3a — Text block mapping (deterministic, loss‑minimizing)

**Purpose:** prevent invalid OpenAI‑compat payloads and preserve text as faithfully as possible.

**Chunks (test‑gated, one file per task):**

3a.1 **Canonical text flattening**
- **Code**: `cc_proxy/app/adapt_request.py`
- **What**: normalize Anthropic `content` blocks into a single OpenAI‑compat string.
- **Why**: OpenAI‑compat expects `messages[].content` to be a string; content blocks otherwise trigger validation errors.
- **Robustness**:
  - keep only `type == "text"`
  - trim whitespace per block; drop empty blocks
  - join with `\\n\\n` for paragraph preservation
  - empty result → `""`
- **Tests**: `cc_proxy/tests/test_adapt_request_phase3a.py`:
  - list of text blocks → joined string
  - mixed text + non‑text blocks → text only
  - whitespace‑only blocks → dropped

3a.2 **Translation rules pinned in docs**
- **Docs**: `docs/cc-proxy-translation.md`
- **Why**: makes the transformation explicit and consistent across phases.
- **Tests**: N/A (doc update only).

3a.3 **Optional observability hooks**
- **Code**: `cc_proxy/app/observability.py` or middleware
- **What**: log event when content blocks are flattened (no content values).
- **Why**: debug invalid payloads without leaking data.
- **Tests**: `caplog` asserts event presence.

#### Phase 3b — Thinking / redacted_thinking handling

**Purpose:** decide how reasoning blocks are treated and make the loss of information explicit.

3b.1 **Policy definition**
- **Code**: `cc_proxy/app/adapt_request.py`
- **What**: detect `thinking` / `redacted_thinking` blocks.
- **Why**: OpenAI‑compat does not accept these block types.
- **Robustness**: drop or map to a placeholder string (policy must be explicit).
- **Tests**: `cc_proxy/tests/test_adapt_request_phase3b.py` with thinking blocks.

3b.2 **Warning surface**
- **Code**: middleware or response hook
- **What**: add a warning header or log event when thinking blocks are dropped.
- **Why**: make information loss visible.
- **Tests**: assert warning header or log event.

#### Phase 3c — Tool use + tool result normalization

**Purpose:** normalize tool calling so Claude Code can execute tools reliably.

3c.1 **OpenAI tool_calls → Anthropic tool_use**
- **Code**: `cc_proxy/app/adapt_response.py`
- **What**: convert OpenAI `tool_calls` to Anthropic `tool_use` blocks.
- **Why**: Claude Code expects Anthropic tool_use format.
- **Robustness**: validate `name`, `id`, `input` type.
- **Tests**: `cc_proxy/tests/test_adapt_response_phase3c.py` fixtures.

3c.2 **Repair malformed tool_use**
- **Code**: `cc_proxy/app/adapt_response.py`
- **What**: add missing `id`, parse stringified JSON `input`.
- **Why**: local models frequently emit tool calls with structural defects.
- **Robustness**: strict JSON parsing; drop unrepairable blocks.
- **Tests**: stringified input, missing id, invalid JSON.

3c.3 **Tool name validation**
- **Code**: `cc_proxy/app/adapt_response.py`
- **What**: verify tool name exists in the request tool list.
- **Why**: prevent hallucinated tools from being executed.
- **Robustness**: drop invalid tool_use blocks; optional policy for tool‑less retry.
- **Tests**: unknown tool name → dropped.

3c.4 **Tool result propagation**
- **Code**: `cc_proxy/app/adapt_request.py`
- **What**: map Anthropic `tool_result` blocks back into OpenAI‑compat messages.
- **Why**: preserve the tool execution loop.
- **Robustness**: ensure tool_result content is serializable text or JSON string.
- **Tests**: valid tool_result vs invalid payloads.

#### Phase 3 tests (must pass before Phase 4)

- Unit: text flattening, thinking policy, and tool repair steps.
- Contract: output responses are Anthropic‑shaped and tool_use blocks are valid.
- Regression: Phase 2 text‑only paths still pass.

### Phase 4 — capability detection + caching (2–4 days)

**Goal:** Detect tool calling capability using Ollama's metadata + config whitelist fallback.

**Updated Strategy (2026-02-05):** Use hybrid approach for safety at beginning:
1. **Config whitelist** (explicit): `tool_calling_capable_models` in `cc-proxy.yaml`
2. **Ollama metadata** (automatic): Query `/api/show` endpoint for `capabilities` array
3. **Priority**: Whitelist wins > Ollama metadata > default to "none"

**FUTURE NOTE:** The config whitelist may be removed in a later phase once Ollama metadata detection is proven reliable in production. For now, we keep both approaches for explicit control.

Implement:
- Add to `cc-proxy.yaml`:
  ```yaml
  tool_calling_capable_models:
    - qwen3:14b  # Example explicit whitelist
    - qwen3:8b
  ```
- `capability.py`:
  - `get_tool_capability(model, config, ollama_client)`:
    1. Check `config.tool_calling_capable_models` whitelist first
    2. If not in whitelist, query Ollama `/api/show` for `capabilities` array
    3. Return "structured" if `"tools"` in capabilities, else "none"
  - Cache layer (in-memory only, no TTL):
    - Simple dict: `{model: "structured" | "none"}`
    - No expiration (capabilities don't change during process lifetime)
    - Cache rebuilt on proxy restart
- Add to `transport.py`:
  - `async def show_model(model: str) -> dict` - wrapper for `/api/show`
- `routing.py` additions:
  - Add `tool_calling_capable_models: list[str]` to `RoutingConfig`
  - Load from `cc-proxy.yaml` (same pattern as `thinking_capable_models`)
- Request handling:
  - If `capability == "none"` and request has `tools`:
    - Return 400: `"Model {model} does not support tool calling"`
    - Fail-fast (don't drop tools silently)

**No probing needed:** Ollama's `/api/show` endpoint provides authoritative capability metadata.

Tests:
- Unit: Config whitelist takes precedence over Ollama metadata
- Unit: Ollama metadata detection (`"tools"` in capabilities array)
- Unit: In-memory cache lookup
- Unit: 400 error when tools requested but capability=none
- Integration: Real `/api/show` call to Ollama (optional, slow)

### Phase 5 — repo UX hardening (optional; only after Phase 2–4 are stable)

**Goal:** improve ergonomics without destabilizing the core.

Examples:
- better `make help` output and docs strings
- richer `status` output
- structured logs and debug endpoints (`/capabilities`)

### Phase 6 — streaming support (✅ COMPLETE)

**Goal:** support streamed responses without breaking repair logic.

**Implemented:**
- ✅ `chat_anthropic_compat_stream()` in `transport.py` using `httpx.AsyncClient.stream()`
- ✅ `stream_from_anthropic_compat()` in `adapt_response.py` for SSE parsing and tool repair
- ✅ Streaming path in `main.py` with `StreamingResponse` (text/event-stream)
- ✅ Preserved `stream` parameter in `adapt_request.py`
- ✅ Tool repair applied to tool_use blocks in streaming context
- ✅ Streaming tests with `pytest.mark.streaming` marker

**Format:**
- Ollama `/v1/messages` streams using Server-Sent Events (SSE) format
- Chunks are parsed line-by-line for `data: {...}` events
- Tool repair is applied to complete `tool_use` blocks as they arrive
- Non-streaming path remains unchanged for `stream=false`

Tests:
- ✅ Unit: text-only streaming, tool repair in streaming, non-streaming compatibility
- ✅ 3 streaming tests passing

### Phase 7 — OpenAI-compat backend support (deferred)

**Goal:** support Ollama's `/v1/chat/completions` (OpenAI-compat) endpoint as an alternative backend.

**Status:** Deferred. Current implementation focuses exclusively on Anthropic-compat (`/v1/messages`). This phase will add:
- `to_openai_compat()` request adapter (already partially exists but not used)
- OpenAI response → Anthropic response adapter
- Backend selection logic in routing
- Tool-call format conversion (OpenAI `tool_calls` → Anthropic `tool_use`)

**Rationale:** Since Ollama now provides `/v1/messages` with Anthropic-compatible format, the OpenAI-compat path is lower priority and adds complexity without clear benefit for the current use case.

## Module-by-module tasks (one module per task)

This is the **work breakdown** for the codebase under `cc_proxy/`. Each task is scoped to *at most one module* and includes: what it does, required classes/functions, and tests.

### 1) `cc_proxy/app/settings.py` — configuration

- **What it does**
  - Centralizes all configuration: ports, auth mode/key, Ollama base URL, model alias mapping, feature flags, cache TTL/paths.
- **Required code**
  - `Settings(BaseSettings)` (Pydantic settings) with (suggested) fields:
    - `proxy_port: int = 3456`
    - `ollama_base_url: str = "http://host.docker.internal:11434"`
    - `auth_mode: Literal["api_key", "bearer"]`
    - `auth_key: str`
    - `capability_cache_path: Path = "~/.cache/cc-proxy/capabilities.json"`
    - `capability_ttl_seconds: int = 86400`
    - `model_aliases: dict[str, str]` (e.g. `{"sonnet": "qwen3:14b"}`)
- **Tests**
  - `cc_proxy/tests/test_settings.py`
    - env overrides work
    - defaults are correct
    - invalid values rejected

### 2) `cc_proxy/app/auth.py` — auth dependency

- **What it does**
  - Ensures the proxy isn’t accidentally open: rejects requests missing/invalid auth.
- **Required code**
  - `require_auth(settings: Settings)` FastAPI dependency
  - Accept **exactly one** scheme depending on `settings.auth_mode`:
    - `x-api-key: <key>` (pairs well with Claude Code `ANTHROPIC_API_KEY`)
    - `Authorization: Bearer <key>` (pairs well with `ANTHROPIC_AUTH_TOKEN`)
  - Raises `HTTPException(status_code=401)` on mismatch
- **Tests**
  - `cc_proxy/tests/test_auth.py`
    - missing header → 401
    - wrong key → 401
    - correct key → 200

### 3) `cc_proxy/app/models_anthropic.py` — Anthropic Messages API models (subset)

- **What it does**
  - Defines the minimal Pydantic models needed to parse Claude Code `POST /v1/messages` and to return Anthropic-shaped responses.
- **Required code**
  - `Message(role, content)`
  - `Tool(name, description, input_schema)`
  - `MessagesRequest(model, messages, tools?, max_tokens?, ...)` (be permissive initially; preserve unknown fields)
  - Content blocks:
    - `ContentBlockText(type="text", text)`
    - `ContentBlockToolUse(type="tool_use", id, name, input)`
  - `MessagesResponse(role="assistant", content=[...], ...)`
- **Tests**
  - `cc_proxy/tests/test_models_anthropic.py`
    - parses representative request fixtures
    - serializes response fixtures to the expected shape

### 4) `cc_proxy/app/models_ollama.py` — backend models

- **What it does**
  - Defines request/response models for whichever backend API we choose:
    - Ollama native (`/api/chat`) and/or
    - OpenAI-compat (`/v1/chat/completions`)
- **Required code**
  - Native:
    - `OllamaChatRequest(model, messages, tools?, stream=False, options?)`
    - `OllamaChatResponse(message, done, ...)`
  - OpenAI-compat (subset):
    - `OpenAIChatCompletionsRequest/Response`
- **Tests**
  - `cc_proxy/tests/test_models_ollama.py`
    - parses sample responses for chosen backend mode(s)

### 5) `cc_proxy/app/transport.py` — backend HTTP client

- **What it does**
  - Owns all outbound calls to Ollama and normalizes transport errors.
- **Required code**
  - `OllamaClient(httpx.AsyncClient)` with:
    - `chat_native(req) -> dict`
    - `chat_openai_compat(req) -> dict`
  - Transport error mapping:
    - connect/timeouts → 502
    - non-2xx passthrough with sanitized error body
- **Tests**
  - `cc_proxy/tests/test_transport.py` using mocked HTTPX (e.g. `respx`)
    - endpoint selection correctness
    - timeout/connect error mapping

### 6) `cc_proxy/app/routing.py` — model alias mapping + policy

- **What it does**
  - Maps Claude Code model names (`sonnet`, `opus`, `haiku`) to concrete Ollama models and declares per-model policy knobs.
- **Required code**
  - `Policy` (dataclass) e.g.:
    - `tool_schema_simplification: Literal["none", "basic"]`
    - `allow_retry_toolless: bool`
  - `ModelRouter`:
    - `resolve_model(requested: str) -> str`
    - `policy_for(resolved_model: str) -> Policy`
- **Tests**
  - `cc_proxy/tests/test_routing.py`
    - alias mapping
    - unknown model handling (explicit error vs passthrough)

### 7) `cc_proxy/app/adapt_request.py` — RequestAdapter

- **What it does**
  - Converts Anthropic `/v1/messages` requests into the selected Ollama request format while dropping/rewriting unsupported fields.
- **Required code**
  - `RequestAdapter`:
    - `to_backend(request: MessagesRequest, resolved_model: str, capabilities: CapabilityReport | None, policy: Policy) -> BackendRequest`
  - Explicit removal of known-breakers:
    - `thinking`, `extended_thinking`, `reasoning_effort`, prompt caching/metadata fields (expand as observed)
  - Tool schema simplification when `policy.tool_schema_simplification == "basic"`
- **Tests**
  - `cc_proxy/tests/test_adapt_request.py`
    - param stripping is deterministic
    - model mapping is correct
    - simplification behaves as intended

### 8) `cc_proxy/app/adapt_response.py` — ResponseValidator + repair

- **What it does**
  - Converts backend responses into a Claude-Code-acceptable Anthropic response and repairs common tool-call defects.
- **Required code**
  - `ResponseRepairer` / `ResponseValidator`:
    - `to_anthropic(backend_json: dict, request_tools: list[Tool] | None) -> MessagesResponse`
  - Repair passes (apply in order):
    - add missing `tool_use.id`
    - parse stringified `tool_use.input`
    - OpenAI `tool_calls` → Anthropic `tool_use`
    - validate tool name exists in request tool list (if tools provided)
    - drop unrepairable tool blocks
- **Tests**
  - `cc_proxy/tests/test_tool_repair.py`
    - fixtures for each repair pass
    - output always valid Anthropic-shaped response

### 9) `cc_proxy/app/capability.py` — capability detection + cache

- **What it does**
  - Detects per-model capability level and caches results (in memory + on disk with TTL).
- **Required code**
  - `CapabilityCache`:
    - `get(model) -> CapabilityReport | None` (TTL-aware)
    - `set(model, report) -> None` (persist)
  - `CapabilityDetector`:
    - `detect(model: str) -> CapabilityReport`
    - probe suite: basic completion + “calculator tool” tool-call test
    - classify: `none | basic | structured`
- **Tests**
  - `cc_proxy/tests/test_capability.py`
    - TTL freshness vs stale behavior
    - classification logic with mocked backend responses

### 10) `cc_proxy/app/main.py` — FastAPI app wiring

- **What it does**
  - Wires middleware, dependencies, adapters, and transport into a runnable API.
- **Required code**
  - `app = FastAPI()`
  - Middleware:
    - request ID + timing (and optional log correlation)
  - Dependencies:
    - `settings: Settings`
    - `require_auth`
    - `ollama_client: OllamaClient`
    - `capability_cache/detector`
  - Routes:
    - `GET /health`
    - `GET /capabilities` (optional)
    - `POST /v1/messages` (non-streaming first)
- **Tests**
  - `cc_proxy/tests/test_contract.py`
    - `/health` 200 + JSON
    - `/v1/messages` returns Anthropic-shaped response
    - auth enforcement works

### 11) `scripts/manage.py` — repo integration (provider mode)

- **What it does**
  - Adds a `setup ollama-proxy` mode that points Claude Code at the proxy and manages proxy lifecycle.
- **Required code**
  - `setup_ollama_proxy()`:
    - writes `~/.claude/settings.json` with `ANTHROPIC_BASE_URL=http://localhost:3456`
  - `start_proxy()` / `stop_proxy()`:
    - run uvicorn in background
    - PID/log handling similar to LiteLLM
- **Tests**
  - Smoke checks:
    - settings file written correctly
    - proxy starts and `/health` reachable

### 12) `Makefile` — UX entrypoints

- **What it does**
  - Exposes the proxy workflow as stable make targets.
- **Required code**
  - `setup-ollama-proxy` (delegates to `scripts/manage.py setup ollama-proxy`)
  - optional `proxy-start` / `proxy-stop`
- **Tests**
  - Manual/smoke:
    - `make setup-ollama-proxy` succeeds and `make status` reflects expected mode
