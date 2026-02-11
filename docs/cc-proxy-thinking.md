# Thinking trace handling (research summary)

This document summarizes how thinking traces should flow through cc-proxy based on
Ollama and Anthropic documentation, and highlights open questions for Claude Code CLI.

## Source references
- Ollama thinking capability: https://docs.ollama.com/capabilities/thinking
- Anthropic extended thinking: https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking
- Anthropic Messages API (thinking/redacted_thinking blocks): https://docs.anthropic.com/en/api/messages

## Current state in this repo
- Requests are forwarded to Ollama's Anthropic‑compatible `/v1/messages` endpoint.
- Request adaptation preserves `thinking` configs for thinking-capable models.
- **Thinking policy is enforced**: thinking/redacted_thinking blocks are dropped for non-capable models.
- Response adaptation passes through Anthropic content blocks unchanged.
- When thinking blocks are dropped, the proxy emits:
  - HTTP header: `X-CC-Proxy-Warning: thinking_dropped`
  - Structured log event: `event: "thinking.block_handled"` with block counts

## Forward path: Claude Code -> Ollama
Claude Code sends Anthropic Messages requests, which may include a `thinking` config:
- `thinking: { type: "enabled", budget_tokens: ... }`
- `thinking: { type: "disabled" }`

The proxy forwards `thinking` configs as-is to `/v1/messages` for thinking-capable models.
For non-capable models, the `thinking` config is still forwarded but any thinking/redacted_thinking
**blocks** in message content are dropped (see Backward path).

**Note**: We use Ollama's Anthropic-compatible endpoint (`/v1/messages`), not the native
`/api/chat` endpoint, so we do **not** translate to Ollama's native `think` field.

## Backward path: Ollama -> Claude Code
Anthropic Messages responses support these content blocks:
- `thinking` blocks: `{ "type": "thinking", "thinking": "...", "signature": "..." }`
- `redacted_thinking` blocks: `{ "type": "redacted_thinking", "data": "..." }`

Anthropic extended thinking docs state:
- Responses include thinking blocks followed by text blocks.
- When tools are involved, thinking blocks must be preserved and passed back to
  maintain reasoning continuity across a tool-use turn.
- Redacted thinking can occur and is expected.

### Thinking policy enforcement

The proxy **enforces** a thinking policy based on model capability:

1. **Thinking-capable models** (listed in `cc-proxy.yaml`):
   - Thinking and redacted_thinking blocks are **passed through unchanged**
   - No warning headers or log events

2. **Non-thinking-capable models**:
   - Thinking and redacted_thinking blocks are **dropped** from message content
   - Warning header added: `X-CC-Proxy-Warning: thinking_dropped`
   - Structured log event emitted: `event: "thinking.block_handled"` with counts

**Implementation**: `apply_thinking_policy()` in `app/adapt_request.py`

Implication: To preserve thinking traces in Claude Code, the model must be listed
in `thinking_capable_models` in `cc-proxy.yaml`. The proxy will then return valid
thinking blocks in the response `content` array if Ollama generates them.

## CLI visibility

Claude Code CLI does not guarantee rendering response headers visibly in the console.

When thinking blocks are dropped for non-capable models, the proxy provides visibility via:
1. **HTTP Response Header**: `X-CC-Proxy-Warning: thinking_dropped`
2. **Structured Log Event**: `event: "thinking.block_handled"` with fields:
   - `model`: the resolved model name
   - `thinking_capable`: boolean
   - `thinking_blocks`: count of thinking blocks encountered
   - `redacted_blocks`: count of redacted_thinking blocks encountered
   - `dropped_blocks`: count of blocks actually dropped

The log event is visible in server logs (stdout JSON logs) and can be correlated via
`trace_id` / `request_id`.

## Static allowlist + dynamic detection
We should combine:
1) Static allowlist for known thinking-capable models in `cc-proxy.yaml`.
2) Dynamic capability detection for all other models:
   - Send a tiny `/v1/messages` request with `thinking: { type: "enabled", budget_tokens: ... }`.
   - If response contains a thinking trace, treat model as thinking-capable.

Default is **not** thinking-capable; detection only upgrades a model from
not-capable → capable. This aligns with the Phase 4 capability detection plan
and is specific to thinking support in the Anthropic-compatible upstream path.

## Key risks and constraints
- OpenAI-compatible `/v1/chat/completions` may not expose the thinking trace.
- Anthropic compatibility should expose thinking blocks, but actual behavior still
  depends on model support and Ollama’s implementation.
- Streaming adds complexity: thinking and text tokens can interleave.
- Tool-use loops in Anthropic require thinking blocks to be preserved across the
  turn; dropping them may reduce tool reliability.

