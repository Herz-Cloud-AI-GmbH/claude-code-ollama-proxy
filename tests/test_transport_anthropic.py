from __future__ import annotations

import json

import httpx
import pytest
from fastapi import HTTPException

from cc_proxy.app.transport import OllamaClient


@pytest.mark.anyio
async def test_chat_anthropic_compat_success() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/messages"
        payload = json.loads(request.content.decode("utf-8"))
        assert payload["model"] == "qwen3:14b"
        assert payload["messages"][0]["content"] == "hello"
        return httpx.Response(
            200,
            json={
                "id": "msg_1",
                "type": "message",
                "role": "assistant",
                "model": "qwen3:14b",
                "content": [{"type": "text", "text": "hi"}],
                "stop_reason": "end_turn",
                "usage": {"input_tokens": 1, "output_tokens": 2},
            },
        )

    transport = httpx.MockTransport(handler)
    client = OllamaClient(base_url="http://ollama", transport=transport)
    resp = await client.chat_anthropic_compat(
        {"model": "qwen3:14b", "messages": [{"role": "user", "content": "hello"}]}
    )
    assert resp["content"][0]["text"] == "hi"


@pytest.mark.anyio
async def test_chat_anthropic_compat_upstream_error() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="boom")

    transport = httpx.MockTransport(handler)
    client = OllamaClient(base_url="http://ollama", transport=transport)

    with pytest.raises(HTTPException) as excinfo:
        await client.chat_anthropic_compat({"model": "qwen3:14b", "messages": []})

    assert excinfo.value.status_code == 502


@pytest.mark.anyio
async def test_chat_anthropic_compat_connection_error() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("nope", request=request)

    transport = httpx.MockTransport(handler)
    client = OllamaClient(base_url="http://ollama", transport=transport)

    with pytest.raises(HTTPException) as excinfo:
        await client.chat_anthropic_compat({"model": "qwen3:14b", "messages": []})

    assert excinfo.value.status_code == 502
