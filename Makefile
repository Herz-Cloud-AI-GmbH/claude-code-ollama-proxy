.PHONY: install build test clean start dev claude help

# Ollama runs on the host machine; host.docker.internal resolves to the host
# gateway from inside the devcontainer (set via --add-host in devcontainer.json).
OLLAMA_URL      ?= http://host.docker.internal:11434
DEFAULT_MODEL   ?= qwen3:8b
PORT            ?= 3000
LOG_FILE        ?= proxy.log

install: ## Install dependencies (ignore-scripts hardening via .npmrc; rebuilds esbuild binary explicitly)
	npm install
	npm rebuild esbuild

build: install ## Build TypeScript source into dist/
	npm run build

test: ## Run all Vitest test suites
	npm test

clean: ## Remove generated artefacts (dist/ and node_modules/)
	rm -rf dist node_modules

start: build ## Build and start the proxy (override: OLLAMA_URL, DEFAULT_MODEL, PORT, LOG_FILE)
	node dist/cli.js \
		--port $(PORT) \
		--ollama-url $(OLLAMA_URL) \
		--default-model $(DEFAULT_MODEL) \
		$(if $(LOG_FILE),--log-file $(LOG_FILE))

dev: ## Start in development mode with hot-reload (override: OLLAMA_URL, DEFAULT_MODEL, PORT, LOG_FILE)
	OLLAMA_URL=$(OLLAMA_URL) \
	DEFAULT_MODEL=$(DEFAULT_MODEL) \
	PORT=$(PORT) \
	LOG_FILE=$(LOG_FILE) \
	npm run dev -- \
		--port $(PORT) \
		--ollama-url $(OLLAMA_URL) \
		--default-model $(DEFAULT_MODEL) \
		$(if $(LOG_FILE),--log-file $(LOG_FILE))

# .claude/settings.json (committed, project scope) sets apiKeyHelper so Claude
# Code uses a dummy key and skips its interactive login screen entirely.
# The ANTHROPIC_* connection vars must be real process env vars — they are not
# read from settings.json by the claude process itself.
claude: ## Launch Claude Code pointed at the local proxy (override: DEFAULT_MODEL, PORT)
	@echo "  ANTHROPIC_BASE_URL  = http://localhost:$(PORT)"
	@echo "  ANTHROPIC_MODEL     = $(DEFAULT_MODEL)"
	ANTHROPIC_BASE_URL=http://localhost:$(PORT) \
	ANTHROPIC_MODEL=$(DEFAULT_MODEL) \
	ANTHROPIC_SMALL_FAST_MODEL=$(DEFAULT_MODEL) \
	claude

help: ## Show this help message
	@echo ""
	@echo "Usage: make <target> [VAR=value ...]"
	@echo ""
	@echo "Overridable variables (current values):"
	@echo "  OLLAMA_URL    = $(OLLAMA_URL)"
	@echo "  DEFAULT_MODEL = $(DEFAULT_MODEL)"
	@echo "  PORT          = $(PORT)"
	@echo "  LOG_FILE      = $(LOG_FILE)  (set to empty to disable: LOG_FILE=)"
	@echo ""
	@echo "Targets:"
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  %-10s %s\n", $$1, $$2}' $(MAKEFILE_LIST)
	@echo ""
