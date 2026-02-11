from __future__ import annotations

import httpx
import pytest
from fastapi import HTTPException

from cc_proxy.app.models_ollama import OpenAIChatCompletionsRequest
from cc_proxy.app.transport import OllamaClient


@pytest.mark.anyio
async def test_chat_openai_compat_success() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/chat/completions"
        return httpx.Response(
            200,
            json={
                "id": "chatcmpl-1",
                "model": "qwen3:14b",
                "choices": [
                    {"index": 0, "message": {"role": "assistant", "content": "hi"}, "finish_reason": "stop"}
                ],
                "usage": {"prompt_tokens": 1, "completion_tokens": 2, "total_tokens": 3},
            },
        )

    transport = httpx.MockTransport(handler)
    client = OllamaClient(base_url="http://ollama", transport=transport)
    req = OpenAIChatCompletionsRequest(
        model="qwen3:14b",
        messages=[{"role": "user", "content": "hello"}],
        max_tokens=8,
        stream=False,
    )
    resp = await client.chat_openai_compat(req)
    assert resp.choices[0].message.content == "hi"
    assert resp.usage and resp.usage.total_tokens == 3


@pytest.mark.anyio
async def test_chat_openai_compat_upstream_error() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="boom")

    transport = httpx.MockTransport(handler)
    client = OllamaClient(base_url="http://ollama", transport=transport)
    req = OpenAIChatCompletionsRequest(model="qwen3:14b", messages=[{"role": "user", "content": "hello"}])

    with pytest.raises(HTTPException) as excinfo:
        await client.chat_openai_compat(req)

    assert excinfo.value.status_code == 502


@pytest.mark.anyio
async def test_chat_openai_compat_connection_error() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("nope", request=request)

    transport = httpx.MockTransport(handler)
    client = OllamaClient(base_url="http://ollama", transport=transport)
    req = OpenAIChatCompletionsRequest(model="qwen3:14b", messages=[{"role": "user", "content": "hello"}])

    with pytest.raises(HTTPException) as excinfo:
        await client.chat_openai_compat(req)

    assert excinfo.value.status_code == 502
