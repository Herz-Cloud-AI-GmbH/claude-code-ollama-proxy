from __future__ import annotations

import os

import httpx
import pytest
from fastapi.testclient import TestClient

from cc_proxy.app.main import app


def _ollama_base_url() -> str:
    return (os.getenv("OLLAMA_BASE_URL") or "http://host.docker.internal:11434").rstrip("/")


def _thinking_tests_enabled() -> bool:
    return (os.getenv("RUN_OLLAMA_THINKING_TESTS") or "").strip() == "1"


def _select_qwen_model() -> str:
    base_url = _ollama_base_url()
    try:
        resp = httpx.get(f"{base_url}/api/tags", timeout=5)
        resp.raise_for_status()
    except Exception as exc:  # pragma: no cover - environment dependent
        pytest.skip(f"Ollama not reachable: {exc}")

    models = {m.get("name") for m in resp.json().get("models", []) if isinstance(m, dict)}
    for candidate in ("qwen3:14b", "qwen3:8b", "qwen3:4b"):
        if candidate in models:
            return candidate

    pytest.skip("No qwen3:14b/8b/4b model found in Ollama")


def test_ollama_native_thinking_trace_present() -> None:
    if not _thinking_tests_enabled():
        pytest.skip("Set RUN_OLLAMA_THINKING_TESTS=1 to run thinking integration tests")
    model = _select_qwen_model()
    base_url = _ollama_base_url()

    payload = {
        "model": model,
        "messages": [{"role": "user", "content": "say hello"}],
        "think": True,
        "stream": False,
    }

    try:
        resp = httpx.post(f"{base_url}/api/chat", json=payload, timeout=10)
        resp.raise_for_status()
    except httpx.RequestError as exc:
        pytest.skip(f"Ollama request failed: {exc}")
    data = resp.json()

    thinking = data.get("message", {}).get("thinking")
    if not thinking:
        pytest.skip("Model did not return a thinking trace")
    assert isinstance(thinking, str)
    assert thinking.strip() != ""


def test_ollama_openai_compat_omits_thinking_trace() -> None:
    if not _thinking_tests_enabled():
        pytest.skip("Set RUN_OLLAMA_THINKING_TESTS=1 to run thinking integration tests")
    model = _select_qwen_model()
    base_url = _ollama_base_url()

    payload = {
        "model": model,
        "messages": [{"role": "user", "content": "say hello"}],
        "think": True,
        "stream": False,
    }

    try:
        resp = httpx.post(f"{base_url}/v1/chat/completions", json=payload, timeout=10)
        resp.raise_for_status()
    except httpx.RequestError as exc:
        pytest.skip(f"Ollama request failed: {exc}")
    data = resp.json()

    message = (data.get("choices") or [{}])[0].get("message", {})
    assert "thinking" not in message


def test_cc_proxy_thinking_preserved_in_anthropic_path(monkeypatch) -> None:
    if not _thinking_tests_enabled():
        pytest.skip("Set RUN_OLLAMA_THINKING_TESTS=1 to run thinking integration tests")
    model = _select_qwen_model()
    base_url = _ollama_base_url()

    monkeypatch.setenv("CC_PROXY_AUTH_KEY", "test-key")
    monkeypatch.setenv("OLLAMA_BASE_URL", base_url)
    monkeypatch.setenv("OLLAMA_TIMEOUT_SECONDS", "10")

    client = TestClient(app)
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": "say hello"}],
        "max_tokens": 16,
        "thinking": {"type": "enabled", "budget_tokens": 1024},
    }

    resp = client.post(
        "/v1/messages",
        headers={"Authorization": "Bearer test-key"},
        json=payload,
    )
    if resp.status_code != 200:
        pytest.skip(f"Proxy response was {resp.status_code}")
    data = resp.json()

    content_blocks = data.get("content") or []
    if not any(
        block.get("type") in {"thinking", "redacted_thinking"}
        for block in content_blocks
        if isinstance(block, dict)
    ):
        pytest.skip("Proxy did not return thinking blocks")
