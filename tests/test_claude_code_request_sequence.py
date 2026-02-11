from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any

import httpx
import pytest

from cc_proxy.app.main import app

_FIXTURE_PATH = (
    Path(__file__).resolve().parent / "fixtures" / "claude_code_sequence_requests.jsonl"
)


def _load_sequence(path: Path) -> list[dict[str, Any]]:
    sequence: list[dict[str, Any]] = []
    for line in path.read_text(errors="ignore").splitlines():
        if not line.strip():
            continue
        payload = json.loads(line)
        if not isinstance(payload, dict):
            raise AssertionError("Sequence fixture entries must be JSON objects")
        sequence.append(payload)
    return sequence


def _assert_ollama_reachable() -> None:
    try:
        resp = httpx.get("http://host.docker.internal:11434/api/tags", timeout=3.0)
        resp.raise_for_status()
    except httpx.RequestError as exc:
        raise AssertionError("Ollama is not reachable on host.docker.internal:11434") from exc


@pytest.mark.anyio
async def test_claude_code_request_sequence(monkeypatch) -> None:
    if not _FIXTURE_PATH.exists():
        pytest.skip("Sequence fixture missing; expected claude_code_sequence_requests.jsonl")

    sequence = _load_sequence(_FIXTURE_PATH)
    if not sequence:
        pytest.skip("Sequence fixture is empty")

    _assert_ollama_reachable()

    monkeypatch.setenv("CC_PROXY_AUTH_KEY", "sequence-key")
    monkeypatch.setenv("OLLAMA_BASE_URL", "http://host.docker.internal:11434")
    monkeypatch.setenv("OLLAMA_TIMEOUT_SECONDS", "300")

    model_name = (os.getenv("CC_PROXY_SEQUENCE_MODEL") or "").strip() or "qwen3:4b"

    start = time.perf_counter()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        for index, payload in enumerate(sequence, start=1):
            request_payload = dict(payload)
            request_payload["model"] = model_name
            response = await client.post(
                "/v1/messages",
                json=request_payload,
                headers={"Authorization": "Bearer sequence-key"},
            )
            if response.status_code != 200:
                pytest.fail(
                    f"Sequence request {index} returned {response.status_code}"
                )

    elapsed = time.perf_counter() - start
    print(f"\n\nelapsed_seconds={elapsed:.2f}\n\n")
    if elapsed <= 60:
        print(
            f"\nINFO: system performance is good (<= 60 seconds) for model={model_name}.\n"
        )
    elif elapsed <= 120:
        print(f"\nWARNING: system is slow (61-120 seconds) for model={model_name}.\n")
    else:
        print(
            f"\nWARNING: system not suitable (> 120 seconds) for model={model_name}.\n"
        )
