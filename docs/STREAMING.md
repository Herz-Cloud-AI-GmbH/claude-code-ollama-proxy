# Streaming Architecture

This document explains how the proxy translates between Ollama's NDJSON streaming
format and Anthropic's Server-Sent Events (SSE) streaming format.

---

## Protocol Comparison

### Ollama (NDJSON)

Ollama streams responses as **newline-delimited JSON** over a regular HTTP
response body. Each line is a self-contained JSON object:

```
{"model":"llama3.1","created_at":"...","message":{"role":"assistant","content":"Hello"},"done":false}
{"model":"llama3.1","created_at":"...","message":{"role":"assistant","content":" world"},"done":false}
{"model":"llama3.1","created_at":"...","message":{"role":"assistant","content":""},"done":true,"done_reason":"stop","eval_count":12,"prompt_eval_count":20}
```

Key points:
- `done: false` chunks carry partial text in `message.content`
- The final `done: true` chunk carries **token counts** (`eval_count`, `prompt_eval_count`)
- There is only one final chunk — token counts are not available mid-stream

### Anthropic SSE

Anthropic uses **Server-Sent Events** with named event types:

```
event: message_start
data: {"type":"message_start","message":{"id":"msg_xxx","type":"message","role":"assistant","content":[],"model":"claude-3-5-sonnet-20241022","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":20,"output_tokens":1}}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}

event: ping
data: {"type":"ping"}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":12}}

event: message_stop
data: {"type":"message_stop"}
```

---

## Translation State Machine

The `createStreamTransformer` function (`src/streaming.ts`) maintains a simple
boolean state (`isFirst`) and maps each Ollama chunk to one or more SSE events:

```
Ollama Chunk                        SSE Events emitted
────────────────────────────────    ──────────────────────────────────────────
First chunk (done: false)           message_start
  message.content = "Hello"         content_block_start
                                    ping
                                    content_block_delta (text: "Hello")

Subsequent chunks (done: false)     content_block_delta (text: " world")
  message.content = " world"

Empty chunk (done: false)           (nothing — skips zero-length deltas)
  message.content = ""

Final chunk (done: true)            [content_block_delta if content non-empty]
  eval_count = 12                   content_block_stop
  done_reason = "stop"              message_delta (output_tokens: 12)
                                    message_stop
```

---

## Token Counting in Streaming Mode

### The Challenge

Anthropic clients (including Claude Code) expect token usage data in the
`message_delta` event. Specifically:

```json
{
  "type": "message_delta",
  "delta": { "stop_reason": "end_turn", "stop_sequence": null },
  "usage": { "output_tokens": 12 }
}
```

Ollama only provides token counts in the **final** `done: true` chunk via
`eval_count` (output tokens) and `prompt_eval_count` (input tokens).

### Solution

The proxy delays emitting `message_delta` until it receives the final Ollama
chunk. The `eval_count` value from that chunk becomes the `output_tokens` in
`message_delta.usage`.

Input tokens (`prompt_eval_count`) are reported in `message_start.message.usage`
when available (set to `0` initially, as Ollama does not provide this until the
final chunk). Claude Code uses the `message_delta` output token count for billing
display, which is always accurate.

---

## SSE Response Headers

The proxy sets the following response headers for streaming:

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no
```

The `X-Accel-Buffering: no` header disables response buffering in Nginx reverse
proxies, ensuring chunks are forwarded immediately.

---

## Partial Buffer Handling

Ollama may not flush complete JSON lines with every TCP segment. The proxy
maintains a text buffer and uses `parseOllamaNDJSON` (`src/streaming.ts`) to:

1. Split the buffer on `\n`
2. Parse all complete lines as JSON
3. Keep the incomplete last fragment in the buffer for the next read

This ensures no data is lost even when Ollama sends partial lines.

---

## stop_reason Mapping

| Ollama `done_reason` | Anthropic `stop_reason` |
|---|---|
| `stop` (or undefined) | `end_turn` |
| `length` | `max_tokens` |

---

## Thinking Block Streaming

When using a thinking-capable model (qwen3, deepseek-r1, etc.) with `thinking` enabled,
Ollama returns chunks with a `message.thinking` field before returning `message.content`.

### Ollama thinking stream

```
{"model":"qwen3","message":{"role":"assistant","content":"","thinking":"Let me analyze this..."},"done":false}
{"model":"qwen3","message":{"role":"assistant","content":"","thinking":"I need to consider..."},"done":false}
{"model":"qwen3","message":{"role":"assistant","content":"The answer is 42.","thinking":""},"done":false}
{"model":"qwen3","message":{"role":"assistant","content":"","thinking":""},"done":true,"eval_count":25}
```

### Anthropic SSE for thinking

```
event: message_start
data: {"type":"message_start","message":{"id":"msg_xxx","model":"claude-3-5-sonnet-20241022",...}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}

event: ping
data: {"type":"ping"}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Let me analyze..."}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"I need to..."}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: content_block_start
data: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"The answer is 42."}}

event: content_block_stop
data: {"type":"content_block_stop","index":1}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":25}}

event: message_stop
data: {"type":"message_stop"}
```

### Transition Logic

The stream transformer tracks which block type is currently open:

| Previous state | Trigger | Action |
|---|---|---|
| `none` | First chunk has `thinking` | Open thinking block (index 0) |
| `none` | First chunk has `content` only | Open text block (index 0) |
| `thinking` | Chunk has `content` but no `thinking` | Close thinking block, open text block (next index) |
| `text` | Tool calls appear | Close text block, emit tool_use block(s) |
| any | `done: true` | Close current block → message_delta → message_stop |

---

## Tool Call Streaming

When Ollama returns `tool_calls` in a chunk, the proxy emits a complete
`content_block_start` → `content_block_delta` → `content_block_stop` sequence
for each tool call, with the `input_json_delta` delta type:

```
event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_xxx","name":"bash","input":{}}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"command\":\"ls -la\"}"}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}
```
