from __future__ import annotations

import json
import os

import httpx
import pytest

from app.main import app

from .conftest import load_jsonl_fixture, has_tool_use, has_tool_call_text
from .utils import assert_ollama_reachable

_FIXTURE_NAME = "tool_calling_sequence_pattern.jsonl"


def _make_payload(base: dict, model_name: str) -> dict:
    payload = dict(base)
    payload["model"] = model_name
    payload["stream"] = False
    payload["max_tokens"] = 4096
    return payload


def _prepare_sequence_payloads(model_name: str) -> tuple[dict, dict, dict]:
    entries = load_jsonl_fixture(_FIXTURE_NAME, min_entries=3)
    prompt_request_1 = entries[0]["body"]
    prompt_request_2 = entries[1]["body"]
    tools_request = entries[2]["body"]

    if not isinstance(tools_request, dict):
        raise AssertionError("Expected tools request body to be a JSON object")

    tools = tools_request.get("tools") or []
    if not isinstance(tools, list) or not tools:
        raise AssertionError("Tools request has no tools to test tool calling")

    payload_1 = _make_payload(prompt_request_1, model_name)
    payload_2 = _make_payload(prompt_request_2, model_name)

    primary_tool = tools[0].get("name") if isinstance(tools[0], dict) else None
    if not primary_tool:
        raise AssertionError("First tool entry is missing a name")

    tool_call_system = (
        "You must call the tool "
        f"{primary_tool} with {{\"region\":\"us-east-1\",\"resource_type\":\"product\"}}. "
        "Return only the tool call."
    )
    tool_payload = _make_payload(prompt_request_2, model_name)
    tool_payload["tools"] = tools
    tool_payload["system"] = list(tool_payload.get("system") or [])
    tool_payload["system"].append({"type": "text", "text": tool_call_system})

    return payload_1, payload_2, tool_payload


def _has_tool_use(payload: dict) -> bool:
    return has_tool_use(payload)


def _has_tool_call_text(payload: dict) -> bool:
    return has_tool_call_text(payload)


@pytest.mark.parametrize(
    "model_name",
    [(os.getenv("CC_PROXY_TOOL_CALL_MODEL") or "").strip() or "qwen3:4b"],
)
def test_tool_calling_sequence_pattern_direct(model_name: str) -> None:
    assert_ollama_reachable()

    payload_1, payload_2, tool_payload = _prepare_sequence_payloads(model_name)
    print("tool_calling_sequence_request_1:", json.dumps(payload_1, indent=2))

    response_1 = httpx.post(
        "http://host.docker.internal:11434/v1/messages",
        json=payload_1,
        headers={"anthropic-version": "2023-06-01"},
        timeout=180.0,
    )
    assert response_1.status_code == 200, f"Prompt request 1 failed: {response_1.status_code}"
    response_1_data = response_1.json()
    print("tool_calling_sequence_response_1:", json.dumps(response_1_data, indent=2))

    print("tool_calling_sequence_request_2:", json.dumps(payload_2, indent=2))
    response_2 = httpx.post(
        "http://host.docker.internal:11434/v1/messages",
        json=payload_2,
        headers={"anthropic-version": "2023-06-01"},
        timeout=180.0,
    )
    assert response_2.status_code == 200, f"Prompt request 2 failed: {response_2.status_code}"
    response_2_data = response_2.json()
    print("tool_calling_sequence_response_2:", json.dumps(response_2_data, indent=2))

    print("tool_calling_sequence_tool_request:", json.dumps(tool_payload, indent=2))

    tool_response = httpx.post(
        "http://host.docker.internal:11434/v1/messages",
        json=tool_payload,
        headers={"anthropic-version": "2023-06-01"},
        timeout=180.0,
    )
    assert tool_response.status_code == 200, f"Tool-call status {tool_response.status_code}"
    data = tool_response.json()
    print("tool_calling_sequence_tool_response:", json.dumps(data, indent=2))
    assert has_tool_use(data) or has_tool_call_text(data), (
        "Model ignored the tool-call instruction (no tool_use or <tool_call> output). "
        f"content={data.get('content')}"
    )


@pytest.mark.anyio
@pytest.mark.parametrize(
    "model_name",
    [(os.getenv("CC_PROXY_TOOL_CALL_MODEL") or "").strip() or "qwen3:4b"],
)
async def test_tool_calling_sequence_pattern_proxy(
    model_name: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    assert_ollama_reachable()

    payload_1, payload_2, tool_payload = _prepare_sequence_payloads(model_name)

    auth_key = "test-proxy-key"
    monkeypatch.setenv("CC_PROXY_AUTH_KEY", auth_key)
    headers = {"anthropic-version": "2023-06-01", "authorization": f"Bearer {auth_key}"}

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        print("tool_calling_sequence_request_1:", json.dumps(payload_1, indent=2))
        response_1 = await client.post(
            "/v1/messages",
            json=payload_1,
            headers=headers,
            timeout=60.0,
        )
        assert response_1.status_code == 200, f"Prompt request 1 failed: {response_1.status_code}"
        response_1_data = response_1.json()
        print("tool_calling_sequence_response_1:", json.dumps(response_1_data, indent=2))

        print("tool_calling_sequence_request_2:", json.dumps(payload_2, indent=2))
        response_2 = await client.post(
            "/v1/messages",
            json=payload_2,
            headers=headers,
            timeout=60.0,
        )
        assert response_2.status_code == 200, f"Prompt request 2 failed: {response_2.status_code}"
        response_2_data = response_2.json()
        print("tool_calling_sequence_response_2:", json.dumps(response_2_data, indent=2))

        print("tool_calling_sequence_tool_request:", json.dumps(tool_payload, indent=2))
        tool_response = await client.post(
            "/v1/messages",
            json=tool_payload,
            headers=headers,
            timeout=60.0,
        )
        assert tool_response.status_code == 200, f"Tool-call status {tool_response.status_code}"
        data = tool_response.json()
        print("tool_calling_sequence_tool_response:", json.dumps(data, indent=2))
        assert _has_tool_use(data) or _has_tool_call_text(data), (
            "Model ignored the tool-call instruction (no tool_use or <tool_call> output). "
            f"content={data.get('content')}"
        )
