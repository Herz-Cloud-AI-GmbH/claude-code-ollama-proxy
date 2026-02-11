from __future__ import annotations

from cc_proxy.app.adapt_request import to_anthropic_compat
from cc_proxy.app.models_anthropic import MessagesRequest


def test_to_anthropic_compat_preserves_block_content() -> None:
    req = MessagesRequest.model_validate(
        {
            "model": "sonnet",
            "messages": [
                {
                    "role": "user",
                    "content": [{"type": "text", "text": "first"}, {"type": "text", "text": "second"}],
                }
            ],
        }
    )

    adapted = to_anthropic_compat(req, resolved_model="qwen3:14b")
    assert adapted["messages"][0]["content"] == [
        {"type": "text", "text": "first"},
        {"type": "text", "text": "second"},
    ]


def test_to_anthropic_compat_keeps_string_content() -> None:
    req = MessagesRequest.model_validate(
        {
            "model": "sonnet",
            "messages": [{"role": "user", "content": "plain text"}],
        }
    )

    adapted = to_anthropic_compat(req, resolved_model="qwen3:14b")
    assert adapted["messages"][0]["content"] == "plain text"
