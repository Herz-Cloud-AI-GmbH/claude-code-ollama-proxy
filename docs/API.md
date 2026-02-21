# API Endpoints

The proxy exposes three HTTP endpoints that mimic the Anthropic API surface.

---

## `POST /v1/messages`

The core proxy endpoint. Accepts an Anthropic-format Messages API request and
translates it to an Ollama chat request, then translates the response back.

### Request

The request body is identical to the
[Anthropic Messages API](https://docs.anthropic.com/en/api/messages).

```json
{
  "model": "claude-3-5-sonnet-20241022",
  "messages": [
    { "role": "user", "content": "Explain recursion in one sentence." }
  ],
  "system": "You are a concise technical writer.",
  "max_tokens": 200,
  "temperature": 0.7,
  "stream": false
}
```

**Supported fields:**

| Field | Type | Description |
|---|---|---|
| `model` | string | Claude model name (mapped to Ollama via model map) |
| `messages` | array | Array of `{role, content}` objects |
| `system` | string | System prompt (prepended as system message to Ollama) |
| `max_tokens` | integer | Maps to Ollama's `options.num_predict` |
| `temperature` | float | Maps to Ollama's `options.temperature` |
| `top_p` | float | Maps to Ollama's `options.top_p` |
| `top_k` | integer | Maps to Ollama's `options.top_k` |
| `stop_sequences` | array | Maps to Ollama's `options.stop` |
| `stream` | boolean | Enable SSE streaming |

### Response (non-streaming)

```json
{
  "id": "msg_a1b2c3d4e5f60708",
  "type": "message",
  "role": "assistant",
  "content": [
    { "type": "text", "text": "Recursion is a function calling itself." }
  ],
  "model": "claude-3-5-sonnet-20241022",
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "usage": {
    "input_tokens": 25,
    "output_tokens": 9
  }
}
```

### Response (streaming)

When `stream: true`, the response uses `Content-Type: text/event-stream` and
follows the [Anthropic SSE streaming format](STREAMING.md).

### Model Translation

The `model` field in the request is mapped to an Ollama model name using the
configured [model map](../README.md#default-model-map). The **original** Claude
model name is always returned in the response — the internal Ollama model name
is never exposed to the client.

### Error Response

On failure, the proxy returns an Anthropic-compatible error:

```json
{
  "type": "error",
  "error": {
    "type": "api_connection_error",
    "message": "Cannot connect to Ollama at http://localhost:11434. Is Ollama running?"
  }
}
```

| Error type | HTTP status | Cause |
|---|---|---|
| `api_connection_error` | 502 | Ollama unreachable |
| `api_error` | 502 | Ollama returned an error |

---

## `GET /v1/models`

Returns the list of models available in Ollama, formatted as an Anthropic-style
model list. Useful for tooling that queries available models.

### Response

```json
{
  "object": "list",
  "data": [
    {
      "id": "llama3.1:8b",
      "object": "model",
      "created": 1704067200,
      "owned_by": "ollama"
    },
    {
      "id": "mistral:latest",
      "object": "model",
      "created": 1704067200,
      "owned_by": "ollama"
    }
  ]
}
```

---

## `GET /health`

Returns the current health status of the proxy. Does **not** test Ollama
connectivity — it only confirms the proxy itself is running.

### Response

```json
{
  "status": "ok",
  "ollama": "http://localhost:11434"
}
```

HTTP status is always `200` when the proxy is up.

---

## Request Headers

No special headers are required. The proxy ignores the `Authorization` /
`x-api-key` header entirely, so any placeholder value works:

```
Authorization: Bearer any-value
```

or

```
x-api-key: any-value
```
