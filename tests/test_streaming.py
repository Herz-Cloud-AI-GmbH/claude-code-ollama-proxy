from __future__ import annotations

import httpx
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from cc_proxy.app.adapt_response import stream_from_anthropic_compat
from cc_proxy.app.main import app
from cc_proxy.app.routing import RoutingConfig
from cc_proxy.app.transport import OllamaClient


pytestmark = pytest.mark.streaming


def _routing(*, tool_call_streaming_enabled: bool) -> RoutingConfig:
    return RoutingConfig(
        alias_to_model={},
        default_alias=None,
        promises={},
        debug_logging={},
        thinking_capable_models=[],
        tool_calling_capable_models=[],
        verbose_tool_logging=False,
        tool_call_streaming_enabled=tool_call_streaming_enabled,
        ollama_timeout_seconds=None,
    )


@pytest.fixture
def mock_streaming_client(monkeypatch):
    """Mock OllamaClient to return streaming responses."""

    async def fake_stream(self, payload):
        """Yield SSE chunks simulating Ollama streaming."""
        chunks = [
            b'data: {"type":"message_start","message":{"id":"msg_01","type":"message","role":"assistant","content":[],"model":"test","usage":{"input_tokens":10,"output_tokens":0}}}\n\n',
            b'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
            b'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\n',
            b'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}\n\n',
            b'data: {"type":"content_block_stop","index":0}\n\n',
            b'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}\n\n',
            b'data: {"type":"message_stop"}\n\n',
            b"data: [DONE]\n\n",
        ]
        for chunk in chunks:
            yield chunk

    monkeypatch.setattr(OllamaClient, "chat_anthropic_compat_stream", fake_stream)


def test_streaming_text_only_response(monkeypatch, mock_streaming_client):
    """Test streaming endpoint returns SSE format for text-only responses."""
    monkeypatch.setenv("CC_PROXY_AUTH_KEY", "test-key")

    client = TestClient(app)
    with client.stream(
        "POST",
        "/v1/messages",
        headers={"Authorization": "Bearer test-key"},
        json={
            "model": "sonnet",
            "max_tokens": 16,
            "messages": [{"role": "user", "content": "Hello"}],
            "stream": True,
        },
    ) as response:

        assert response.status_code == 200
        assert response.headers["content-type"] == "text/event-stream; charset=utf-8"
        assert "cache-control" in response.headers

        # Collect streamed chunks
        chunks = []
        for line in response.iter_lines():
            if line:
                chunks.append(line)

        # Verify we received SSE events
        assert len(chunks) > 0
        # At least one data: line should exist
        assert any(chunk.startswith("data: ") for chunk in chunks)


def test_streaming_with_tools_repair(monkeypatch):
    """Test streaming applies tool repair to tool_use blocks."""
    monkeypatch.setenv("CC_PROXY_AUTH_KEY", "test-key")
    monkeypatch.setattr(
        "cc_proxy.app.main.load_routing_config",
        lambda: _routing(tool_call_streaming_enabled=True),
    )

    async def fake_stream_with_tools(self, payload):
        """Yield SSE chunks with malformed tool_use (missing ID)."""
        chunks = [
            b'data: {"type":"message_start","message":{"id":"msg_01","type":"message","role":"assistant","content":[],"model":"test"}}\n\n',
            b'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","name":"get_weather","input":{"location":"Berlin"}}}\n\n',
            b'data: {"type":"content_block_stop","index":0}\n\n',
            b'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"}}\n\n',
            b'data: {"type":"message_stop"}\n\n',
            b"data: [DONE]\n\n",
        ]
        for chunk in chunks:
            yield chunk

    monkeypatch.setattr(OllamaClient, "chat_anthropic_compat_stream", fake_stream_with_tools)

    # Mock capability detection
    async def fake_capability(*args, **kwargs):
        return "structured"

    monkeypatch.setattr("cc_proxy.app.main.get_tool_capability", fake_capability)

    client = TestClient(app)
    with client.stream(
        "POST",
        "/v1/messages",
        headers={"Authorization": "Bearer test-key"},
        json={
            "model": "sonnet",
            "max_tokens": 16,
            "messages": [{"role": "user", "content": "What's the weather?"}],
            "tools": [
                {
                    "name": "get_weather",
                    "description": "Get weather",
                    "input_schema": {
                        "type": "object",
                        "properties": {"location": {"type": "string"}},
                    },
                }
            ],
            "stream": True,
        },
    ) as response:
        assert response.status_code == 200

        # Collect streamed chunks
        chunks = []
        for line in response.iter_lines():
            if line:
                chunks.append(line)

        # Verify tool_use block received repair (ID added)
        tool_use_chunks = [c for c in chunks if "tool_use" in c and "content_block" in c]
        assert len(tool_use_chunks) > 0
        # The repaired block should have an ID starting with "toolu_"
        assert any("toolu_" in chunk for chunk in tool_use_chunks)


def test_streaming_with_tools_blocked(monkeypatch):
    """Tool streaming should be rejected when feature flag is off."""
    monkeypatch.setenv("CC_PROXY_AUTH_KEY", "test-key")
    monkeypatch.setattr(
        "cc_proxy.app.main.load_routing_config",
        lambda: _routing(tool_call_streaming_enabled=False),
    )

    async def fake_capability(*args, **kwargs):
        return "structured"

    monkeypatch.setattr("cc_proxy.app.main.get_tool_capability", fake_capability)

    client = TestClient(app)
    response = client.post(
        "/v1/messages",
        headers={"Authorization": "Bearer test-key"},
        json={
            "model": "sonnet",
            "max_tokens": 16,
            "messages": [{"role": "user", "content": "What's the weather?"}],
            "tools": [
                {
                    "name": "get_weather",
                    "description": "Get weather",
                    "input_schema": {
                        "type": "object",
                        "properties": {"location": {"type": "string"}},
                    },
                }
            ],
            "stream": True,
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"]["error"]["type"] == "invalid_request_error"


def test_non_streaming_still_works(monkeypatch):
    """Test that non-streaming requests still work when stream=false."""
    monkeypatch.setenv("CC_PROXY_AUTH_KEY", "test-key")

    async def fake_chat(self, payload):
        return {
            "id": "msg_123",
            "type": "message",
            "role": "assistant",
            "content": [{"type": "text", "text": "Non-streaming response"}],
            "model": "test",
            "stop_reason": "end_turn",
            "usage": {"input_tokens": 10, "output_tokens": 5},
        }

    monkeypatch.setattr(OllamaClient, "chat_anthropic_compat", fake_chat)

    client = TestClient(app)
    response = client.post(
        "/v1/messages",
        headers={"Authorization": "Bearer test-key"},
        json={
            "model": "sonnet",
            "max_tokens": 16,
            "messages": [{"role": "user", "content": "Hello"}],
            "stream": False,
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["type"] == "message"
    assert data["content"][0]["text"] == "Non-streaming response"


@pytest.mark.anyio
async def test_stream_from_anthropic_compat_ndjson() -> None:
    async def _aiter():
        for line in [
            b'{"type":"message_start"}\n',
            b'{"type":"message_stop"}\n',
        ]:
            yield line

    events = [
        event
        async for event in stream_from_anthropic_compat(_aiter(), model="test")
    ]
    assert events == [
        'data: {"type":"message_start"}\n\n',
        'data: {"type":"message_stop"}\n\n',
    ]


@pytest.mark.anyio
async def test_streaming_transport_error_status() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, content=b"boom")

    transport = httpx.MockTransport(handler)
    client = OllamaClient(base_url="http://test", transport=transport)

    with pytest.raises(HTTPException):
        async for _ in client.chat_anthropic_compat_stream({"model": "m"}):
            pass


@pytest.mark.anyio
async def test_streaming_transport_connection_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("fail", request=request)

    transport = httpx.MockTransport(handler)
    client = OllamaClient(base_url="http://test", transport=transport)

    with pytest.raises(HTTPException):
        async for _ in client.chat_anthropic_compat_stream({"model": "m"}):
            pass
