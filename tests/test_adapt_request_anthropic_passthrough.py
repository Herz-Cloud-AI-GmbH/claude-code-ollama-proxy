from __future__ import annotations

from cc_proxy.app.adapt_request import to_anthropic_compat
from cc_proxy.app.models_anthropic import MessagesRequest


def test_to_anthropic_compat_preserves_tool_blocks() -> None:
    req = MessagesRequest.model_validate(
        {
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
                        {"type": "tool_result", "tool_use_id": "t1", "content": "ok"},
                    ],
                },
            ],
        }
    )

    adapted = to_anthropic_compat(req, resolved_model="qwen3:14b")
    assert adapted["messages"][0]["content"][0]["type"] == "tool_use"
    assert adapted["messages"][1]["content"][0]["type"] == "tool_result"
