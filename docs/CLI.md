# CLI Reference

## Synopsis

```
claude-code-ollama-proxy [options]
```

## Options

### `-c, --config <path>`

**Default:** auto-discovers `proxy.config.json` in the current directory

Load proxy settings from a JSON config file. Config file values are overridden
by CLI flags and environment variables.

```bash
claude-code-ollama-proxy --config /etc/proxy.config.json
```

---

### `--init`

Write a default `proxy.config.json` to the current directory and exit.
Edit the file, then run the proxy.

```bash
claude-code-ollama-proxy --init
# → Creates proxy.config.json
# Edit the file, then:
claude-code-ollama-proxy
```

The generated file is fully documented with inline comments and ready to
be read and modified by AI agents.

---

### `-p, --port <number>`

**Default:** `3000`  
**Environment:** `PORT`

The TCP port the proxy server listens on.

```bash
claude-code-ollama-proxy --port 8080
PORT=8080 claude-code-ollama-proxy
```

---

### `-u, --ollama-url <url>`

**Default:** `http://localhost:11434`  
**Environment:** `OLLAMA_URL`

The base URL of the Ollama instance to forward requests to.

```bash
# Remote Ollama
claude-code-ollama-proxy --ollama-url http://192.168.1.100:11434
```

---

### `-m, --model-map <mapping>`

**Repeatable**  
**Default:** empty (all models fall through to `--default-model`)

Map a Claude model name to an Ollama model name. Two formats are supported:

**`key=value` format (repeatable):**

```bash
claude-code-ollama-proxy \
  -m claude-sonnet-4-5=qwen3:8b \
  -m claude-haiku-4-5=qwen3:1.7b
```

**JSON format:**

```bash
claude-code-ollama-proxy \
  --model-map '{"claude-sonnet-4-5":"qwen3:8b"}'
```

> **Note:** The model map is for advanced tier-based routing. The simpler
> AI-agent-first approach is to set `ANTHROPIC_MODEL=<your-ollama-model>`
> in Claude Code — no model map configuration needed.

---

### `-d, --default-model <model>`

**Default:** `llama3.1`  
**Environment:** `DEFAULT_MODEL`

The Ollama model to use when the requested model is not found in the model map.
This is the **most important setting** for a simple setup.

```bash
claude-code-ollama-proxy --default-model qwen3:8b
DEFAULT_MODEL=qwen3:8b claude-code-ollama-proxy
```

---

### `--strict-thinking`

**Default:** `false` (thinking is **silently stripped**)

When this flag is set, requests that include a `thinking` field for a model
that does not support extended thinking return **HTTP 400** instead of silently
stripping the field.

The default (no flag) is the **AI-agent-friendly** behaviour: Claude Code
auto-generates thinking requests and would break on a 400. Stripping the field
keeps the session alive.

Use `--strict-thinking` only during development to surface mis-configuration:

```bash
claude-code-ollama-proxy --strict-thinking
```

Can also be set in the config file:

```json
{ "strictThinking": true }
```

---

### `-v, --verbose`

**Default:** `false`  
**Equivalent to:** `--log-level debug`

Enable detailed request and response logging. Shorthand for `--log-level debug`.

---

### `--log-level <level>`

**Default:** `info`  
**Environment:** `LOG_LEVEL`  
**Values:** `error` | `warn` | `info` | `debug`

Set the minimum log level. Records below this threshold are suppressed before
any body serialisation, so `info` carries zero overhead for body-level debug
logging in streaming hot paths.

| Level | Records emitted |
|-------|----------------|
| `error` | Connection errors, Ollama errors, unhandled exceptions |
| `warn`  | Thinking field stripped |
| `info`  | HTTP request in/out (method, path, status, latency) — **default** |
| `debug` | Full Anthropic/Ollama request and response bodies; per-SSE-chunk data |

```bash
# Production — only errors
claude-code-ollama-proxy --log-level error

# Development — full bodies
claude-code-ollama-proxy --log-level debug
# equivalent to:
claude-code-ollama-proxy --verbose

# Via environment variable
LOG_LEVEL=debug claude-code-ollama-proxy
```

All log records are emitted as **OTEL-compatible NDJSON** to stdout.
See [LOGGING.md](LOGGING.md) for the full logging reference, including
OpenTelemetry Collector integration.

Can also be set in the config file:

```json
{ "logLevel": "debug" }
```

---

### `-V, --version`

Print the current version and exit.

### `-h, --help`

Print the help message and exit.

---

## Config File (`proxy.config.json`)

Running `--init` creates a `proxy.config.json` with all settings documented:

```json
{
  "version": "1",
  "port": 3000,
  "ollamaUrl": "http://localhost:11434",
  "defaultModel": "qwen3:8b",
  "modelMap": {
    "claude-opus-4-5":  "qwen3:32b",
    "claude-sonnet-4-5": "qwen3:8b",
    "claude-haiku-4-5":  "qwen3:1.7b"
  },
  "strictThinking": false,
  "logLevel": "info"
}
```

The proxy auto-discovers `proxy.config.json` in the current working directory.
AI agents can read and modify this file to change proxy behaviour without
restarting (restart required for the changes to take effect).

### Precedence (lowest → highest)

```
proxy.config.json  <  environment variables  <  CLI flags
```

---

## Environment Variables Summary

| Variable | Corresponding Flag | Description |
|---|---|---|
| `PORT` | `--port` | Listen port |
| `OLLAMA_URL` | `--ollama-url` | Ollama base URL |
| `DEFAULT_MODEL` | `--default-model` | Fallback model name |
| `LOG_LEVEL` | `--log-level` | Log level (error/warn/info/debug) |

**Claude Code env vars (set on the Claude Code side, not the proxy):**

| Variable | Effect |
|---|---|
| `ANTHROPIC_MODEL` | Model name Claude Code sends in all requests |
| `ANTHROPIC_SMALL_FAST_MODEL` | Model name for Claude Code's background/fast tasks |
| `ANTHROPIC_BASE_URL` | Point Claude Code at the proxy |
| `ANTHROPIC_API_KEY` | Any non-empty value works (proxy ignores it) |

---

## AI-Agent-First Setup (Recommended)

```bash
# Step 1: start the proxy with your Ollama model as default
claude-code-ollama-proxy --default-model qwen3:8b

# Step 2: launch Claude Code — set ANTHROPIC_MODEL to your Ollama model
ANTHROPIC_API_KEY=any-value \
ANTHROPIC_MODEL=qwen3:8b \
ANTHROPIC_BASE_URL=http://localhost:3000 \
claude
```

When `ANTHROPIC_MODEL` is set to an Ollama model name (one that does **not**
start with `claude`), the proxy passes it through directly — no model map
needed.

For thinking models:

```bash
# Pull a thinking-capable model first
ollama pull qwen3:8b

claude-code-ollama-proxy --default-model qwen3:8b

ANTHROPIC_API_KEY=any-value \
ANTHROPIC_MODEL=qwen3:8b \
ANTHROPIC_BASE_URL=http://localhost:3000 \
claude
```

---

## Persistent Configuration (Config File)

```bash
# Generate config file in current directory
claude-code-ollama-proxy --init

# Edit it
$EDITOR proxy.config.json

# Start — config file is auto-discovered
claude-code-ollama-proxy
```

AI agents working in this repository can also write to `proxy.config.json`
to reconfigure the proxy without CLI access.
