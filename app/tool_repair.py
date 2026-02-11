from __future__ import annotations

import hashlib
import json
import logging
from typing import Any


def _generate_tool_use_id(name: str, input_params: Any, position: int) -> str:
    try:
        input_str = json.dumps(input_params, sort_keys=True, separators=(",", ":"))
    except (TypeError, ValueError):
        input_str = str(input_params)
    hash_source = f"{name}:{input_str}:{position}"
    hash_hex = hashlib.sha256(hash_source.encode()).hexdigest()[:16]
    return f"toolu_{hash_hex}"


def repair_tool_use_blocks(
    content: list[Any],
    request_tools: list[dict[str, Any]] | None,
) -> tuple[list[Any], dict[str, int]]:
    logger = logging.getLogger("cc-proxy")
    stats = {
        "parsed_stringified_input": 0,
        "added_ids": 0,
        "dropped_invalid_tools": 0,
    }

    tool_name_set: set[str] | None = None
    if request_tools is not None:
        tool_name_set = set()
        for tool in request_tools:
            if not isinstance(tool, dict):
                continue
            name = str(tool.get("name") or "").strip().lower()
            if name:
                tool_name_set.add(name)

    repaired: list[Any] = []
    for idx, block in enumerate(content):
        if not isinstance(block, dict) or block.get("type") != "tool_use":
            repaired.append(block)
            continue

        tool_block = dict(block)
        tool_name = str(tool_block.get("name") or "").strip()

        input_value = tool_block.get("input")
        if isinstance(input_value, str):
            try:
                tool_block["input"] = json.loads(input_value)
                stats["parsed_stringified_input"] += 1
            except json.JSONDecodeError:
                logger.warning(
                    "Invalid JSON in tool_use input",
                    extra={"event": "tool.use.input.invalid_json", "tool_name": tool_name},
                )

        if not tool_block.get("id"):
            tool_block["id"] = _generate_tool_use_id(tool_name, tool_block.get("input"), idx)
            stats["added_ids"] += 1

        if tool_name_set is not None:
            if not tool_name or tool_name.lower() not in tool_name_set:
                stats["dropped_invalid_tools"] += 1
                repaired.append(
                    {"type": "text", "text": f"[Tool '{tool_name or 'unknown'}' not available]"}
                )
                continue

        repaired.append(tool_block)

    return repaired, stats
