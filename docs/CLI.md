# CLI Reference

## Synopsis

```
claude-code-ollama-proxy [options]
```

## Options

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

# Custom port
claude-code-ollama-proxy --ollama-url http://localhost:9999
```

---

### `-m, --model-map <mapping>`

**Repeatable**  
**Default:** See [Default Model Map in README](../README.md#default-model-map)

Map a Claude model name to an Ollama model name. Two formats are supported:

**`key=value` format (repeatable):**

```bash
claude-code-ollama-proxy \
  -m claude-3-5-sonnet-20241022=mistral:latest \
  -m claude-3-haiku-20240307=llama3.2:3b
```

**JSON format:**

```bash
claude-code-ollama-proxy \
  --model-map '{"claude-3-5-sonnet-20241022":"mistral:latest"}'
```

The default map is always the starting point; your mappings override individual
entries without removing the others.

---

### `-d, --default-model <model>`

**Default:** `llama3.1`  
**Environment:** `DEFAULT_MODEL`

The Ollama model to use when the requested Claude model is not found in the
model map. This is useful as a catch-all for new Claude model names.

```bash
claude-code-ollama-proxy --default-model codellama:13b
```

---

### `-v, --verbose`

**Default:** `false`

Enable detailed request and response logging. Prints the translated Anthropic
request, the Ollama request, and each Ollama streaming chunk to stdout.

```bash
claude-code-ollama-proxy --verbose
```

---

### `-V, --version`

Print the current version and exit.

### `-h, --help`

Print the help message and exit.

---

## Environment Variables Summary

| Variable | Corresponding Flag | Description |
|---|---|---|
| `PORT` | `--port` | Listen port |
| `OLLAMA_URL` | `--ollama-url` | Ollama base URL |
| `DEFAULT_MODEL` | `--default-model` | Fallback model name |

---

## Examples

### Minimal – use all defaults

```bash
claude-code-ollama-proxy
```

### Custom port and Ollama URL

```bash
claude-code-ollama-proxy --port 4000 --ollama-url http://ollama-host:11434
```

### Map Claude to a custom Ollama model

```bash
claude-code-ollama-proxy \
  -m claude-3-5-sonnet-20241022=phi4:latest \
  --default-model phi4:latest
```

### Use with Claude Code

```bash
# Terminal 1 – start proxy
claude-code-ollama-proxy --port 3000

# Terminal 2 – run Claude Code
ANTHROPIC_API_KEY=any-value \
ANTHROPIC_BASE_URL=http://localhost:3000 \
claude
```

### Docker Compose integration

See [DEPLOYMENT.md](DEPLOYMENT.md) for a full Docker Compose example.
