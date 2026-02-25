# Deployment Guide

## Running Locally

The simplest deployment — just run the CLI:

```bash
npx claude-code-ollama-proxy
```

Or after installing globally:

```bash
npm install -g claude-code-ollama-proxy
claude-code-ollama-proxy --port 3000
```

---

## Docker

### Dockerfile

```dockerfile
FROM node:18-alpine

WORKDIR /app

# Install globally from npm
RUN npm install -g claude-code-ollama-proxy

EXPOSE 3000

CMD ["claude-code-ollama-proxy", "--port", "3000", "--ollama-url", "http://ollama:11434"]
```

### Build and run

```bash
docker build -t claude-code-ollama-proxy .

docker run -p 3000:3000 \
  -e OLLAMA_URL=http://host.docker.internal:11434 \
  claude-code-ollama-proxy
```

---

## Docker Compose

The recommended setup for running both Ollama and the proxy together:

```yaml
# docker-compose.yml
version: "3.9"

services:
  ollama:
    image: ollama/ollama:latest
    container_name: ollama
    ports:
      - "11434:11434"
    volumes:
      - ollama_data:/root/.ollama
    # For GPU support (NVIDIA):
    # deploy:
    #   resources:
    #     reservations:
    #       devices:
    #         - driver: nvidia
    #           count: all
    #           capabilities: [gpu]

  proxy:
    image: node:18-alpine
    container_name: claude-code-ollama-proxy
    ports:
      - "3000:3000"
    environment:
      OLLAMA_URL: http://ollama:11434
      PORT: "3000"
      DEFAULT_MODEL: llama3.1
    command: >
      sh -c "npm install -g claude-code-ollama-proxy && claude-code-ollama-proxy"
    depends_on:
      - ollama

volumes:
  ollama_data:
```

```bash
# Start everything
docker compose up -d

# Pull a model in Ollama
docker exec ollama ollama pull llama3.1

# Use Claude Code
ANTHROPIC_API_KEY=any-value \
ANTHROPIC_BASE_URL=http://localhost:3000 \
claude
```

---

## systemd Service

Run the proxy as a persistent background service on Linux:

```ini
# /etc/systemd/system/claude-code-ollama-proxy.service
[Unit]
Description=Claude Code Ollama Proxy
After=network.target

[Service]
Type=simple
User=nobody
ExecStart=/usr/local/bin/claude-code-ollama-proxy --port 3000
Restart=on-failure
RestartSec=5s
Environment=OLLAMA_URL=http://localhost:11434
Environment=DEFAULT_MODEL=llama3.1

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable claude-code-ollama-proxy
sudo systemctl start claude-code-ollama-proxy
sudo systemctl status claude-code-ollama-proxy
```

---

## Reverse Proxy (Nginx)

Expose the proxy over HTTPS with Nginx:

```nginx
server {
    listen 443 ssl;
    server_name proxy.example.com;

    ssl_certificate /etc/ssl/certs/proxy.crt;
    ssl_certificate_key /etc/ssl/private/proxy.key;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        # Required for SSE streaming
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding on;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

> **Important:** The `proxy_buffering off` directive is critical for streaming.
> Without it, Nginx will buffer the entire SSE response before forwarding it,
> breaking the real-time streaming experience.

---

## Environment Variables Reference

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | TCP port |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama base URL |
| `DEFAULT_MODEL` | `llama3.1` | Fallback Ollama model |

---

## Health Monitoring

The `/health` endpoint is suitable for use as a health check in orchestration
platforms:

```bash
# Docker health check
HEALTHCHECK --interval=30s --timeout=5s \
  CMD wget -qO- http://localhost:3000/health | grep '"status":"ok"'
```

```yaml
# Kubernetes liveness probe
livenessProbe:
  httpGet:
    path: /health
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 10
```
