from __future__ import annotations

import copy
import json
import os
import time
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from cc_proxy.app.main import app


def _available_qwen_models() -> list[str]:
    try:
        resp = httpx.get("http://host.docker.internal:11434/api/tags", timeout=3.0)
        resp.raise_for_status()
    except httpx.RequestError as exc:
        raise AssertionError("Ollama is not reachable on host.docker.internal:11434") from exc
    data = resp.json()
    models = {
        item.get("name")
        for item in (data.get("models") or [])
        if isinstance(item, dict)
    }
    available = [name for name in ("qwen3:4b", "qwen3:8b", "qwen3:14b") if name in models]
    return available


def _load_claude_code_payload() -> dict[str, object]:
    path = Path(__file__).resolve().parent / "fixtures" / "claude_code_request.json"
    data = json.loads(path.read_text())
    if not isinstance(data, dict):
        raise AssertionError("Claude Code fixture is not a JSON object")
    payload = copy.deepcopy(data)
    payload["stream"] = False
    return payload


def test_ollama_qwen_response_times(monkeypatch, capsys) -> None:
    models = _available_qwen_models()
    if not models:
        pytest.skip("No qwen3:4b/8b/14b models found in Ollama")

    monkeypatch.setenv("CC_PROXY_AUTH_KEY", "perf-key")
    monkeypatch.setenv("OLLAMA_TIMEOUT_SECONDS", "30")

    max_seconds = float((os.getenv("MAX_MODEL_RESPONSE_SECONDS") or "").strip() or "20")

    client = TestClient(app)
    payload_base = _load_claude_code_payload()

    timings: dict[str, float] = {}
    for model in models:
        for mode, extra in (
            ("no_thinking", {}),
            ("thinking", {"thinking": {"type": "enabled", "budget_tokens": 1024}}),
        ):
            payload = dict(payload_base)
            payload["model"] = model
            payload.update(extra)

            start = time.perf_counter()
            response = client.post(
                "/v1/messages",
                json=payload,
                headers={"Authorization": "Bearer perf-key"},
            )
            elapsed = time.perf_counter() - start
            timings[f"{model}:{mode}"] = elapsed

            assert (
                response.status_code == 200
            ), f"{model} ({mode}) proxy response {response.status_code}"
            data = response.json()
            content = data.get("content") or []
            assert content, f"{model} ({mode}) returned no content blocks"
            assert (
                elapsed <= max_seconds
            ), f"{model} ({mode}) response time {elapsed:.2f}s > {max_seconds}s"

    for key, elapsed in sorted(timings.items()):
        print(f"{key}: {elapsed:.2f}s")

    captured = capsys.readouterr().out.strip()
    assert captured, "No performance timings printed"
