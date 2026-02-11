from __future__ import annotations

import pytest
from fastapi import HTTPException

from cc_proxy.app.adapt_response import from_anthropic_compat


def test_from_anthropic_compat_preserves_blocks_and_overrides_model() -> None:
    response = {
        "id": "msg_1",
        "type": "message",
        "role": "assistant",
        "model": "qwen3:14b",
        "content": [{"type": "text", "text": "hello"}],
        "stop_reason": "end_turn",
        "usage": {"input_tokens": 2, "output_tokens": 3},
    }

    adapted = from_anthropic_compat(response, model="sonnet")
    data = adapted.model_dump()
    assert data["model"] == "sonnet"
    assert data["content"][0]["text"] == "hello"
    assert data["usage"]["input_tokens"] == 2
    assert data["usage"]["output_tokens"] == 3
    assert data["stop_reason"] == "end_turn"


def test_from_anthropic_compat_rejects_non_object_payload() -> None:
    with pytest.raises(HTTPException) as excinfo:
        from_anthropic_compat(["not", "a", "dict"], model="haiku")
    assert excinfo.value.status_code == 502
