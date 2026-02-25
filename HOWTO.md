# HOWTO — Developer Guide

---

## Table of Contents

1. [Command Reference](#1-command-reference) -- every command in one place
2. [Quick Start](#2-quick-start) -- get running in 60 seconds
3. [Proxy Configuration](#3-proxy-configuration) -- options, config file, precedence
4. [Logging](#4-logging) -- levels, file output, background mode, log inspection
5. [Model Mapping and Thinking](#5-model-mapping-and-thinking) -- multi-model routing, extended thinking
6. [Background and Daemon Mode](#6-background-and-daemon-mode) -- non-blocking startup, PID file, stopping
7. [Claude Code Setup](#7-claude-code-setup) -- environment variables for the client side
8. [Ollama Tuning](#8-ollama-tuning) -- host-side settings for coding workloads

---

## 1. Command Reference

Every command you need, in one place.

### Make targets

```bash
# ── Build & test ──
make install              # npm install + npm rebuild esbuild
make build                # compile TypeScript → dist/
make test                 # run all Vitest suites
make clean                # remove dist/ and node_modules/

# ── Run the proxy ──
make start                # build + start proxy in background (non-blocking)
make start-fg             # build + start proxy in foreground (blocking)
make stop                 # stop a backgrounded proxy (reads proxy.pid)

# ── Run proxy + Claude Code ──
make run                  # start proxy (background) + launch Claude Code
make claude               # launch Claude Code (proxy must already be running)

# ── Development ──
make dev                  # hot-reload via tsx (no build step)
make help                 # list all targets with current variable values
```

### Make variable overrides

```bash
make start DEFAULT_MODEL=deepseek-r1:8b    # different model
make start PORT=3456                        # different port
make start LOG_LEVEL=debug                  # debug logging
make start LOG_FILE=/tmp/p.log              # custom log file path
make start-fg LOG_FILE=                     # foreground, stdout only, no file
make run DEFAULT_MODEL=deepseek-r1:8b PORT=3456
```

### Direct CLI (after `make build`)

```bash
node dist/cli.js --default-model qwen3:8b                                      # foreground
node dist/cli.js --default-model qwen3:8b --background --log-file proxy.log    # daemon
node dist/cli.js --default-model qwen3:8b --log-level debug                    # debug logging
node dist/cli.js --stop                                                         # stop daemon
node dist/cli.js --init                                                         # generate config file
node dist/cli.js --port 3456 --ollama-url http://192.168.1.100:11434           # custom port/URL
```

### Log inspection

```bash
tail -f proxy.log | jq -r '"[\(.SeverityText)] \(.Body)"'               # follow + pretty-print
tail -f proxy.log | jq 'select(.SeverityText == "ERROR")'               # errors only
tail -f proxy.log | jq 'select(.SeverityText == "WARN")'                # warnings (healed tools, stripped thinking)
tail -f proxy.log | jq 'select(.Attributes["http.target"] != null)'     # HTTP request/response pairs
```

---

## 2. Quick Start

### Devcontainer (recommended)

**Prerequisites:** VS Code + [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers), Ollama running on the host, a model pulled (`ollama pull qwen3:8b`).

1. Open the repo in VS Code, choose _"Reopen in Container"_.
2. In the devcontainer terminal:
   ```bash
   make run
   ```
   This builds the proxy, starts it in the background, and launches Claude Code. The proxy connects to Ollama via `host.docker.internal:11434`. Authentication is handled via `.claude/settings.json`.

### Host (no devcontainer)

1. `npm install && npm run build`
2. `node dist/cli.js --default-model qwen3:8b`
3. In a second terminal:
   ```bash
   ANTHROPIC_BASE_URL=http://localhost:3000 ANTHROPIC_MODEL=qwen3:8b ANTHROPIC_API_KEY=proxy-key claude
   ```

---

## 3. Proxy Configuration

### Config file

Persistent settings that survive restarts without repeating CLI flags.

```bash
node dist/cli.js --init    # generates proxy.config.json
```

**Example:**
```json
{
  "version": "1",
  "port": 3000,
  "ollamaUrl": "http://host.docker.internal:11434",
  "defaultModel": "qwen3:8b",
  "modelMap": {},
  "strictThinking": false,
  "logLevel": "info",
  "logFile": "proxy.log"
}
```

The proxy auto-discovers `proxy.config.json` in the working directory. Use `--config <path>` for a different file.

### Precedence

```
proxy.config.json  <  environment variables  <  CLI flags
```

### All options

| Field | CLI flag | Env var | Default | Description |
|---|---|---|---|---|
| `port` | `--port, -p` | `PORT` | `3000` | Listen port |
| `ollamaUrl` | `--ollama-url, -u` | `OLLAMA_URL` | `http://localhost:11434` | Ollama endpoint |
| `defaultModel` | `--default-model, -d` | `DEFAULT_MODEL` | `llama3.1` | Fallback Ollama model |
| `modelMap` | `--model-map, -m` | -- | `{}` | Claude tier name -> Ollama model overrides |
| `strictThinking` | `--strict-thinking` | -- | `false` | HTTP 400 for thinking on non-capable models |
| `logLevel` | `--log-level` | `LOG_LEVEL` | `info` | `error` \| `warn` \| `info` \| `debug` |
| `logFile` | `--log-file` | `LOG_FILE` | _(none)_ | Log file path (truncated on each start) |
| `verbose` | `--verbose, -v` | -- | `false` | Shorthand for `--log-level debug` |
| -- | `--background, -b` | -- | `false` | Start as background daemon (requires `--log-file`) |
| -- | `--stop` | -- | -- | Stop a backgrounded proxy (reads `proxy.pid`) |
| -- | `--quiet, -q` | -- | `false` | Suppress stdout logs (implied by `--background`) |

---

## 4. Logging

### Log levels

| Level | What is logged |
|---|---|
| `error` | Errors only |
| `warn` | + warnings (thinking stripped, tool parameters healed) |
| `info` | + HTTP request/response summary (method, path, status, latency) -- **default** |
| `debug` | + full request/response bodies and per-chunk SSE events |

### Log file

By default the proxy writes to **stdout only**. Pass `--log-file <path>` (or set `LOG_FILE`) to also write to a file. The file is **truncated on every proxy start** so it always contains only the current session.

### OTEL integration

Logs are OTEL-compatible NDJSON -- one JSON object per line. See [docs/LOGGING.md](docs/LOGGING.md) for otelcol pipeline integration (Loki, Jaeger, etc.).

---

## 5. Model Mapping and Thinking

### Model mapping

The default `modelMap` is empty -- every Claude model name falls through to `defaultModel`.

Use `modelMap` only if you need different Ollama models per Claude tier:

```json
"modelMap": {
  "claude-opus-4-5":   "qwen3:32b",
  "claude-sonnet-4-5": "qwen3:8b",
  "claude-haiku-4-5":  "qwen3:1.7b"
}
```

### Extended thinking

Thinking-capable Ollama model prefixes: `qwen3`, `deepseek-r1`, `magistral`, `nemotron`, `glm4`, `qwq`

For all other models, thinking requests from Claude Code are **silently stripped** -- the session continues without extended thinking. Set `--strict-thinking` to get HTTP 400 instead (useful during development to catch mis-configuration).

---

## 6. Background and Daemon Mode

`make start` (or `--background`) starts the proxy as a detached daemon. The parent process exits immediately, freeing the terminal. Stdout is suppressed; logs go to the file only. A `proxy.pid` file is written to the working directory.

- `make stop` (or `--stop`) sends SIGTERM and cleans up the PID file.
- `make run` combines `make start` + `make claude` in one command.
- `make start-fg` runs in the traditional blocking foreground mode with stdout output.

---

## 7. Claude Code Setup

These environment variables tell Claude Code to use the proxy instead of Anthropic's cloud. `make claude` sets them automatically.

| Variable | Value | Description |
|---|---|---|
| `ANTHROPIC_BASE_URL` | `http://localhost:3000` | Points Claude Code at the proxy |
| `ANTHROPIC_MODEL` | `qwen3:8b` (or any Ollama model) | Model for large tasks |
| `ANTHROPIC_SMALL_FAST_MODEL` | `qwen3:8b` (or any Ollama model) | Model for background/small tasks |
| `ANTHROPIC_API_KEY` | `proxy-key` (any non-empty string) | Satisfies Claude Code's key check -- proxy ignores it |

**Tip:** Setting `ANTHROPIC_MODEL` to an Ollama model name directly is the recommended approach. The proxy passes any non-Claude model name straight through to Ollama without consulting `modelMap`.

> If `.claude/settings.json` is present in the repo, `apiKeyHelper` provides the key automatically and `ANTHROPIC_API_KEY` can be omitted.

---

## 8. Ollama Tuning

Ollama's default settings are conservative. For coding workloads with Claude Code, these host-side environment variables improve throughput and quality:

| Variable | Recommended | Description |
|---|---|---|
| `OLLAMA_CONTEXT_LENGTH` | `32768` or `65536` | Context window. Claude Code needs at least 32k for large files. |
| `OLLAMA_NUM_PARALLEL` | `2` | Concurrent request slots. |
| `OLLAMA_MAX_QUEUE` | `64` | Queue depth before rejecting requests. |
| `OLLAMA_KV_CACHE_TYPE` | `q8_0` | Quantised KV cache -- saves VRAM, minimal quality loss. |
| `OLLAMA_FLASH_ATTENTION` | `1` | Enable Flash Attention (faster, lower VRAM). |
| `OLLAMA_KEEP_ALIVE` | `5m` | Keep model loaded for 5 min after last request. |

The bundled `scripts/ollama-start` sets all of these and launches Ollama. Copy it to your PATH on the host:

```bash
cp scripts/ollama-start ~/bin/ollama-start && chmod +x ~/bin/ollama-start
ollama-start
```

The script uses `open -a Ollama` (macOS). On Linux replace that line with `ollama serve &`.
