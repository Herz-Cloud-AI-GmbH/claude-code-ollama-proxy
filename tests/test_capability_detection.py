from __future__ import annotations

import pytest

from cc_proxy.app.capability import get_tool_capability
from cc_proxy.app.routing import RoutingConfig


class _FakeClient:
    def __init__(self, response: dict | None = None) -> None:
        self.response = response or {}
        self.called = False

    async def show_model(self, model: str) -> dict:
        self.called = True
        return self.response


def _routing(tool_models: list[str]) -> RoutingConfig:
    return RoutingConfig(
        alias_to_model={},
        default_alias=None,
        promises={},
        debug_logging={},
        thinking_capable_models=[],
        tool_calling_capable_models=tool_models,
        verbose_tool_logging=False,
        tool_call_streaming_enabled=False,
        ollama_timeout_seconds=None,
    )


@pytest.mark.anyio
async def test_tool_capability_whitelist_precedence() -> None:
    client = _FakeClient(response={"capabilities": []})
    capability = await get_tool_capability(
        model="qwen3:8b", routing=_routing(["qwen3:8b"]), client=client
    )
    assert capability == "structured"
    assert client.called is False


@pytest.mark.anyio
async def test_tool_capability_uses_ollama_metadata() -> None:
    client = _FakeClient(response={"capabilities": ["tools"]})
    capability = await get_tool_capability(
        model="qwen3:8b", routing=_routing([]), client=client
    )
    assert capability == "structured"
    assert client.called is True
