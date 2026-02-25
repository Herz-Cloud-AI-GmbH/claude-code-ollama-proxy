# AGENTS.md

TypeScript/Node.js HTTP proxy. Translates Anthropic Messages API → Ollama chat API so local LLMs work as drop-in Claude replacements.

---

## 1. Context map — read before touching a topic

| Topic | Read first |
|---|---|
| Request/response translation | `src/translator.ts`, `src/types.ts` |
| SSE streaming pipeline | `src/streaming.ts`, `docs/STREAMING.md` |
| Thinking model detection | `src/thinking.ts` |
| Tool call healing (JSON + param names + types) | `src/tool-healing.ts` |
| Parallel → sequential tool rewrite | `src/translator.ts` (`sequentializeToolCalls`) |
| Conversation history healing | `src/translator.ts` (`healConversationHistory`) |
| Token counting | `src/token-counter.ts` |
| HTTP routes and middleware | `src/server.ts` |
| CLI flags and config loading | `src/cli.ts`, `docs/CLI.md` |
| Ollama HTTP client | `src/ollama-client.ts` |
| Structured logging | `src/logger.ts`, `docs/LOGGING.md` |
| All TypeScript types | `src/types.ts` |
| Architecture overview | `docs/ARCHITECTURE.md` |
| API contracts | `docs/API.md` |

---

## 2. Commands

```bash
make install          # npm install + npm rebuild esbuild (supply-chain hardened via .npmrc)
make build            # compile TypeScript → dist/
make test             # run all Vitest suites (must stay green)
make start            # build + start proxy in background (non-blocking)
make start-fg         # build + start proxy in foreground (blocking)
make stop             # stop a backgrounded proxy (reads proxy.pid)
make run              # start proxy in background + launch Claude Code
make dev              # hot-reload via tsx, no build step
make claude           # launch Claude Code pointed at the proxy
make clean            # remove dist/ and node_modules/
make help             # list all targets with current variable values
```

Direct invocation after build:

```bash
node dist/cli.js --port 3000 --ollama-url http://host.docker.internal:11434 --default-model qwen3:8b
node dist/cli.js --background --log-file proxy.log   # start as daemon
node dist/cli.js --stop                               # stop the daemon
node dist/cli.js --init                               # write proxy.config.json and exit
```

---

## 3. Key design rules

1. All errors returned to clients use `{ type: "error", error: { type, message } }` (Anthropic format).
2. The original Claude model name is always echoed back in responses — never expose Ollama model names.
3. `system` may arrive as `string | AnthropicContentBlock[]` (Claude Code sends an array with `cache_control`). Always flatten to string before forwarding to Ollama.
4. Thinking requests for non-capable models are **silently stripped** by default (`strictThinking: false`) to keep Claude Code sessions alive.
5. SSE: call `res.flushHeaders()` before streaming; Ollama sends `eval_count` only in the final `done: true` chunk.
6. All local imports use `.js` extension (TypeScript ESM convention).
7. `DEFAULT_MODEL_MAP = {}` — all Claude model names fall through to `defaultModel` unless explicitly mapped.
8. Parallel tool calls in conversation history are rewritten into sequential rounds by default (`sequentialToolCalls: true`) so smaller models don't hallucinate "sibling tool call" errors. Disable with `--no-sequential-tools`.
9. Tool call healing is three-phase: (a) `healToolArguments` fixes malformed JSON strings; (b) `healToolParameterNames` renames wrong argument keys using the tool's JSON schema (e.g. `file` → `file_path`); (c) `healToolParameterTypes` coerces values to match schema types (e.g. `["*.ts","*.js"]` → `"*.ts, *.js"` when schema expects `string`). The schema map (names + types) is built once per request from the `tools` array and threaded through both the request and response paths.
10. Conversation history healing (`healConversationHistory`): on the request path, tool_use blocks in history are healed (names + types), and failed tool_use/tool_result rounds caused by parameter validation errors are stripped. This prevents the model from seeing a poisoned history of failures and giving up on tools.

---

## 4. Content block translation reference

| Anthropic block | Role | Ollama representation |
|---|---|---|
| `text` | any | `message.content` string |
| `thinking` | assistant | `message.thinking` string |
| `tool_use` | assistant | `message.tool_calls[]` |
| `tool_result` | user | `{ role: "tool", content: "..." }` message |
| `system` (string or block array) | system | `{ role: "system", content: <flattened string> }` |

---

## 5. Adding a feature — checklist

1. Read the relevant context files from the map in §1.
2. Update `src/types.ts` if new API fields are needed.
3. Implement in the appropriate `src/` module.
4. Wire into `src/server.ts` and/or `src/translator.ts`.
5. Add structured logging via the `logger` instance in `createServer()`.
6. Write tests in `tests/<module>.test.ts` — import with `.js` extension.
7. `make test` — all tests must pass.
8. `make build` — must succeed with zero TypeScript errors.
9. Update `AGENTS.md` if the architecture changes.

---

## 6. Testing conventions

- Framework: Vitest — `describe/it/expect`
- Mock Ollama: `tests/server.test.ts` spins up an in-process HTTP mock server
- Logger: spy on `process.stdout.write` to capture OTEL records
- No external services required for unit tests

---

## 7. External references

| Resource | URL |
|---|---|
| Anthropic Messages API | https://docs.anthropic.com/en/api/messages |
| Anthropic Extended Thinking | https://platform.claude.com/docs/en/build-with-claude/extended-thinking |
| Ollama Chat API | https://docs.ollama.com/api |
| Ollama Thinking | https://docs.ollama.com/capabilities/thinking |
| Ollama Tool Calling | https://docs.ollama.com/capabilities/tool-calling |
| OTEL LogRecord spec | https://opentelemetry.io/docs/specs/otel/logs/data-model/ |
