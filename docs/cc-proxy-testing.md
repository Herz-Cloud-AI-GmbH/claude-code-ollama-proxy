# cc-proxy Testing Strategy

This document describes the testing approach, patterns, and organization for the `cc-proxy` codebase.

---

## Testing Philosophy

`cc-proxy` follows a **layered testing strategy** with clear separation between:

1. **Unit tests**: Fast, isolated tests for individual functions and classes
2. **Integration tests**: Tests involving FastAPI TestClient and mocked dependencies
3. **System tests**: End-to-end tests with real processes (Ollama, Claude CLI)

### Key Principles

- ✅ **Test behavior, not implementation**: Focus on inputs, outputs, and side effects
- ✅ **Fail fast**: Use clear assertions and descriptive error messages
- ✅ **Minimize boilerplate**: Use fixtures and helpers to reduce repetition
- ✅ **Run in isolation**: Each test can run independently without side effects
- ✅ **Document intent**: Test names clearly describe what they verify

---

## Test Organization

### File Naming Convention

Tests are organized by **category prefix** to make them easy to find:

| Prefix | Purpose | Example |
|--------|---------|---------|
| `test_api_*.py` | API endpoint tests (auth, messages, events, headers) | `test_api_auth.py` |
| `test_adapt_*.py` | Request/response adapter unit tests | `test_adapt_request_anthropic_passthrough.py` |
| `test_transport_*.py` | HTTP transport layer tests | `test_transport_anthropic.py` |
| `test_routing_*.py` | Routing and alias resolution tests | `test_routing_aliases.py` |
| `test_models_*.py` | Pydantic model validation tests | `test_models_anthropic_minimal.py` |
| `test_tool_*.py` | Tool calling support tests | `test_tool_blocks_passthrough.py` |
| `test_thinking_*.py` | Thinking policy and integration tests | `test_thinking_ollama_integration.py` |
| `test_claude_*.py` | Claude Code CLI integration tests | `test_claude_cli_gateway_smoke.py` |
| `test_repo_*.py` | Repo workflow and setup integration tests | `test_repo_proxy_lifecycle.py` |
| `test_request_*.py` | Request middleware and context tests | `test_request_logging_middleware.py` |
| `test_observability_*.py` | Logging and OTel tests | `test_observability_logging.py` |
| `test_logging_*.py` | Logging behavior tests | `test_logging_thinking_policy.py` |

### Test Function Naming

Test names follow the pattern: `test_<subject>_<behavior>_<condition>`

**Good examples:**
```python
def test_auth_accepts_bearer()
def test_thinking_policy_drops_blocks_when_not_capable()
def test_load_routing_config_prefers_home_overrides()
```

**Avoid:**
```python
def test_1()  # Not descriptive
def test_check_auth()  # Unclear what's being checked
def test_it_works()  # Too vague
```

---

## Common Test Patterns

### 1. API Endpoint Tests (with TestClient)

**Pattern: Mock Ollama + TestClient**

```python
from fastapi.testclient import TestClient
from app.main import app
from app.transport import OllamaClient

def test_messages_requires_auth(monkeypatch) -> None:
    monkeypatch.setenv("CC_PROXY_AUTH_KEY", "test-key")
    client = TestClient(app)
    payload = {"model": "sonnet", "messages": [{"role": "user", "content": "hi"}]}

    r = client.post("/v1/messages", json=payload)
    assert r.status_code == 401
```

**Using the new fixtures (RECOMMENDED):**

```python
def test_messages_returns_ok(auth_client, minimal_messages_request) -> None:
    r = auth_client.post("/v1/messages", json=minimal_messages_request)
    assert r.status_code == 200
    assert r.json()["type"] == "message"
```

### 2. Unit Tests (Pure Functions)

**Pattern: Direct function calls, no mocking**

```python
from app.adapt_request import to_anthropic_compat
from app.models_anthropic import MessagesRequest

def test_to_anthropic_compat_preserves_tool_blocks() -> None:
    req = MessagesRequest.model_validate({
        "model": "sonnet",
        "messages": [
            {
                "role": "assistant",
                "content": [
                    {"type": "tool_use", "id": "t1", "name": "read_file", "input": {}}
                ],
            }
        ],
    })

    adapted = to_anthropic_compat(req, resolved_model="qwen3:14b")
    assert adapted["messages"][0]["content"][0]["type"] == "tool_use"
```

### 3. Logging Tests (with caplog)

**Pattern: Verify structured log events**

```python
def test_thinking_policy_logs_when_dropped(monkeypatch, caplog) -> None:
    monkeypatch.setenv("CC_PROXY_AUTH_KEY", "k")

    async def fake_chat(self, request) -> dict:
        return make_anthropic_response()

    monkeypatch.setattr(OllamaClient, "chat_anthropic_compat", fake_chat)

    client = TestClient(app)
    payload = {
        "model": "qwen3:8b",  # thinking-capable model
        "messages": [
            {
                "role": "user",
                "content": [{"type": "thinking", "thinking": "reasoning..."}],
            }
        ],
    }

    with caplog.at_level("INFO", logger="cc-proxy"):
        client.post("/v1/messages", json=payload, headers={"Authorization": "Bearer k"})

    events = [r.message for r in caplog.records if "thinking.block_handled" in r.message]
    assert len(events) > 0
```

### 4. Integration Tests (Real Processes)

**Pattern: Subprocess management + health checks**

```python
from tests.utils import run_manage, wait_for_health_ok, ensure_proxy_stopped

def test_proxy_lifecycle() -> None:
    result = run_manage(["proxy-start"], timeout_s=10)
    assert result.returncode == 0

    wait_for_health_ok(port=3456, timeout_s=6)

    # Test proxy functionality...

    ensure_proxy_stopped()
```

### 5. Parametrized Tests

**Pattern: Test multiple scenarios with same logic**

```python
import pytest

@pytest.mark.parametrize(
    "model_name,expected",
    [
        ("qwen3:14b", True),
        ("qwen3:8b", True),
        ("llama3:8b", False),
    ]
)
def test_thinking_capability(model_name, expected) -> None:
    config = load_routing_config()
    is_capable = model_name in config.thinking_capable_models
    assert is_capable == expected
```

---

## Reusable Fixtures

All common fixtures are defined in `tests/conftest.py`.

### Available Fixtures

#### `mock_ollama_success`

Provides a function to mock successful Ollama responses.

**Usage:**
```python
def test_something(mock_ollama_success) -> None:
    mock_ollama_success()  # Uses default response
    # OR
    custom_response = make_anthropic_response(
        content=[{"type": "text", "text": "Custom response"}]
    )
    mock_ollama_success(custom_response)
```

#### `auth_client`

Pre-configured TestClient with auth and Ollama mocked.

**Usage:**
```python
def test_endpoint(auth_client) -> None:
    r = auth_client.post("/v1/messages", json={...})
    assert r.status_code == 200
```

#### `minimal_messages_request`

Minimal valid Anthropic Messages API request payload.

**Usage:**
```python
def test_endpoint(auth_client, minimal_messages_request) -> None:
    r = auth_client.post("/v1/messages", json=minimal_messages_request)
    assert r.status_code == 200
```

### Helper Functions

#### `make_anthropic_response()`

Create minimal valid Anthropic response dictionaries.

**Usage:**
```python
from tests.conftest import make_anthropic_response

response = make_anthropic_response(
    id="msg_custom",
    content=[
        {"type": "text", "text": "Hello"},
        {"type": "tool_use", "id": "t1", "name": "search", "input": {}},
    ]
)
```

---

## Test Utilities (`tests/utils.py`)

### Process Management

```python
from tests.utils import (
    run_manage,      # Run scripts/manage.py with args
    run_cmd,         # Run arbitrary command
    ensure_proxy_stopped,  # Stop proxy gracefully or forcefully
    wait_for_health_ok,    # Poll /health until ready
)
```

### Environment Manipulation

```python
from tests.utils import env_get, env_set

# Read .env file
value = env_get(Path(".devcontainer/.env"), "CC_PROXY_AUTH_KEY")

# Write .env file
env_set(Path(".devcontainer/.env"), "CC_PROXY_AUTH_KEY", "new-value")
```

---

## FastAPI Testing Alignment

This project follows FastAPI's recommended testing patterns:

1. **Use `TestClient` for synchronous tests**
   - From `fastapi.testclient import TestClient`
   - No need for async test functions unless testing async-specific behavior

2. **Dependency injection for mocking**
   - Override dependencies in tests when needed
   - Use `monkeypatch` to mock external services

3. **Response validation**
   - Verify status codes
   - Validate JSON response shapes
   - Check headers

4. **Fixture organization**
   - Central `conftest.py` for shared fixtures
   - Test-specific fixtures in individual files

**Reference:** [FastAPI Testing Documentation](https://fastapi.tiangolo.com/tutorial/testing/)

---

## Coverage Goals

### Current Coverage (Estimated)

- **Core API endpoints**: ~95% (health, messages, auth)
- **Request/response adaptation**: ~90% (passthrough, filtering, thinking policy)
- **Tool calling**: ~85% (passthrough, use_tools marker, and tool-use repair)
- **Routing**: ~95% (aliases, config loading, timeout)
- **Observability**: ~95% (logging, middleware, OTel)
- **Repo integration**: ~90% (setup, lifecycle, config)
- **Integration with Claude/Ollama**: ~70% (depends on external services)

### Coverage Gaps (Nice-to-Have)

1. **Error scenarios**: More negative test cases
   - Malformed JSON payloads
   - Invalid model names that don't exist in Ollama
   - Network timeout behaviors

2. **Edge cases**: Boundary conditions
   - Very large message payloads (>100KB)
   - Empty content arrays in various contexts
   - Unusual content block type combinations

3. **Performance**: Load testing
   - Concurrent requests
   - Response times under load
   - Memory usage patterns

---

## Running Tests

### Run All Tests

```bash
pytest tests/
```

### Run Specific Category

```bash
# Unit tests only (fast)
pytest tests/test_adapt_*.py
pytest tests/test_models_*.py

# API tests
pytest tests/test_api_*.py

# Integration tests (slower, may require Ollama)
pytest tests/test_repo_*.py
pytest tests/test_claude_*.py
pytest tests/test_ollama_*.py
pytest tests/test_thinking_ollama_*.py
```

### Run with Verbose Output

```bash
pytest tests/ -v
```

### Run with Coverage

```bash
pytest tests/ --cov=app --cov-report=html
open htmlcov/index.html
```

### Run Specific Test

```bash
pytest tests/test_api_auth.py::test_auth_accepts_bearer -v
```

---

## Writing New Tests

### Checklist for New Tests

1. ✅ **Choose the right category**: Use appropriate `test_<category>_*.py` prefix
2. ✅ **Use descriptive names**: `test_<subject>_<behavior>_<condition>`
3. ✅ **Use fixtures**: Leverage `conftest.py` fixtures to reduce boilerplate
4. ✅ **Mock external dependencies**: Use `monkeypatch` for Ollama, env vars, etc.
5. ✅ **Verify side effects**: Check logs, headers, database state as needed
6. ✅ **Add docstrings for complex tests**: Explain *why* you're testing, not *what*
7. ✅ **Keep tests focused**: One assertion per test when possible

### Example: Adding a New API Test

```python
# tests/test_api_custom_feature.py

from fastapi.testclient import TestClient
from app.main import app
from tests.conftest import make_anthropic_response

def test_custom_feature_returns_expected_response(
    auth_client,
    minimal_messages_request,
) -> None:
    """
    Verify that the custom feature adds the expected header
    and modifies the response content appropriately.
    """
    # Arrange
    minimal_messages_request["custom_param"] = "value"

    # Act
    r = auth_client.post("/v1/messages", json=minimal_messages_request)

    # Assert
    assert r.status_code == 200
    assert "X-Custom-Header" in r.headers
    assert r.json()["custom_field"] == "expected_value"
```

---

## Troubleshooting Tests

### Tests Hang or Timeout

- **Cause**: Proxy subprocess left running
- **Solution**: `conftest.py` has autouse fixture `_ensure_cc_proxy_not_left_running`
- **Manual fix**: `make proxy-stop` or `kill $(cat /tmp/cc_proxy.pid)`

### Ollama Integration Tests Fail

- **Cause**: Ollama not running on host
- **Solution**: Start Ollama on host machine (`ollama serve`)
- **Check connectivity**: `curl http://host.docker.internal:11434/api/tags`

### Import Errors

- **Cause**: Missing dependencies or wrong Python path
- **Solution**: Ensure you're in devcontainer and dependencies are installed

### Fixture Not Found

- **Cause**: New fixture not imported or defined in `conftest.py`
- **Solution**: Add fixture to `conftest.py` or import from appropriate module

---

## Best Practices Summary

1. **Use fixtures liberally** - Reduce boilerplate with `auth_client`, `mock_ollama_success`, etc.
2. **Test one thing at a time** - Keep tests focused and assertions clear
3. **Name tests descriptively** - Future you (and reviewers) will thank you
4. **Mock external dependencies** - Don't let tests depend on network/external state
5. **Verify both happy and sad paths** - Test error scenarios too
6. **Keep tests fast** - Use unit tests where possible; reserve integration for critical flows
7. **Document complex test setups** - Use docstrings to explain *why*, not *what*
8. **Run tests before committing** - Ensure your changes don't break existing tests

---

## Further Reading

- **FastAPI Testing**: https://fastapi.tiangolo.com/tutorial/testing/
- **pytest Documentation**: https://docs.pytest.org/
- **pytest Fixtures**: https://docs.pytest.org/en/stable/how-to/fixtures.html
- **OpenTelemetry Testing**: https://opentelemetry.io/docs/instrumentation/python/testing/
