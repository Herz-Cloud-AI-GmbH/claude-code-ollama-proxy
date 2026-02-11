# cc-proxy authentication (Claude Code ↔ cc-proxy)

This document describes the **authentication contract** between the Claude Code CLI (client) and the `cc-proxy` FastAPI gateway.

## 1) Client-side auth configuration (Claude Code)

### Source of truth

- The proxy key lives in `.devcontainer/.env` as:
  - `CC_PROXY_AUTH_KEY=<secret>`
- `make setup-ollama-proxy` ensures a non-placeholder value:
  - If `CC_PROXY_AUTH_KEY` is missing or set to `your-cc-proxy-key`, it is replaced with a generated hex secret.

Relevant implementation:
- `scripts/manage.py` → `ClaudeSetupManager.ensure_cc_proxy_key()` / `generate_proxy_key()`

### How Claude Code receives the key

Claude Code does **not** read `.devcontainer/.env` directly.

`make setup-ollama-proxy` writes `~/.claude/settings.json` with:

- `ANTHROPIC_BASE_URL=http://localhost:<CC_PROXY_PORT>` (default `3456`)
- `ANTHROPIC_AUTH_TOKEN=<CC_PROXY_AUTH_KEY>`

Relevant implementation:
- `scripts/manage.py` → `ClaudeSetupManager.build_cc_proxy_settings_env()` / `write_claude_settings()`

### What Claude Code sends

When configured, Claude Code calls the Anthropic Messages API endpoint:

- `POST <ANTHROPIC_BASE_URL>/v1/messages`

## 2) Server-side auth validation (`cc-proxy`)

`cc-proxy` reads the expected key from:

- `CC_PROXY_AUTH_KEY`

If missing, it returns **HTTP 500**:
- `"cc-proxy is not configured (CC_PROXY_AUTH_KEY missing)"`

### Accepted auth schemes

`cc-proxy` accepts **either** header that Claude Code may send:

1. `Authorization: Bearer <key>`
2. `x-api-key: <key>`

If either matches, the request is authorized. Otherwise it returns **HTTP 401**.

Relevant implementation:
- `app/auth.py` → `_expected_key()`, `require_auth()`, `auth_dependency()`
- `app/main.py` → `/v1/messages` uses `auth_dependency`

## 3) Response shape required by Claude Code

Claude Code expects an Anthropic Messages response with:

- `id`
- `type: "message"`
- `role: "assistant"`
- `model`
- `content` (list of content blocks; may include `text`, `thinking`, `tool_use`, `tool_result`)
- `stop_reason`
- `usage`

Relevant implementation:
- `app/main.py` → `POST /v1/messages` returns `MessagesResponse`

## 4) Known CLI behavior: interactive mode ignores settings on fresh installs

There is a documented Claude Code CLI issue where **interactive mode** ignores `~/.claude/settings.json` on a fresh install and prompts for login even when the gateway settings are correct.

Issue:
- [anthropics/claude-code#13827](https://github.com/anthropics/claude-code/issues/13827)

### Least‑invasive workaround (one‑liner)

Run once to complete onboarding without modifying config state:

```bash
ANTHROPIC_BASE_URL=http://localhost:3456 ANTHROPIC_AUTH_TOKEN=YOUR_PROXY_KEY claude
```

You can copy the proxy key from `.devcontainer/.env`:

```bash
ANTHROPIC_BASE_URL=http://localhost:3456 ANTHROPIC_AUTH_TOKEN="$(grep '^CC_PROXY_AUTH_KEY=' .devcontainer/.env | cut -d= -f2)" claude
```
