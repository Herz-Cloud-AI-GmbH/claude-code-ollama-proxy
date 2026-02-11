from __future__ import annotations

from cc_proxy.app.adapt_request import to_anthropic_compat
from cc_proxy.app.models_anthropic import MessagesRequest


def test_to_anthropic_compat_keeps_anthropic_blocks_and_drops_unsupported_fields() -> None:
    req = MessagesRequest.model_validate(
        {
            "model": "sonnet",
            "messages": [{"role": "user", "content": "hello"}],
            "max_tokens": 16,
            "temperature": 0.1,
            "thinking": {"type": "enabled"},
            "reasoning_effort": "high",
            "tools": [{"name": "read_file"}],
            "tool_choice": {"type": "tool", "name": "read_file"},
            "metadata": {"user_id": "abc"},
        }
    )

    adapted = to_anthropic_compat(req, resolved_model="qwen3:14b")
    assert adapted["model"] == "qwen3:14b"
    assert adapted["max_tokens"] == 16
    assert adapted["temperature"] == 0.1
    assert adapted["messages"][0]["role"] == "user"
    assert adapted["messages"][0]["content"] == "hello"
    assert adapted["thinking"]["type"] == "enabled"
    assert adapted["tools"][0]["name"] == "read_file"
    assert "tool_choice" not in adapted
    assert "metadata" not in adapted
