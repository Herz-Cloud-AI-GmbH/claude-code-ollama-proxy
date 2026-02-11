from __future__ import annotations

import json
from pathlib import Path

from cc_proxy.app.tool_repair import repair_tool_use_blocks


def _load_fixture(name: str) -> dict:
    path = Path(__file__).resolve().parent / "fixtures" / name
    data = json.loads(path.read_text())
    if not isinstance(data, dict):
        raise AssertionError(f"Fixture {name} is not a JSON object")
    return data


def test_repair_parses_stringified_input() -> None:
    fixture = _load_fixture("tool_repair_stringified.json")
    repaired, stats = repair_tool_use_blocks(
        fixture["content"], fixture["tools"]
    )
    assert stats["parsed_stringified_input"] == 1
    assert repaired[0]["input"] == {"location": "Berlin"}


def test_repair_adds_missing_id() -> None:
    fixture = _load_fixture("tool_repair_missing_id.json")
    repaired, stats = repair_tool_use_blocks(
        fixture["content"], fixture["tools"]
    )
    assert stats["added_ids"] == 1
    assert repaired[0]["id"].startswith("toolu_")


def test_repair_drops_invalid_tool_name() -> None:
    fixture = _load_fixture("tool_repair_invalid_name.json")
    repaired, stats = repair_tool_use_blocks(
        fixture["content"], fixture["tools"]
    )
    assert stats["dropped_invalid_tools"] == 1
    assert repaired[0]["type"] == "text"
