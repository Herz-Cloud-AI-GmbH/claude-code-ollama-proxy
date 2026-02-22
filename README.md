# claude-code-ollama-proxy

Run **Claude Code with local Ollama models** — no Anthropic account, no API key, no cloud costs.

The proxy sits between Claude Code and Ollama, translating the [Anthropic Messages API](https://docs.anthropic.com/en/api/messages) into [Ollama's chat API](https://ollama.com/) transparently. Claude Code never knows it is talking to a local model.

```
Claude Code ──(Anthropic API)──► claude-code-ollama-proxy ──(Ollama API)──► Ollama ──► qwen3:8b
```

## What you get

- **Zero cloud dependency** — all inference runs locally via Ollama; no Anthropic key needed
- **Devcontainer-ready** — one `make start` / `make claude` gets you running inside a VS Code devcontainer
- **Full Claude Code compatibility** — streaming SSE, tool calls (with JSON healing), extended thinking, token counting
- **Supply-chain hardened** — `ignore-scripts=true` in `.npmrc`; `npm rebuild esbuild` is the only explicit postinstall exception
- **Structured logging** — OTEL-compatible NDJSON to stdout and optional log file; configurable level; integrates with otelcol
- **Minimal and auditable** — ~500 lines of TypeScript across focused modules; no framework magic

## Alternatives and how they compare

| | **this proxy** | [**ollama launch**](https://ollama.com/blog/launch) | [**claude-code-router**](https://github.com/musistudio/claude-code-router) |
|---|---|---|---|
| Setup | `make start` in devcontainer | `ollama launch claude` on host | `npm install -g` + config file |
| Provider support | Ollama only | Ollama + cloud models | Ollama, OpenRouter, DeepSeek, Gemini, Vertex, and more |
| Config complexity | Low — one flag or `proxy.config.json` | Zero — interactive model picker | High — JSON config with providers, transformers, routing rules |
| Multi-model routing | No | No | Yes — route by task type (background, think, longContext, webSearch) |
| Extended thinking | Yes | Depends on model | Yes (via transformers) |
| Devcontainer support | First-class (`make` targets, `host.docker.internal`) | No | No |
| Logging | OTEL-format NDJSON to stdout + file | None | pino to file |
| Supply-chain hardening | Yes (`ignore-scripts`) | n/a (built into Ollama) | No |
| Source | Run from source in repo | Built into Ollama binary | Published to npm |

**Choose this proxy if** you work primarily in a devcontainer, want an auditable single-purpose tool, and only need Ollama as a backend.

**Choose `ollama launch`** if you want the fastest possible zero-config setup on a host machine — it is now built into Ollama v0.15+ and requires no separate installation.

**Choose claude-code-router** if you need to route different Claude Code tasks to different providers or models (e.g. a cheap local model for background tasks, a powerful cloud model for complex reasoning).

---

## How it works

The proxy listens on a local port, accepts Anthropic-format requests, translates them to Ollama's chat API, and returns Anthropic-format responses.

Key translation features:

- Full `/v1/messages` endpoint — streaming (SSE) and non-streaming
- `/v1/messages/count_tokens` served locally, no Ollama call needed
- Automatic Claude → Ollama model name mapping (configurable)
- Extended thinking support (`think: true`) for capable models — capable prefixes: `qwen3`, `deepseek-r1`, `magistral`, `nemotron`, `glm4`, `qwq`
- Full tool call translation in both directions, with automatic JSON healing
- OTEL-compatible NDJSON structured logging

## Development

```bash
make install   # npm install + npm rebuild esbuild (supply-chain hardened)
make build     # compile TypeScript → dist/
make test      # run all Vitest suites
make dev       # hot-reload via tsx (no build step)
```

## Documentation

| File | Contents |
|---|---|
| [HOWTO.md](HOWTO.md) | How to run, configure, and tune logging |
| [AGENTS.md](AGENTS.md) | AI agent onboarding — context map, commands, conventions |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Request flow, module responsibilities |
| [docs/API.md](docs/API.md) | Endpoint reference |
| [docs/CLI.md](docs/CLI.md) | Full CLI flag reference |
| [docs/STREAMING.md](docs/STREAMING.md) | SSE streaming state machine |
| [docs/LOGGING.md](docs/LOGGING.md) | Logging reference and otelcol integration |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Docker, systemd, Nginx guides |

## License

MIT — © 2026 Herz Cloud & AI GmbH
