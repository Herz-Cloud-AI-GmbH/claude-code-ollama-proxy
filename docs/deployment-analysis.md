# Deployment Analysis: CLI-First Distribution for `cc-proxy`

## 1. Goal and Decision

We want a simple, maintainable deployment model for users who run:

- Claude Code on host or in a devcontainer
- Ollama on host, another container, or same container

Decision:

- Ship `cc-proxy` as a CLI-first product distributed via PyPI.
- Recommend `pipx` as the default installation method.
- Keep container deployment as an optional parallel runtime path.

Target user experience:

- install: `pipx install cc-proxy` (or `pip install cc-proxy` in a virtual env)
- run: `cc-proxy start|stop|logs|claude`
- config override: `--config /path/to/cc-proxy.user.yaml`

## 2. Why CLI-First (and not container-first)

CLI-first is the simplest default for individual developers:

- fewer moving parts than Docker networking/volumes
- direct local process debugging
- same command UX across host and devcontainer

Container remains valuable for teams that want stricter runtime isolation and image-based operations.

## 3. Installer Strategy (`pipx` vs `curl | sh`)

Primary recommendation: `pipx` + PyPI.

Why:

- safer trust model than executing remote shell scripts directly
- isolated install per tool (no global Python pollution)
- reproducible versioned artifacts and standard Python packaging flow
- simple lifecycle: `pipx install/upgrade/uninstall cc-proxy`

Position on `curl | sh`:

- optional convenience only
- not the primary path
- if provided, keep it minimal/auditable and delegate to `pipx` when possible

Install guidance order in docs:

1. `pipx install cc-proxy` (preferred)
2. `pip install cc-proxy` (inside a virtual environment)
3. optional bootstrap script

## 4. Runtime Topologies to Support

`cc-proxy` must support all common placements:

- Claude on host, proxy on host, Ollama on host
- Claude in devcontainer, proxy in devcontainer, Ollama on host (`host.docker.internal`)
- Claude + proxy in container, Ollama in another container

Operational rule:

- Claude points to proxy via `ANTHROPIC_BASE_URL`
- proxy points to Ollama via `OLLAMA_BASE_URL`
- model aliases are configured in `cc-proxy.user.yaml`

## 5. Concrete CLI Spec (v1)

### 5.1 Naming and compatibility

- Distribution package: `cc-proxy` (PyPI name)
- Python import package: `cc_proxy`
- Primary executable: `cc-proxy`
- Optional compatibility alias: `cc_proxy`

### 5.2 Global behavior

- Config precedence:
  1. `--config <path>`
  2. `CC_PROXY_CONFIG_FILE`
  3. default config search locations
- Common flags:
  - `--config <path>`
  - `--log-dir <path>`
  - `--state-dir <path>`
  - `--json` for machine-readable output
- On explicit bad input, exit non-zero with actionable errors.

### 5.3 `cc-proxy start`

Purpose:

- start proxy process to handle Claude <-> proxy <-> Ollama traffic

Behavior:

- validate config and effective settings before launch
- start server on configured host/port
- write pid/state and log files
- print bind URL and active config path
- if already running, return success and print current pid

Key flags:

- `--host <host>`
- `--port <port>`
- `--foreground` (debug mode)

### 5.4 `cc-proxy stop`

Purpose:

- stop the process started by `cc-proxy start`

Behavior:

- graceful terminate, then force kill after timeout
- cleanup stale pid/state
- if already stopped, return success with clear message

Key flags:

- `--timeout-seconds <n>`

### 5.5 `cc-proxy logs`

Purpose:

- show config resolution details and runtime log locations

Behavior:

- display config path sources (`--config`, env, defaults) and active file
- display log directory and primary log file path
- show active config with secrets redacted
- optional runtime tail output

Key flags:

- `--tail`
- `--lines <n>`

### 5.6 `cc-proxy claude`

Purpose:

- launch Claude Code with proxy env pre-wired

Behavior:

- ensure proxy is running (auto-start or clear instruction)
- set `ANTHROPIC_BASE_URL` and auth token env for Claude invocation
- forward pass-through args to Claude

Key flags:

- `--start-if-needed` (default true)
- `--claude-bin <path>`
- `--` pass-through args

### 5.7 Config path contract

For `--config`:

- accept relative and absolute paths
- fail fast if missing/unreadable
- log active config path at startup
- never print raw secrets in output

### 5.8 Filesystem conventions

Defaults (override via flags/env):

- state dir: `~/.cc-proxy/run/`
- log dir: `~/.cc-proxy/logs/`
- pid file: `~/.cc-proxy/run/cc-proxy.pid`
- main log file: `~/.cc-proxy/logs/cc-proxy.log`

## 6. Packaging Requirements (PyPI)

`pyproject.toml` must define:

- `[build-system]` (setuptools + wheel)
- `[project]` metadata (`name`, `version`, `requires-python`, dependencies, readme)
- `[project.optional-dependencies]` (at least `dev`)
- `[project.scripts]` with `cc-proxy = cc_proxy.app.cli:main`

Package layout:

- `cc_proxy/__init__.py`
- importable runtime modules under `cc_proxy/app/`
- include any required runtime templates/config defaults as package data

## 7. Publish Process (How `pip install cc-proxy` Works)

### 7.1 Registration targets

- TestPyPI (`https://test.pypi.org`) for pre-prod verification
- PyPI (`https://pypi.org`) for production installs

At least one maintainer should have access on both.

### 7.2 Release sequence

1. run tests
2. build artifacts: `python -m build`
3. validate artifacts: `twine check dist/*`
4. publish to TestPyPI and smoke test install/run
5. publish to PyPI
6. verify clean install of `cc-proxy` from PyPI

Preferred auth:

- Trusted Publishing (OIDC) from CI

Fallback:

- API tokens in CI secrets with `twine upload`

Manual fallback commands:

```bash
python -m build
twine check dist/*
twine upload --repository testpypi dist/*
twine upload dist/*
```

## 8. Local Validation Workflow (inside this repo)

### 8.1 Dev install + tests

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip build twine
pip install -e ".[dev]"
pytest cc_proxy/tests/ -v
```

### 8.2 Build + wheel install test

```bash
python -m build
twine check dist/*
deactivate || true
python -m venv .venv-wheel-test
source .venv-wheel-test/bin/activate
pip install --upgrade pip
pip install dist/*.whl
cc-proxy --help
cc-proxy start --help
```

### 8.3 Runtime smoke test

```bash
export CC_PROXY_AUTH_KEY='dev-key'
export OLLAMA_BASE_URL='http://host.docker.internal:11434'
export OLLAMA_TIMEOUT_SECONDS='120s'

cc-proxy start --config .cc-proxy/cc-proxy.user.yaml
curl -s -H "Authorization: Bearer dev-key" http://localhost:3456/health
cc-proxy stop
```

## 9. Acceptance Criteria

- `pipx install cc-proxy` works in a clean environment
- `pip install dist/*.whl` works in a clean environment
- CLI commands `start|stop|logs|claude` are available and behave as specified
- `--config <path>` reliably selects config and reports clear errors when invalid
- `/health` passes in local smoke test with auth
- CI publishes to TestPyPI/PyPI and validates install/run

## 10. Rollout Plan

1. implement packaging metadata + CLI entrypoint
2. implement v1 command set (`start`, `stop`, `logs`, `claude`)
3. add local and CI smoke tests for command behavior
4. publish to TestPyPI, then PyPI
5. document topology-specific quickstarts (host and devcontainer)
