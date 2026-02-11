from __future__ import annotations

from fastapi.testclient import TestClient

from cc_proxy.app.main import app
from cc_proxy.app.transport import OllamaClient


def test_tool_blocks_passthrough(monkeypatch) -> None:
    monkeypatch.setenv("CC_PROXY_AUTH_KEY", "k-tools")

    async def fake_chat(self, request) -> dict:
        assert request["tools"][0]["name"] == "read_file"
        assert request["messages"][0]["content"][0]["type"] == "tool_use"
        assert request["messages"][1]["content"][0]["type"] == "tool_result"
        return {
            "id": "msg_tool",
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
                "content": [
                    {"type": "tool_use", "id": "t1", "name": "read_file", "input": {"path": "README.md"}}
                ],
            },
            {
                "role": "user",
                "content": [
                    {"type": "tool_result", "tool_use_id": "t1", "content": "file contents"}
                ],
            },
        ],
        "tools": [{"name": "read_file", "input_schema": {"type": "object", "properties": {"path": {"type": "string"}}}}],
        "max_tokens": 16,
    }

    r = client.post("/v1/messages", json=payload, headers={"Authorization": "Bearer k-tools"})
    assert r.status_code == 200
