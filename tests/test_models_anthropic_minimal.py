from __future__ import annotations

from cc_proxy.app.models_anthropic import ContentBlockText, MessagesRequest, MessagesResponse


def test_messages_request_parses_minimal_shape() -> None:
    req = MessagesRequest.model_validate(
        {
            "model": "sonnet",
            "messages": [{"role": "user", "content": "hello"}],
            "max_tokens": 16,
            "some_unknown_field": {"ok": True},
        }
    )
    assert req.model == "sonnet"
    assert req.max_tokens == 16
    assert req.messages[0].role == "user"
    assert req.messages[0].content == "hello"


def test_messages_response_serializes_text_block() -> None:
    resp = MessagesResponse(
        id="msg_123",
        model="sonnet",
        content=[ContentBlockText(text="hi")],
        stop_reason="end_turn",
    )
    data = resp.model_dump()
    assert data["type"] == "message"
    assert data["role"] == "assistant"
    assert data["model"] == "sonnet"
    assert data["content"][0]["type"] == "text"
    assert data["content"][0]["text"] == "hi"
    assert data["usage"]["input_tokens"] == 0
    assert data["usage"]["output_tokens"] == 0

