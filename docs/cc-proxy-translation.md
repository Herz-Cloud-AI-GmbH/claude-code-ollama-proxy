# cc-proxy translation rules (Anthropic upstream)

This document describes how `cc-proxy` forwards Claude Code (Anthropic Messages API)
requests to Ollama's Anthropic‑compatible `/v1/messages` endpoint. The proxy
preserves content blocks (text, thinking, tool_use, tool_result) and performs minimal
sanitization.

**Implementation**: `cc_proxy/app/adapt_request.py` (see `to_anthropic_compat()` and `prepare_anthropic_payload()`)

---

## 1) Content blocks (passthrough)

Claude Code can send message content as:

- a **string** (plain text)
- a **list of content blocks** (e.g., `[{ "type": "text", "text": "..." }, ... ]`)

### Rules

1. If `content` is a **string** → pass through unchanged.
2. If `content` is a **list of blocks** → pass through unchanged.
3. If `content` is neither a string nor a list → coerce to `""`.

This preserves `thinking`, `redacted_thinking`, `tool_use`, and `tool_result` blocks
for upstream processing.

**Code**: `to_anthropic_compat()` in `adapt_request.py` normalizes content but does not flatten blocks.

### Thinking handling

The proxy applies a **thinking policy** after initial content passthrough:

- If the resolved model is **thinking-capable** (listed in `cc-proxy.yaml`), forward `thinking` and
  `redacted_thinking` blocks unchanged.
- If the model is **not** thinking-capable, drop those blocks and emit a warning
  header/log entry (`X-CC-Proxy-Warning: thinking_dropped`).

Thinking-capable models are listed in `cc_proxy/cc-proxy.yaml` (`thinking_capable_models`).
All other models default to **not** thinking-capable.

**Code**: `apply_thinking_policy()` in `adapt_request.py`

Console visibility note: Claude Code CLI does not guarantee showing response
headers. When thinking blocks are dropped, the proxy emits a warning log message
(`event: "thinking.block_handled"`) to provide visibility in server logs.

---

## 2) Request fields dropped

The proxy removes fields that Ollama's Anthropic compatibility does not support:

- `metadata`
- `tool_choice`
- `prompt_caching`
- `cache_control`

All other fields (including `thinking`, `tools`, `system`, `temperature`, `max_tokens`) are forwarded.

**Code**: `_ANTHROPIC_DROP_FIELDS` in `adapt_request.py`

---

## 3) Tool calling enhancements

### "use_tools" marker detection

If Claude Code includes the text `"use_tools"` (case-insensitive) in user messages:

1. The marker is **stripped** from message content (both string and text blocks)
2. A system instruction is **injected**: `"You must call a tool. Do not answer in natural language."`
3. Temperature is set to `0` (if not already set)

This helps force tool-calling behavior in local models that might otherwise ignore tools.

**Code**: `_apply_use_tools_marker()` and `_ensure_tool_use_system_instruction()` in `adapt_request.py`

### Tool blocks passthrough

The proxy passes through:
- `tools` (tool definitions) in the request
- `tool_result` blocks in message content

The proxy **repairs** `tool_use` blocks in the Anthropic upstream path:
- Parse stringified JSON inputs
- Add missing IDs (deterministic hash)
- Validate tool names (case-insensitive)
- Drop invalid tool blocks and replace with a text warning

Warnings are surfaced via `X-CC-Proxy-Warning`:
- `tool_use_repaired` when any tool_use repair occurs
- `tool_use_dropped` when invalid tool_use blocks are removed

If tools are present and the resolved model is not tool-capable, the proxy
returns a 400 `invalid_request_error`.

---

## 4) Streaming support

When `stream=true` is present in the request:
- The proxy uses `chat_anthropic_compat_stream()` to stream from Ollama
- Ollama streams responses in SSE format (`data: {...}\n\n`)
- NDJSON lines are accepted as a fallback and re-emitted as SSE
- Tool repair is applied to `content_block_start` events containing `tool_use` blocks
- Responses are re-emitted in SSE format to Claude Code

Tool-call streaming is gated by `tool_call_streaming_enabled` (default `false`).
If tools are present and streaming is disabled, the proxy returns `400 invalid_request_error`.

**Format:** Server-Sent Events (SSE) with `text/event-stream` content type.

**Tool repair in streaming:**
- Repairs are applied only to `content_block_start` events containing `tool_use` blocks
- Missing IDs and stringified JSON inputs are repaired
- Invalid tool names are replaced with a warning text block

---

## 5) Transport notes

- Non-streaming requests: `POST {OLLAMA_BASE_URL}/v1/messages` with `stream=false`
- Streaming requests: `POST {OLLAMA_BASE_URL}/v1/messages` with `stream=true`
- The resolved model name is used in the upstream request (after alias resolution).

---

## 6) Where this is implemented

- `cc_proxy/app/adapt_request.py`
  - `to_anthropic_compat()` - Anthropic passthrough with field sanitization
  - `apply_thinking_policy()` - Drop thinking blocks for non-capable models
  - `prepare_anthropic_payload()` - Main entry point combining all adaptations
  - `_apply_use_tools_marker()` - Detect and strip "use_tools" marker
  - `_ensure_tool_use_system_instruction()` - Inject tool-forcing system instruction
- `cc_proxy/app/adapt_response.py`
  - `from_anthropic_compat()` - Validate and normalize Anthropic response + repair tool_use blocks
  - `stream_from_anthropic_compat()` - SSE streaming adapter with tool repair
- `cc_proxy/app/transport.py`
  - `chat_anthropic_compat_stream()` - Streaming transport method
- `cc_proxy/app/capability.py`
  - `get_tool_capability()` - Tool capability detection (whitelist + `/api/show`)
