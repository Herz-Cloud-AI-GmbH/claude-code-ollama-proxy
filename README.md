# claude-code-ollama-proxy

Run **Claude Code with local Ollama models** — no Anthropic account, no API key, no cloud costs.

```
Claude Code ──(Anthropic API)──► claude-code-ollama-proxy ──(Ollama API)──► Ollama ──► local LLM
```

---

### Table of Contents

1. [Getting Started](#getting-started) — run in 60 seconds
2. [Features](#features) — what the proxy does for you
3. [How It Works](#how-it-works) — translation pipeline
4. [Alternatives](#alternatives) — when to use something else
5. [Documentation](#documentation) — full reference guides
6. [License](#license)

---

## Getting Started

**Prerequisites:** [Ollama](https://ollama.com) running on the host with a model pulled (e.g. `ollama pull qwen3:8b`).

**Devcontainer (recommended):**

```bash
make run    # builds, starts proxy in background, launches Claude Code
```

**Host (no devcontainer):**

Terminal 1 — start the proxy:
```bash
npm install && npm run build
node dist/cli.js --default-model qwen3:8b
```

Terminal 2 — launch Claude Code:
```bash
ANTHROPIC_BASE_URL=http://localhost:3000 \
ANTHROPIC_MODEL=qwen3:8b \
ANTHROPIC_API_KEY=proxy-key \
claude
```

See [HOWTO.md](HOWTO.md) for the full developer guide: command reference, configuration, logging, Ollama tuning.

---

## Features

**Protocol translation**
- Full Anthropic Messages API — streaming SSE, tool calls, extended thinking, token counting
- Zero cloud dependency — all inference runs locally, no Anthropic key needed

**Model healing** — compensates for smaller models that struggle with tool schemas
- Tool call healing — auto-repairs malformed JSON, wrong parameter names, wrong types
- Parallel → sequential rewriting — prevents "sibling tool call errored" hallucinations
- Conversation history healing — strips failed tool rounds so the model doesn't give up on tools
- Extended thinking — silently stripped for non-capable models (or strict HTTP 400 mode)

**Developer experience**
- Devcontainer-ready — `make` targets, `host.docker.internal`, zero-config auth
- Background daemon mode — `make start` runs non-blocking with PID file management
- Structured logging — OTEL-compatible NDJSON to stdout and/or file

**Security and quality**
- Supply-chain hardened — `ignore-scripts=true`, only `npm rebuild esbuild` allowed
- Minimal and auditable — ~2k lines of TypeScript, 11 modules, no framework magic

---

## How It Works

The proxy translates the [Anthropic Messages API](https://docs.anthropic.com/en/api/messages) into [Ollama's chat API](https://docs.ollama.com/api) bidirectionally.

**Endpoints:**

| Route | Method | Purpose |
|---|---|---|
| `/v1/messages` | POST | Core proxy — translates and forwards (streaming + non-streaming) |
| `/v1/messages/count_tokens` | POST | Token count — served locally, no Ollama round-trip |
| `/v1/models` | GET | List Ollama models in Anthropic format |
| `/health` | GET | Health check |

**Request path:** Anthropic request → thinking validation → conversation history healing → sequential tool rewriting → Ollama request

**Response path:** Ollama response → tool call healing (JSON + parameter names + parameter types) → Anthropic response

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full data flow and module responsibilities.

---

## Alternatives

| | **this proxy** | [**ollama launch**](https://ollama.com/blog/launch) | [**claude-code-router**](https://github.com/musistudio/claude-code-router) |
|---|---|---|---|
| Setup | `make run` in devcontainer | `ollama launch claude` on host (Ollama v0.15+) | `npm install -g` + config file |
| Provider support | Ollama only | Ollama + cloud models | Ollama, OpenRouter, DeepSeek, Gemini, Vertex, more |
| Config complexity | Low — one flag or config file | Zero — interactive picker | High — JSON with providers, transformers, routing |
| Multi-model routing | Basic `modelMap` | No | Yes — by task type |
| Tool call healing | Yes — JSON, param names, param types | No | No |
| Extended thinking | Silently stripped for non-capable | Depends on model | Route to capable backend |
| Devcontainer support | First-class | No | No |
| Logging | OTEL NDJSON to stdout + file | None | pino to file |

**Choose this proxy** if you work in a devcontainer, want an auditable single-purpose tool with per-request logging, and only need Ollama.

**Choose `ollama launch`** for the fastest zero-config setup on a host with Ollama v0.15+.

**Choose claude-code-router** if you need multi-provider routing (e.g. cheap local model for background tasks, cloud model for complex reasoning).

---

## Documentation

| File | Contents |
|---|---|
| [HOWTO.md](HOWTO.md) | **Developer guide** — command reference, setup, configuration, logging |
| [AGENTS.md](AGENTS.md) | AI agent onboarding — context map, commands, conventions |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Request flow, module responsibilities |
| [docs/API.md](docs/API.md) | Endpoint reference |
| [docs/CLI.md](docs/CLI.md) | Full CLI flag reference |
| [docs/STREAMING.md](docs/STREAMING.md) | SSE streaming state machine |
| [docs/LOGGING.md](docs/LOGGING.md) | Logging reference and otelcol integration |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Docker, systemd, Nginx guides |

---

## License

MIT — © 2026 Herz Cloud & AI GmbH
