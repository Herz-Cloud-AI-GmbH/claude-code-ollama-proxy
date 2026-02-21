# claude-code-ollama-proxy

A lightweight CLI proxy server that lets **Claude Code** — and any
[Anthropic Messages API](https://docs.anthropic.com/en/api/messages) compatible
client — use locally-running models served by [Ollama](https://ollama.com/).

```
Claude Code ──(Anthropic API)──► claude-code-ollama-proxy ──(Ollama API)──► Ollama ──► llama3.1
```

## Features

- 🔌 **Drop-in proxy** — serve the full Anthropic `/v1/messages` endpoint
- 🌊 **Streaming support** — full SSE event sequence including token counts
- 🔢 **Token counting** — accurate `input_tokens` / `output_tokens` in every response
- 🗺️ **Model mapping** — automatic Claude → Ollama model name translation
- ⚙️ **Configurable** — CLI flags + environment variables
- 📦 **Zero Anthropic key required** — use any placeholder key

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) ≥ 18
- [Ollama](https://ollama.com/) running locally with at least one model pulled

```bash
# Pull a model in Ollama (example)
ollama pull llama3.1
```

### Run with npx (no installation)

```bash
npx claude-code-ollama-proxy
```

### Install globally

```bash
npm install -g claude-code-ollama-proxy
claude-code-ollama-proxy
```

### Use with Claude Code

```bash
ANTHROPIC_API_KEY=any-placeholder-value \
ANTHROPIC_BASE_URL=http://localhost:3000 \
claude
```

That's it — Claude Code will now route all requests through Ollama.

## Configuration

| CLI Flag | Environment Variable | Default | Description |
|---|---|---|---|
| `--port, -p` | `PORT` | `3000` | Port to listen on |
| `--ollama-url, -u` | `OLLAMA_URL` | `http://localhost:11434` | Ollama base URL |
| `--model-map, -m` | — | See below | Claude→Ollama model mapping |
| `--default-model, -d` | `DEFAULT_MODEL` | `llama3.1` | Fallback model |
| `--verbose, -v` | — | `false` | Enable debug logging |

### Default Model Map

| Claude Model | Ollama Model |
|---|---|
| `claude-opus-4-5` | `llama3.1:70b` |
| `claude-sonnet-4-5` | `llama3.1:8b` |
| `claude-haiku-4-5` | `llama3.2:3b` |
| `claude-3-5-sonnet-20241022` | `llama3.1:8b` |
| `claude-3-5-haiku-20241022` | `llama3.2:3b` |
| `claude-3-opus-20240229` | `llama3.1:70b` |
| `claude-3-sonnet-20240229` | `llama3.1:8b` |
| `claude-3-haiku-20240307` | `llama3.2:3b` |

Override with `-m claude-3-5-sonnet-20241022=mistral:latest` or pass a JSON map.

## Documentation

- [CLI Reference](docs/CLI.md)
- [API Endpoints](docs/API.md)
- [Streaming Architecture](docs/STREAMING.md)
- [Deployment Guide](docs/DEPLOYMENT.md)
- [Gap Assessment](docs/gap-assessment.md)
- [Tasks & Tests Breakdown](docs/tasks-and-tests.md)

## Development

```bash
# Install dependencies
npm install

# Run in development mode (with hot reload via tsx)
npm run dev

# Run tests
npm test

# Build for production
npm run build
```

## License

MIT — © 2026 Herz Cloud & AI GmbH
