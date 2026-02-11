from __future__ import annotations

from fastapi.testclient import TestClient

from cc_proxy.app.main import app
from cc_proxy.app.routing import RoutingConfig
from cc_proxy.app.transport import OllamaClient


def test_thinking_warning_header_emitted(monkeypatch) -> None:
    monkeypatch.setenv("CC_PROXY_AUTH_KEY", "k-warning")

    monkeypatch.setattr(
        "cc_proxy.app.main.load_routing_config",
        lambda: RoutingConfig(
            alias_to_model={},
            default_alias=None,
            promises={},
            debug_logging={},
            thinking_capable_models=[],
            tool_calling_capable_models=[],
            verbose_tool_logging=False,
            tool_call_streaming_enabled=False,
            ollama_timeout_seconds=None,
        ),
    )

    async def fake_chat(self, request) -> dict:
        return {
            "id": "msg_warn",
            "type": "message",
            "role": "assistant",
            "model": "qwen3:14b",
            "content": [{"type": "text", "text": "ok"}],
            "stop_reason": "end_turn",
            "usage": {"input_tokens": 1, "output_tokens": 1},
        }

    monkeypatch.setattr(OllamaClient, "chat_anthropic_compat", fake_chat)

    client = TestClient(app)
    payload = {
        "model": "sonnet",
        "messages": [
            {
                "role": "assistant",
                "content": [{"type": "thinking", "thinking": "step"}],
            }
        ],
    }
    r = client.post("/v1/messages", json=payload, headers={"Authorization": "Bearer k-warning"})
    assert r.status_code == 200
    assert r.headers.get("X-CC-Proxy-Warning") == "thinking_dropped"
