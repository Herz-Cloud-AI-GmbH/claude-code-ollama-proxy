from __future__ import annotations

from fastapi.testclient import TestClient

from cc_proxy.app.main import app
from cc_proxy.app.transport import OllamaClient


def test_messages_requires_auth(monkeypatch) -> None:
    monkeypatch.setenv("CC_PROXY_AUTH_KEY", "k1")
    client = TestClient(app)
    payload = {"model": "sonnet", "messages": [{"role": "user", "content": "hello"}]}
    r = client.post("/v1/messages", json=payload)
    assert r.status_code == 401


def test_messages_returns_minimal_anthropic_shape(monkeypatch) -> None:
    monkeypatch.setenv("CC_PROXY_AUTH_KEY", "k2")
    async def fake_chat(self, request) -> dict:
        return {
            "id": "msg_1",
            "type": "message",
            "role": "assistant",
            "model": "qwen3:14b",
            "content": [{"type": "text", "text": "stubbed"}],
            "stop_reason": "end_turn",
            "usage": {"input_tokens": 1, "output_tokens": 2},
        }

    monkeypatch.setattr(OllamaClient, "chat_anthropic_compat", fake_chat)
    client = TestClient(app)
    payload = {"model": "sonnet", "messages": [{"role": "user", "content": "hello"}], "max_tokens": 16}
    r = client.post("/v1/messages", json=payload, headers={"Authorization": "Bearer k2"})
    assert r.status_code == 200
    data = r.json()
    assert data["type"] == "message"
    assert data["role"] == "assistant"
    assert data["model"] == "sonnet"
    assert isinstance(data.get("content"), list) and data["content"]
    assert data["content"][0]["type"] == "text"
    assert data["content"][0]["text"] == "stubbed"

