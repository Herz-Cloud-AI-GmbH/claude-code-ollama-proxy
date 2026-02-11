from __future__ import annotations

import json
import os

import httpx
import pytest

from .conftest import load_jsonl_fixture, has_tool_use, has_tool_call_text
from .utils import assert_ollama_reachable

_FIXTURE_NAME = "tool_calling_prompt_tools.jsonl"


def _find_prompt_request(entries: list[dict]) -> dict:
    for entry in entries:
        messages = entry.get("messages") or []
        if not isinstance(messages, list):
            continue
        if json.dumps(messages).lower().find("call the tool") != -1:
            return entry
    raise AssertionError("No forced tool-call prompt found in fixture")


def _find_tools_request(entries: list[dict]) -> dict:
    for entry in entries:
        tools = entry.get("tools")
        if isinstance(tools, list) and tools:
            return entry
    raise AssertionError("No request with tools found in fixture")


def _assert_ollama_reachable() -> None:
    assert_ollama_reachable()


def _load_fixture_entries() -> list[dict]:
    return load_jsonl_fixture(_FIXTURE_NAME, min_entries=1)


def _has_tool_use(payload: dict) -> bool:
    return has_tool_use(payload)


def _has_tool_call_text(payload: dict) -> bool:
    return has_tool_call_text(payload)


@pytest.mark.parametrize(
    "model_name",
    [(os.getenv("CC_PROXY_TOOL_CALL_MODEL") or "").strip() or "qwen3:4b"],
)
def test_tool_calling_emission_with_prompt_and_tools(model_name: str) -> None:
    _assert_ollama_reachable()

    entries = _load_fixture_entries()
    prompt_request = _find_prompt_request(entries)
    tools_request = _find_tools_request(entries)

    payload = dict(prompt_request)
    payload["model"] = model_name
    payload["tools"] = tools_request.get("tools") or []
    payload["stream"] = False
    payload["max_tokens"] = 256

    attempts = 3
    success = False
    last_content = None
    success_attempt = None
    for attempt in range(1, attempts + 1):
        response = httpx.post(
            "http://host.docker.internal:11434/v1/messages",
            json=payload,
            headers={"anthropic-version": "2023-06-01"},
            timeout=60.0,
        )
        assert response.status_code == 200, f"Direct tool-call status {response.status_code}"
        data = response.json()
        last_content = data.get("content")
        print(
            f"tool_calling_response attempt={attempt}:",
            json.dumps(last_content, indent=2),
        )
        if _has_tool_use(data) or _has_tool_call_text(data):
            success = True
            success_attempt = attempt
            break

    assert (
        success
    ), f"Direct tool-call missing tool_use/tool_call after {attempts} attempts. content={last_content}"
    if success_attempt and success_attempt > 1:
        print(
            f"WARNING: tool-call emission was flaky (succeeded on attempt {success_attempt})."
        )
