from __future__ import annotations

import os

import httpx
import pytest


@pytest.mark.integration
def test_ollama_show_model_capabilities() -> None:
    model = (os.getenv("CC_PROXY_TOOL_CALL_MODEL") or "").strip() or "qwen3:8b"

    try:
        tags = httpx.get("http://host.docker.internal:11434/api/tags", timeout=3.0)
        tags.raise_for_status()
    except httpx.RequestError:
        pytest.skip("Ollama is not reachable")

    response = httpx.post(
        "http://host.docker.internal:11434/api/show",
        json={"model": model},
        timeout=10.0,
    )
    if response.status_code != 200:
        pytest.skip(f"Ollama model '{model}' not available for /api/show")

    data = response.json()
    capabilities = data.get("capabilities")
    assert isinstance(capabilities, list)
