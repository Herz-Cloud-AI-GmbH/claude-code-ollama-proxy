from __future__ import annotations

import copy
import json
from pathlib import Path

from cc_proxy.app.adapt_request import prepare_anthropic_payload
from cc_proxy.app.models_anthropic import MessagesRequest


def _load_fixture(name: str) -> dict[str, object]:
    path = Path(__file__).resolve().parent / "fixtures" / name
    data = json.loads(path.read_text())
    if not isinstance(data, dict):
        raise AssertionError(f"Fixture {name} is not a JSON object")
    return data


def test_claude_code_fixture_adaptation() -> None:
    original = _load_fixture("claude_code_request.json")
    expected = _load_fixture("claude_code_request_modified.json")

    original_copy = copy.deepcopy(original)
    request = MessagesRequest.model_validate(original_copy)
    adapted, _, _ = prepare_anthropic_payload(
        request, routing=load_routing_config()
    )

    assert adapted == expected
    assert original == original_copy
    assert original.get("stream") is True
    assert "metadata" in original
