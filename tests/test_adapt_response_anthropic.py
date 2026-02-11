from __future__ import annotations

from cc_proxy.app.adapt_response import from_anthropic_compat


def test_from_anthropic_compat_coerces_non_list_content() -> None:
    response = {
        "id": "msg_2",
        "type": "message",
        "role": "assistant",
        "model": "qwen3:14b",
        "content": "not-a-list",
    }

    adapted = from_anthropic_compat(response, model="sonnet")
    assert adapted.content == []
