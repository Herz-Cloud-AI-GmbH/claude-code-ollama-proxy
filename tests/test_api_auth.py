from __future__ import annotations

from fastapi.testclient import TestClient

from cc_proxy.app.main import app
from cc_proxy.app.models_ollama import OpenAIChatCompletionsResponse
from cc_proxy.app.transport import OllamaClient


def test_auth_required_for_messages(monkeypatch) -> None:
    monkeypatch.setenv("CC_PROXY_AUTH_KEY", "k1")
    client = TestClient(app)
    payload = {"model": "sonnet", "messages": [{"role": "user", "content": "hi"}]}
    r = client.post("/v1/messages", json=payload)
    assert r.status_code == 401


def test_auth_accepts_bearer(monkeypatch) -> None:
    monkeypatch.setenv("CC_PROXY_AUTH_KEY", "k2")
    async def fake_chat(self, request) -> OpenAIChatCompletionsResponse:
        return OpenAIChatCompletionsResponse.model_validate(
            {
                "id": "chatcmpl-auth",
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": "ok"},
                        "finish_reason": "stop",
                    }
                ],
                "usage": {"prompt_tokens": 1, "completion_tokens": 1},
            }
        )

    monkeypatch.setattr(OllamaClient, "chat_openai_compat", fake_chat)
    client = TestClient(app)
    payload = {"model": "sonnet", "messages": [{"role": "user", "content": "hi"}]}
    r = client.post("/v1/messages", json=payload, headers={"Authorization": "Bearer k2"})
    assert r.status_code == 200


def test_auth_accepts_x_api_key(monkeypatch) -> None:
    monkeypatch.setenv("CC_PROXY_AUTH_KEY", "k3")
    async def fake_chat(self, request) -> OpenAIChatCompletionsResponse:
        return OpenAIChatCompletionsResponse.model_validate(
            {
                "id": "chatcmpl-auth",
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": "ok"},
                        "finish_reason": "stop",
                    }
                ],
                "usage": {"prompt_tokens": 1, "completion_tokens": 1},
            }
        )

    monkeypatch.setattr(OllamaClient, "chat_openai_compat", fake_chat)
    client = TestClient(app)
    payload = {"model": "sonnet", "messages": [{"role": "user", "content": "hi"}]}
    r = client.post("/v1/messages", json=payload, headers={"x-api-key": "k3"})
    assert r.status_code == 200

