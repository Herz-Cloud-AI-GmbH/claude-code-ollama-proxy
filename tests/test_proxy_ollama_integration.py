from __future__ import annotations

import httpx
from fastapi.testclient import TestClient

from cc_proxy.app.main import app


def _ollama_models() -> set[str]:
    try:
        r = httpx.get("http://host.docker.internal:11434/api/tags", timeout=2.0)
        r.raise_for_status()
    except httpx.RequestError as exc:
        raise AssertionError("Ollama is not reachable on host.docker.internal:11434") from exc
    data = r.json()
    models = {
        item.get("name")
        for item in (data.get("models") or [])
        if isinstance(item, dict)
    }
    return {model for model in models if isinstance(model, str)}


def test_proxy_to_ollama_smoke(monkeypatch) -> None:
    models = _ollama_models()
    assert "qwen3:4b" in models, "Ollama is missing required model qwen3:4b"

    monkeypatch.setenv("CC_PROXY_AUTH_KEY", "k3")
    monkeypatch.setenv("OLLAMA_TIMEOUT_SECONDS", "10")
    client = TestClient(app)
    payload = {
        "model": "qwen3:4b",
        "messages": [{"role": "user", "content": "hello"}],
        "max_tokens": 16,
    }
    r = client.post("/v1/messages", json=payload, headers={"Authorization": "Bearer k3"})
    assert r.status_code == 200, f"Ollama proxy response was {r.status_code}"
    data = r.json()
    content = data.get("content") or []
    assert content, "Ollama response had no content blocks"
    assert all(isinstance(block, dict) for block in content)
