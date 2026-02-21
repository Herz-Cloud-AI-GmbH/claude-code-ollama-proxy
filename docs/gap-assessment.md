# Gap Assessment: Claude Code ↔ Ollama Proxy CLI Tool

## Overview

This document assesses the gap between the current state of the repository (empty)
and a production-ready **claude-code-ollama-proxy** — a CLI tool and proxy server
that lets [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview) (and
any Anthropic-API-compatible client) talk to locally-running models served by
[Ollama](https://ollama.com/).

---

## What is needed?

### The Problem

Claude Code uses the **Anthropic Messages API** (`POST /v1/messages`) with a specific
JSON schema and a rich **Server-Sent Events (SSE) streaming** protocol. Ollama exposes
its own **chat/generate REST API** (`POST /api/chat`) with a different schema and a
simpler **NDJSON streaming** protocol. These two formats are incompatible out of the box.

### The Goal

A lightweight HTTP proxy that:
1. Listens on `localhost:<port>` for incoming Anthropic-format requests.
2. Translates requests to Ollama format and forwards them to an Ollama instance.
3. Translates Ollama responses back to Anthropic format (both streamed and non-streamed).
4. Is packaged as an `npx`-runnable / globally-installable **CLI tool**.

---

## Current State vs. Required State

| Capability | Current | Required |
|---|---|---|
| Repository scaffolding | ❌ Empty | ✅ package.json, tsconfig, build |
| HTTP proxy server | ❌ None | ✅ Express-based, `POST /v1/messages` |
| Request translation (Anthropic→Ollama) | ❌ None | ✅ model, messages, system, options |
| Response translation (Ollama→Anthropic) | ❌ None | ✅ Non-streaming response object |
| Streaming translation (SSE←NDJSON) | ❌ None | ✅ Full SSE event sequence |
| Token counting (streaming) | ❌ None | ✅ Uses Ollama `eval_count` in final chunk |
| Model name mapping | ❌ None | ✅ Claude model → Ollama model mapping |
| CLI tool (`npx claude-code-ollama-proxy`) | ❌ None | ✅ `commander`-based CLI with options |
| Configuration (env vars + CLI flags) | ❌ None | ✅ port, ollama-url, model-map |
| Error handling & forwarding | ❌ None | ✅ Anthropic-compatible error format |
| Health check endpoint | ❌ None | ✅ `GET /health` |
| `/v1/models` endpoint | ❌ None | ✅ Proxied from Ollama model list |
| Test suite | ❌ None | ✅ Unit + integration tests (Vitest) |
| Documentation | ❌ None | ✅ README, CLI, API, Streaming docs |
| `.gitignore` / build config | ❌ None | ✅ Standard Node.js project hygiene |

---

## Key Technical Gaps

### 1. Anthropic SSE vs. Ollama NDJSON Streaming

**Anthropic** streams as Server-Sent Events with named event types:

```
event: message_start
data: {"type":"message_start","message":{"id":"msg_xxx","type":"message","role":"assistant","content":[],"model":"claude-3-5-sonnet-20241022","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":1}}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}

event: ping
data: {"type":"ping"}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":5}}

event: message_stop
data: {"type":"message_stop"}
```

**Ollama** streams as newline-delimited JSON:

```json
{"model":"llama3.1","created_at":"...","message":{"role":"assistant","content":"Hello"},"done":false}
{"model":"llama3.1","created_at":"...","message":{"role":"assistant","content":""},"done":true,"done_reason":"stop","eval_count":5,"prompt_eval_count":10}
```

The proxy must buffer and transform each Ollama chunk into the corresponding SSE events.

### 2. Token Counting in Streaming Mode

Anthropic clients (including Claude Code) expect token usage in the `message_delta` event.
Ollama only reports `eval_count` (output tokens) and `prompt_eval_count` (input tokens) in
the **final** NDJSON chunk (`done: true`). The proxy must:
- Accumulate output token count across the stream (or use the final `eval_count`).
- Report counts in the `message_delta` SSE event.

### 3. Model Name Mapping

Claude Code sends model names like `claude-3-5-sonnet-20241022` or `claude-opus-4-5`.
Ollama serves models by their own names (`llama3.1`, `mistral`, etc.).
The proxy must support a configurable mapping:
- Default map (sensible defaults for common Claude models → Ollama models).
- CLI flag and environment variable overrides.

### 4. System Prompt Handling

Anthropic sends a top-level `system` field. Ollama expects it as a `system` role message
(first in the messages array) or the `system` parameter in the request body. The proxy
must correctly move the system prompt to the right place.

### 5. Error Format Compatibility

Anthropic clients expect errors in this format:
```json
{"type":"error","error":{"type":"api_error","message":"..."}}
```
The proxy must catch Ollama errors or connection failures and respond accordingly.

---

## Architecture Decision

**Stack:** TypeScript + Node.js (≥18)
- **HTTP Framework:** Express.js — battle-tested, minimal, easy to extend
- **CLI Framework:** Commander.js — standard for Node.js CLIs
- **HTTP Client:** Native `fetch` (Node.js 18+ built-in, no extra dependency)
- **Testing:** Vitest — fast, native TypeScript, modern
- **Build:** `tsc` (TypeScript compiler) + `tsup` for bundling CLI
- **Package distribution:** npm package with `bin` entry

**Why not Python?** Node.js is the native runtime for npm-distributed CLI tools and aligns
with the Claude Code ecosystem (TypeScript/JS).

---

## Summary

The gap is **100% implementation** — from zero to a fully functional, tested, documented,
npm-publishable CLI proxy. The work spans: project setup, core proxy logic, streaming
translation (the hardest piece), token counting, CLI, error handling, tests, and docs.
