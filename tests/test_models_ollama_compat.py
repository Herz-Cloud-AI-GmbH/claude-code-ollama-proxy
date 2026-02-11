from __future__ import annotations

from cc_proxy.app.models_ollama import (
    OpenAIChatCompletionsRequest,
    OpenAIChatCompletionsResponse,
    OpenAIMessage,
)


def test_openai_request_parses_minimal_shape() -> None:
    req = OpenAIChatCompletionsRequest.model_validate(
        {
            "model": "qwen3:14b",
            "messages": [{"role": "user", "content": "hello"}],
            "temperature": 0.2,
            "max_tokens": 64,
            "stream": False,
            "extra_field": "ok",
        }
    )
    assert req.model == "qwen3:14b"
    assert req.messages[0].role == "user"
    assert req.messages[0].content == "hello"
    assert req.temperature == 0.2
    assert req.max_tokens == 64
    assert req.stream is False


def test_openai_response_serializes_choice() -> None:
    resp = OpenAIChatCompletionsResponse(
        id="chatcmpl-123",
        model="qwen3:14b",
        choices=[{"index": 0, "message": OpenAIMessage(role="assistant", content="hi")}],
        usage={"prompt_tokens": 2, "completion_tokens": 3, "total_tokens": 5},
    )
    data = resp.model_dump()
    assert data["choices"][0]["message"]["role"] == "assistant"
    assert data["choices"][0]["message"]["content"] == "hi"
    assert data["usage"]["total_tokens"] == 5
