from __future__ import annotations

import json
import os
from pathlib import Path

from cc_proxy.app.adapt_request import prepare_anthropic_payload
from cc_proxy.app.models_anthropic import MessagesRequest
from cc_proxy.app.routing import load_routing_config

_FIXTURE_PATH = (
    Path(__file__).resolve().parent / "fixtures" / "tool_calling_sequence_pattern.jsonl"
)
_OUTPUT_PATH = (
    Path(__file__).resolve().parent
    / "fixtures"
    / "out"
    / "tool_calling_sequence_pattern_transformed.json"
)


def _load_fixture_entries() -> list[dict]:
    if not _FIXTURE_PATH.exists():
        raise AssertionError(f"{_FIXTURE_PATH} not found")
    entries: list[dict] = []
    for line in _FIXTURE_PATH.read_text(errors="ignore").splitlines():
        if not line.strip():
            continue
        entry = json.loads(line)
        if not isinstance(entry, dict):
            raise AssertionError("Fixture entries must be JSON objects")
        entries.append(entry)
    if len(entries) < 3:
        raise AssertionError("Fixture must contain at least three entries")
    return entries


def test_tool_calling_sequence_transform_dump() -> None:
    entries = _load_fixture_entries()
    prompt_request = entries[1].get("body")
    tools_request = entries[2].get("body")

    if not isinstance(prompt_request, dict):
        raise AssertionError("Expected prompt request body to be a JSON object")
    if not isinstance(tools_request, dict):
        raise AssertionError("Expected tools request body to be a JSON object")

    tools = tools_request.get("tools") or []
    if not isinstance(tools, list) or not tools:
        raise AssertionError("Tools request has no tools to test tool calling")

    request_body = dict(prompt_request)
    request_body["model"] = (os.getenv("CC_PROXY_TOOL_CALL_MODEL") or "").strip() or "qwen3:4b"
    request_body["tools"] = tools

    request = MessagesRequest.model_validate(request_body)
    adapted, _, _ = prepare_anthropic_payload(request, routing=load_routing_config())

    _OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    _OUTPUT_PATH.write_text(json.dumps(adapted, indent=2, sort_keys=True))

    assert _OUTPUT_PATH.exists()
    assert "use_tools" not in json.dumps(adapted).lower()
    system_blocks = adapted.get("system") or []
    assert any(
        isinstance(block, dict)
        and block.get("type") == "text"
        and "must call a tool" in str(block.get("text") or "").lower()
        for block in system_blocks
    )
