from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Callable

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.transport import OllamaClient

from .utils import ensure_proxy_stopped


@pytest.fixture(autouse=True)
def _ensure_cc_proxy_not_left_running() -> None:
    """
    Safety net: tests in this suite may start a real uvicorn subprocess.
    Ensure we don't leave it running after any test.
    """
    yield
    ensure_proxy_stopped()


# ========== Reusable test fixtures to reduce boilerplate ==========


def make_anthropic_response(
    *,
    id: str = "msg_test",
    model: str = "qwen3:14b",
    content: list[dict[str, Any]] | None = None,
    stop_reason: str = "end_turn",
    input_tokens: int = 1,
    output_tokens: int = 1,
) -> dict[str, Any]:
    """
    Create a minimal valid Anthropic Messages API response.

    Usage:
        response = make_anthropic_response(
            content=[{"type": "text", "text": "Hello"}]
        )
    """
    if content is None:
        content = [{"type": "text", "text": "ok"}]

    return {
        "id": id,
        "type": "message",
        "role": "assistant",
        "model": model,
        "content": content,
        "stop_reason": stop_reason,
        "usage": {"input_tokens": input_tokens, "output_tokens": output_tokens},
    }


@pytest.fixture
def mock_ollama_success(monkeypatch) -> Callable[[dict | None], None]:
    """
    Fixture that provides a function to mock successful Ollama responses.

    Usage:
        def test_something(mock_ollama_success):
            mock_ollama_success()  # uses default response
            # OR
            mock_ollama_success({"content": [{"type": "text", "text": "custom"}]})
    """
    def _mock(response_override: dict[str, Any] | None = None) -> None:
        async def fake_chat(self, request) -> dict:
            if response_override:
                return response_override
            return make_anthropic_response()

        monkeypatch.setattr(OllamaClient, "chat_anthropic_compat", fake_chat)

    return _mock


@pytest.fixture
def auth_client(monkeypatch, mock_ollama_success) -> TestClient:
    """
    Pre-configured TestClient with auth key set and Ollama mocked.

    Usage:
        def test_something(auth_client):
            r = auth_client.post("/v1/messages", json={...})
            assert r.status_code == 200
    """
    monkeypatch.setenv("CC_PROXY_AUTH_KEY", "test-key")
    mock_ollama_success()

    client = TestClient(app)
    # Inject auth header into all requests
    client.headers["Authorization"] = "Bearer test-key"
    return client


@pytest.fixture
def minimal_messages_request() -> dict[str, Any]:
    """
    Minimal valid Anthropic Messages API request payload.

    Usage:
        def test_something(auth_client, minimal_messages_request):
            r = auth_client.post("/v1/messages", json=minimal_messages_request)
    """
    return {
        "model": "sonnet",
        "messages": [{"role": "user", "content": "hi"}],
        "max_tokens": 16,
    }


def load_jsonl_fixture(name: str, *, min_entries: int = 1) -> list[dict[str, Any]]:
    fixture_path = Path(__file__).resolve().parent / "fixtures" / name
    entries: list[dict[str, Any]] = []
    for line in fixture_path.read_text().splitlines():
        raw = line.strip()
        if not raw:
            continue
        value = json.loads(raw)
        if isinstance(value, dict):
            entries.append(value)
    if len(entries) < min_entries:
        raise AssertionError(
            f"Fixture {name} has {len(entries)} entries, expected at least {min_entries}"
        )
    return entries


def has_tool_use(payload: dict[str, Any]) -> bool:
    content = payload.get("content")
    if not isinstance(content, list):
        return False
    for block in content:
        if isinstance(block, dict) and block.get("type") == "tool_use":
            return True
    return False


def has_tool_call_text(payload: dict[str, Any]) -> bool:
    content = payload.get("content")
    if not isinstance(content, list):
        return False
    for block in content:
        if not isinstance(block, dict) or block.get("type") != "text":
            continue
        text = str(block.get("text") or "").lower()
        if "<tool_call>" in text or "tool_call" in text:
            return True
    return False

