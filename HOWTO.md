# HOWTO

Step-by-step instructions for running, configuring, and tuning logging for the proxy.

---

## 1. Start the proxy

### Inside the devcontainer (recommended)

Ollama runs on the **host machine**. The devcontainer reaches it via `host.docker.internal:11434`
(wired up by `--add-host` in `.devcontainer/devcontainer.json`).

Two terminals are needed — one for the proxy, one for Claude Code.

**Terminal 1 — build and start the proxy:**

```bash
make start
```

Overridable variables (pass on the command line):

| Variable | Default | Description |
|---|---|---|
| `DEFAULT_MODEL` | `qwen3:8b` | Ollama model to use |
| `PORT` | `3000` | Proxy listen port |
| `OLLAMA_URL` | `http://host.docker.internal:11434` | Ollama endpoint |
| `LOG_FILE` | `proxy.log` | Log file path (`LOG_FILE=` to disable) |

```bash
make start DEFAULT_MODEL=llama3.2 PORT=3456
```

**Terminal 2 — launch Claude Code pointed at the proxy:**

```bash
make claude
```

`make claude` sets `ANTHROPIC_BASE_URL`, `ANTHROPIC_MODEL`, and `ANTHROPIC_SMALL_FAST_MODEL`
automatically. Authentication is handled by `.claude/settings.json` (`apiKeyHelper`) — no
Anthropic account or API key is required.

```bash
make claude DEFAULT_MODEL=llama3.2 PORT=3456
```

Other useful targets:

```bash
make help    # list all targets and current variable values
make dev     # hot-reload mode via tsx (no build step needed)
make test    # run all Vitest tests
make clean   # remove dist/ and node_modules/
```

---

### Directly on the host

Ollama and the proxy both run on the same machine — use `localhost` instead of
`host.docker.internal`.

**Step 1 — build:**

```bash
npm install
npm run build
```

**Step 2 — start the proxy:**

```bash
node dist/cli.js \
  --port 3000 \
  --ollama-url http://localhost:11434 \
  --default-model qwen3:8b
```

**Step 3 — launch Claude Code:**

```bash
ANTHROPIC_BASE_URL=http://localhost:3000 \
ANTHROPIC_MODEL=qwen3:8b \
ANTHROPIC_SMALL_FAST_MODEL=qwen3:8b \
ANTHROPIC_API_KEY=proxy-key \
claude
```

> If `.claude/settings.json` is present (repo checked out on the host), `apiKeyHelper`
> provides the key automatically and `ANTHROPIC_API_KEY` can be omitted.

---

## 2. Write a config file

For persistent settings that survive restarts without repeating CLI flags.

**Generate a default `proxy.config.json`:**

```bash
node dist/cli.js --init
# or via make:
make build && node dist/cli.js --init
```

**Edit it:**

```json
{
  "port": 3000,
  "ollamaUrl": "http://host.docker.internal:11434",
  "defaultModel": "qwen3:8b",
  "modelMap": {
    "claude-opus-4-5":   "qwen3:32b",
    "claude-sonnet-4-5": "qwen3:8b",
    "claude-haiku-4-5":  "qwen3:1.7b"
  },
  "strictThinking": false,
  "logLevel": "info",
  "logFile": "proxy.log"
}
```

The proxy auto-discovers `proxy.config.json` in the current working directory on startup.
Pass `--config <path>` to point at a different file.

**Config precedence** (later overrides earlier):

```
proxy.config.json  <  environment variables  <  CLI flags
```

All available fields:

| Field | CLI flag | Env var | Default | Description |
|---|---|---|---|---|
| `port` | `--port, -p` | `PORT` | `3000` | Listen port |
| `ollamaUrl` | `--ollama-url, -u` | `OLLAMA_URL` | `http://localhost:11434` | Ollama endpoint |
| `defaultModel` | `--default-model, -d` | `DEFAULT_MODEL` | `llama3.1` | Fallback model |
| `modelMap` | `--model-map, -m` | — | `{}` | Claude → Ollama name overrides |
| `strictThinking` | `--strict-thinking` | — | `false` | Return 400 for thinking on non-capable models |
| `logLevel` | `--log-level` | `LOG_LEVEL` | `info` | `error` \| `warn` \| `info` \| `debug` |
| `logFile` | `--log-file` | `LOG_FILE` | _(none)_ | Log file path (truncated each start) |
| `verbose` | `--verbose, -v` | — | `false` | Shorthand for `logLevel: debug` |

**Model mapping** — the default map is empty; every Claude model name falls through to
`defaultModel`. The simplest setup is to set `ANTHROPIC_MODEL=<ollama-model>` in Claude Code
(via `make claude`). The proxy passes non-Claude model names directly to Ollama without
consulting the map.

---

## 3. Configure logging

### Log level

Controls how much is written. Only records at or above the configured level are emitted.

| Level | What is logged |
|---|---|
| `error` | Errors only (minimum for production) |
| `warn` | Errors + warnings (e.g. thinking stripped) |
| `info` | + HTTP request/response metadata — **default** |
| `debug` | + full request/response bodies, per-chunk SSE events |

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

By default the proxy writes to stdout only. Pass `--log-file <path>` (or set `LOG_FILE`) to
also write to a file. The file is **truncated on every proxy start** so it always contains only
the current session.

```bash
# Makefile default: proxy.log in the project root
make start                        # writes to stdout + proxy.log

# Custom path
make start LOG_FILE=/tmp/proxy.log

# Disable file logging
make start LOG_FILE=
```

### Reading logs

Logs are OTEL-compatible NDJSON — one JSON object per line.

```bash
# Follow the log file and pretty-print
tail -f proxy.log | jq -r '"[\(.SeverityText)] \(.Body)"'

# Show only errors
tail -f proxy.log | jq 'select(.SeverityText == "ERROR")'

# Show request/response pairs
tail -f proxy.log | jq 'select(.Attributes["http.target"] != null)'
```

For otelcol integration see [docs/LOGGING.md](docs/LOGGING.md).
