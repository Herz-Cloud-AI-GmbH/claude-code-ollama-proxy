from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app
from app.transport import OllamaClient


def test_auth_required_for_messages(monkeypatch) -> None:
    monkeypatch.setenv("CC_PROXY_AUTH_KEY", "k1")
    client = TestClient(app)
    payload = {"model": "sonnet", "messages": [{"role": "user", "content": "hi"}]}
    r = client.post("/v1/messages", json=payload)
    assert r.status_code == 401


def test_auth_accepts_bearer(monkeypatch) -> None:
    monkeypatch.setenv("CC_PROXY_AUTH_KEY", "k2")
    async def fake_chat(self, request) -> dict:
        return {
            "id": "msg_auth",
            "type": "message",
            "role": "assistant",
            "model": "qwen3:14b",
            "content": [{"type": "text", "text": "ok"}],
            "stop_reason": "end_turn",
            "usage": {"input_tokens": 1, "output_tokens": 1},
        }

    monkeypatch.setattr(OllamaClient, "chat_anthropic_compat", fake_chat)
    client = TestClient(app)
    payload = {"model": "sonnet", "messages": [{"role": "user", "content": "hi"}]}
    r = client.post("/v1/messages", json=payload, headers={"Authorization": "Bearer k2"})
    assert r.status_code == 200


def test_auth_accepts_x_api_key(monkeypatch) -> None:
    monkeypatch.setenv("CC_PROXY_AUTH_KEY", "k3")
    async def fake_chat(self, request) -> dict:
        return {
            "id": "msg_auth",
            "type": "message",
            "role": "assistant",
            "model": "qwen3:14b",
            "content": [{"type": "text", "text": "ok"}],
            "stop_reason": "end_turn",
            "usage": {"input_tokens": 1, "output_tokens": 1},
        }

    monkeypatch.setattr(OllamaClient, "chat_anthropic_compat", fake_chat)
    client = TestClient(app)
    payload = {"model": "sonnet", "messages": [{"role": "user", "content": "hi"}]}
    r = client.post("/v1/messages", json=payload, headers={"x-api-key": "k3"})
    assert r.status_code == 200

