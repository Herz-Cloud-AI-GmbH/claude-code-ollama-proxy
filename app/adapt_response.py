from __future__ import annotations

import json
import logging
from typing import Any, AsyncIterator

from fastapi import HTTPException

from .models_anthropic import MessagesResponse
from .observability import LogEvent
from .tool_repair import repair_tool_use_blocks


def from_anthropic_compat(
    payload: dict[str, Any],
    *,
    model: str,
    request_tools: list[dict[str, Any]] | None = None,
) -> tuple[MessagesResponse, dict[str, int]]:
    if not isinstance(payload, dict):
        raise HTTPException(status_code=502, detail="Invalid Ollama response payload")

    normalized = dict(payload)
    normalized["model"] = model

    repair_stats: dict[str, int] = {}
    content = normalized.get("content")
    if not isinstance(content, list):
        normalized["content"] = []
    elif request_tools is not None:
        repaired, repair_stats = repair_tool_use_blocks(content, request_tools)
        normalized["content"] = repaired

    try:
        return MessagesResponse.model_validate(normalized), repair_stats
    except Exception as exc:  # pragma: no cover - defensive for upstream schema drift
        raise HTTPException(status_code=502, detail="Invalid Ollama response payload") from exc


async def stream_from_anthropic_compat(
    chunk_iterator: AsyncIterator[bytes],
    *,
    model: str,
    request_tools: list[dict[str, Any]] | None = None,
) -> AsyncIterator[str]:
    """
    Parse SSE stream from Ollama and re-emit as Anthropic-formatted SSE events.

    Handles:
    - SSE format parsing (data: {...})
    - Incomplete chunk buffering
    - Tool repair on complete tool_use blocks
    - Yields SSE-formatted lines
    """
    logger = logging.getLogger("cc-proxy")
    buffer = b""

    async for chunk in chunk_iterator:
        buffer += chunk
        lines = buffer.split(b"\n")

        # Keep last incomplete line in buffer
        buffer = lines[-1]

        for line in lines[:-1]:
            line_str = line.decode("utf-8", errors="replace").strip()

            # Skip empty lines
            if not line_str:
                continue

            data_str: str | None = None
            if line_str.startswith("data: "):
                data_str = line_str[6:].strip()
                if data_str == "[DONE]":
                    yield "data: [DONE]\n\n"
                    continue
            elif line_str.startswith("event:") or line_str.startswith("id:"):
                continue
            else:
                data_str = line_str

            if not data_str:
                continue

            try:
                event = json.loads(data_str)
            except json.JSONDecodeError:
                logger.warning(
                    "Skipping malformed streaming event line.",
                    extra={"event": "streaming.malformed_line"},
                )
                continue

            # Apply tool repair to content_block_start events with tool_use
            if (
                isinstance(event, dict)
                and event.get("type") == "content_block_start"
                and request_tools is not None
            ):
                content_block = event.get("content_block")
                if (
                    isinstance(content_block, dict)
                    and content_block.get("type") == "tool_use"
                ):
                    repaired, stats = repair_tool_use_blocks([content_block], request_tools)
                    if repaired:
                        event["content_block"] = repaired[0]
                    if stats:
                        logger.info(
                            "Tool use repairs applied (streaming).",
                            extra={
                                "event": LogEvent.TOOL_USE_REPAIRED,
                                "added_ids": stats.get("added_ids", 0),
                                "parsed_stringified_input": stats.get(
                                    "parsed_stringified_input", 0
                                ),
                                "dropped_invalid_tools": stats.get(
                                    "dropped_invalid_tools", 0
                                ),
                            },
                        )
                        if stats.get("dropped_invalid_tools", 0):
                            logger.info(
                                "Tool use blocks dropped (streaming).",
                                extra={
                                    "event": LogEvent.TOOL_USE_DROPPED,
                                    "dropped_invalid_tools": stats.get(
                                        "dropped_invalid_tools", 0
                                    ),
                                },
                            )

            # Re-emit as SSE
            yield f"data: {json.dumps(event, separators=(',', ':'), ensure_ascii=False)}\n\n"

    # Flush any remaining buffer (should be empty for well-formed SSE)
    if buffer.strip():
        logger.warning(
            "Trailing streaming buffer discarded.",
            extra={"event": "streaming.trailing_buffer"},
        )
