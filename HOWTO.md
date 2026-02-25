# HOWTO

How to set up, configure, and run the claude-code-ollama-proxy.

---

## 1. Quick Start

### Inside the devcontainer (recommended)

**Prerequisites:**
- [VS Code](https://code.visualstudio.com/) with the [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)
- [Ollama](https://ollama.com) installed and running on your **host machine**
- A model pulled into Ollama (e.g. `ollama pull qwen3:8b`)

**Steps:**

1. **Start Ollama on the host** (see [§4 Tune Ollama](#4-tune-ollama) for recommended settings):
   ```bash
   ollama serve   # Linux
   open -a Ollama # macOS
   ```

2. **Pull a model** on the host:
   ```bash
   ollama pull qwen3:8b
   ```

3. **Open the repo in VS Code** and choose _"Reopen in Container"_ when prompted (or use the Command Palette: `Dev Containers: Reopen in Container`). The devcontainer builds once and then starts.

4. **Start the proxy and Claude Code** inside the devcontainer:
   ```bash
   make run
   ```
   This starts the proxy in the background (non-blocking) and then launches Claude Code. The proxy listens on `http://localhost:3000` and connects to Ollama via `host.docker.internal:11434`. Authentication is handled automatically via `.claude/settings.json` — no Anthropic account or API key needed.

   Alternatively, start them separately:
   ```bash
   make start    # proxy starts in background, terminal returns immediately
   make claude   # launch Claude Code in the same terminal
   ```

   To stop a backgrounded proxy:
   ```bash
   make stop
   ```

To use a different model or port:
```bash
make run DEFAULT_MODEL=deepseek-r1:8b PORT=3456
```

Other useful targets:
```bash
make help      # list all targets with current variable values
make start-fg  # start proxy in foreground (blocking, logs to stdout)
make dev       # hot-reload mode via tsx (no build step needed)
make test      # run all Vitest tests
make clean     # remove dist/ and node_modules/
```

---

### On the host (no devcontainer)

Ollama and the proxy run on the same machine — use `localhost` everywhere.

1. **Install dependencies and build:**
   ```bash
   npm install
   npm run build
   ```

2. **Start the proxy:**
   ```bash
   node dist/cli.js \
     --port 3000 \
     --ollama-url http://localhost:11434 \
     --default-model qwen3:8b
   ```

3. **Launch Claude Code** in a second terminal:
   ```bash
   ANTHROPIC_BASE_URL=http://localhost:3000 \
   ANTHROPIC_MODEL=qwen3:8b \
   ANTHROPIC_SMALL_FAST_MODEL=qwen3:8b \
   ANTHROPIC_API_KEY=proxy-key \
   claude
   ```
   > If `.claude/settings.json` is present in the repo, `apiKeyHelper` provides the key automatically and `ANTHROPIC_API_KEY` can be omitted.

---

## 2. Configure Claude Code

Claude Code reads three environment variables to find the proxy:

| Variable | Value | Description |
|---|---|---|
| `ANTHROPIC_BASE_URL` | `http://localhost:3000` | Points Claude Code at the proxy instead of Anthropic's cloud |
| `ANTHROPIC_MODEL` | `qwen3:8b` (or any Ollama model name) | The model Claude Code requests for large tasks |
| `ANTHROPIC_SMALL_FAST_MODEL` | `qwen3:8b` (or any Ollama model name) | The model used for background/small tasks |
| `ANTHROPIC_API_KEY` | `proxy-key` (any non-empty string) | Satisfies Claude Code's key requirement — the proxy ignores it |

`make claude` sets all of these automatically using `DEFAULT_MODEL` and `PORT`.

**Setting ANTHROPIC_MODEL directly** is the recommended AI-agent-first approach: the proxy passes any non-Claude model name straight through to Ollama without consulting `modelMap`. No mapping configuration is needed.

---

## 3. Proxy Configuration

### Config file

For persistent settings that survive restarts without repeating CLI flags.

**Generate a default `proxy.config.json`:**
```bash
make build && node dist/cli.js --init
```

**Example `proxy.config.json`:**
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

The proxy auto-discovers `proxy.config.json` in the current working directory. Pass `--config <path>` to load a different file.

**Config precedence** (later overrides earlier):
```
proxy.config.json  <  environment variables  <  CLI flags
```

### All options

| Field | CLI flag | Env var | Default | Description |
|---|---|---|---|---|
| `port` | `--port, -p` | `PORT` | `3000` | Listen port |
| `ollamaUrl` | `--ollama-url, -u` | `OLLAMA_URL` | `http://localhost:11434` | Ollama endpoint |
| `defaultModel` | `--default-model, -d` | `DEFAULT_MODEL` | `llama3.1` | Fallback Ollama model |
| `modelMap` | `--model-map, -m` | — | `{}` | Claude tier name → Ollama model overrides |
| `strictThinking` | `--strict-thinking` | — | `false` | Return HTTP 400 for thinking on non-capable models (default: silently strip) |
| `logLevel` | `--log-level` | `LOG_LEVEL` | `info` | `error` \| `warn` \| `info` \| `debug` |
| `logFile` | `--log-file` | `LOG_FILE` | _(none)_ | Log file path (truncated on each start) |
| `verbose` | `--verbose, -v` | — | `false` | Shorthand for `--log-level debug` |
| — | `--background, -b` | — | `false` | Start as background daemon (requires `--log-file`) |
| — | `--stop` | — | — | Stop a backgrounded proxy (reads `proxy.pid`) |
| — | `--quiet, -q` | — | `false` | Suppress stdout logs (implied by `--background`) |

### Model mapping

The default `modelMap` is empty — every Claude model name falls through to `defaultModel`.

Use `modelMap` only if you need different Ollama models per Claude tier:
```json
"modelMap": {
  "claude-opus-4-5":   "qwen3:32b",
  "claude-sonnet-4-5": "qwen3:8b",
  "claude-haiku-4-5":  "qwen3:1.7b"
}
```

Or pass it as a CLI flag:
```bash
node dist/cli.js --model-map claude-sonnet-4-5=qwen3:8b --model-map claude-haiku-4-5=qwen3:1.7b
```

### Extended thinking

The proxy recognises these Ollama model prefixes as thinking-capable:
`qwen3`, `deepseek-r1`, `magistral`, `nemotron`, `glm4`, `qwq`

For all other models, thinking requests from Claude Code are **silently stripped** by default — the session continues without extended thinking. This prevents Claude Code (which auto-generates thinking requests) from breaking on non-thinking models.

Set `--strict-thinking` (or `"strictThinking": true` in the config file) to get HTTP 400 instead, which is useful during development to catch model mis-configuration early.

---

## 4. Tune Ollama

Ollama's default settings are conservative. For coding workloads with Claude Code, these environment variables improve throughput and quality:

| Variable | Recommended | Description |
|---|---|---|
| `OLLAMA_CONTEXT_LENGTH` | `32768` or `65536` | Context window per request. Claude Code needs at least 32 k tokens for large files. |
| `OLLAMA_NUM_PARALLEL` | `2` | Concurrent request slots. `2` covers the proxy + Claude Code's background tasks. |
| `OLLAMA_MAX_QUEUE` | `64` | Queue depth before Ollama rejects new requests. |
| `OLLAMA_KV_CACHE_TYPE` | `q8_0` | Quantised KV cache — saves VRAM with minimal quality loss. |
| `OLLAMA_FLASH_ATTENTION` | `1` | Enable Flash Attention where supported (faster, lower VRAM). |
| `OLLAMA_KEEP_ALIVE` | `5m` | Keep the model loaded for 5 minutes after the last request. |

**Quick setup — copy the start script to your PATH and make it executable:**
```bash
cp scripts/ollama-start ~/bin/ollama-start
chmod +x ~/bin/ollama-start
ollama-start          # sets the vars above and launches Ollama
```

The script uses `open -a Ollama` on macOS. On Linux, replace that line with `ollama serve &`.

---

## 5. Logging

### Log level

Controls how much is written. Only records at or above the configured level are emitted.

| Level | What is logged |
|---|---|
| `error` | Errors only — recommended for production |
| `warn` | Errors + warnings (e.g. thinking stripped for a non-capable model) |
| `info` | + HTTP request/response summary (method, path, status, latency) — **default** |
| `debug` | + full request/response bodies and per-chunk SSE events |

```bash
# via CLI flag
node dist/cli.js --log-level debug

# via Makefile variable
make start LOG_LEVEL=debug

# via environment variable
LOG_LEVEL=warn make start

# via config file
{ "logLevel": "debug" }
```

### Log file

By default the proxy writes to **stdout only**. Pass `--log-file <path>` (or set `LOG_FILE`) to also write to a file. The file is **truncated on every proxy start** so it always contains only the current session.

```bash
make start                        # background + proxy.log (Makefile default)
make start LOG_FILE=/tmp/p.log    # custom path
make start-fg LOG_FILE=           # foreground, stdout only (disable file logging)
```

### Background mode

`make start` (or `--background`) starts the proxy as a detached daemon. The parent process exits immediately, freeing the terminal for `make claude` or other work. A `proxy.pid` file is written to the working directory.

```bash
make start          # background, logs to proxy.log
make stop           # sends SIGTERM, cleans up proxy.pid
make run            # start + claude in one command
```

Use `make start-fg` (or omit `--background`) for the traditional blocking foreground mode.

### Reading logs

Logs are OTEL-compatible NDJSON — one JSON object per line.

```bash
# Follow and pretty-print
tail -f proxy.log | jq -r '"[\(.SeverityText)] \(.Body)"'

# Show only errors
tail -f proxy.log | jq 'select(.SeverityText == "ERROR")'

# Show HTTP request/response pairs
tail -f proxy.log | jq 'select(.Attributes["http.target"] != null)'

# Show thinking-stripped warnings
tail -f proxy.log | jq 'select(.SeverityText == "WARN")'
```

For full otelcol integration (pipeline to Loki, Jaeger, etc.) see [docs/LOGGING.md](docs/LOGGING.md).

