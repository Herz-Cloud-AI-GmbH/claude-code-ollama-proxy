from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Any

from .models_anthropic import MessagesRequest
from .models_ollama import OpenAIChatCompletionsRequest
from .routing import RoutingConfig, resolve_model


_DROP_FIELDS = {
    "thinking",
    "reasoning_effort",
    "metadata",
    "prompt_caching",
    "cache_control",
    "tools",
    "tool_choice",
}

_ANTHROPIC_DROP_FIELDS = {
    "metadata",
    "prompt_caching",
    "cache_control",
    "tool_choice",
}

_USE_TOOLS_PATTERN = re.compile(r"\buse_tools\b", re.IGNORECASE)
_TOOL_USE_SYSTEM_INSTRUCTION = "You must call a tool. Do not answer in natural language."


def to_openai_compat(request: MessagesRequest, *, resolved_model: str) -> OpenAIChatCompletionsRequest:
    payload = request.model_dump(exclude_none=True)
    for key in _DROP_FIELDS:
        payload.pop(key, None)

    messages = []
    for message in payload["messages"]:
        content = message.get("content")
        if isinstance(content, list):
            content = _flatten_content(content)
        elif not isinstance(content, str):
            content = ""
        messages.append({"role": message.get("role"), "content": content})

    return OpenAIChatCompletionsRequest(
        model=resolved_model,
        messages=messages,
        max_tokens=payload.get("max_tokens"),
        temperature=payload.get("temperature"),
        stream=False,
    )


def to_anthropic_compat(request: MessagesRequest, *, resolved_model: str) -> dict[str, Any]:
    payload = request.model_dump(exclude_none=True)
    for key in _ANTHROPIC_DROP_FIELDS:
        payload.pop(key, None)

    payload["model"] = resolved_model
    payload.setdefault("stream", False)

    messages = []
    for message in payload.get("messages", []):
        content = message.get("content")
        if not isinstance(content, (list, str)):
            content = ""
        normalized = dict(message)
        normalized["content"] = content
        messages.append(normalized)

    payload["messages"] = messages
    return payload


@dataclass(frozen=True)
class ThinkingPolicyResult:
    thinking_blocks: int
    redacted_blocks: int
    dropped_blocks: int
    thinking_capable: bool

    @property
    def warning_needed(self) -> bool:
        return self.dropped_blocks > 0


def apply_thinking_policy(
    payload: dict[str, Any], *, thinking_capable: bool
) -> tuple[dict[str, Any], ThinkingPolicyResult]:
    thinking_blocks = 0
    redacted_blocks = 0
    dropped_blocks = 0

    messages = payload.get("messages", [])
    if not isinstance(messages, list):
        return payload, ThinkingPolicyResult(0, 0, 0, thinking_capable)

    for message in messages:
        if not isinstance(message, dict):
            continue
        content = message.get("content")
        if not isinstance(content, list):
            continue

        kept: list[Any] = []
        for block in content:
            if not isinstance(block, dict):
                kept.append(block)
                continue
            block_type = block.get("type")
            if block_type == "thinking":
                thinking_blocks += 1
                if thinking_capable:
                    kept.append(block)
                else:
                    dropped_blocks += 1
                continue
            if block_type == "redacted_thinking":
                redacted_blocks += 1
                if thinking_capable:
                    kept.append(block)
                else:
                    dropped_blocks += 1
                continue
            kept.append(block)

        message["content"] = kept

    result = ThinkingPolicyResult(
        thinking_blocks=thinking_blocks,
        redacted_blocks=redacted_blocks,
        dropped_blocks=dropped_blocks,
        thinking_capable=thinking_capable,
    )
    return payload, result


def prepare_anthropic_payload(
    request: MessagesRequest, *, routing: RoutingConfig
) -> tuple[dict[str, Any], ThinkingPolicyResult, str]:
    resolved_model = resolve_model(request.model, routing)
    payload = to_anthropic_compat(request, resolved_model=resolved_model)
    use_tools_required = _apply_use_tools_marker(payload)
    if use_tools_required and payload.get("tools"):
        _ensure_tool_use_system_instruction(payload)
        payload.setdefault("temperature", 0)
    thinking_capable = resolved_model in routing.thinking_capable_models
    payload, result = apply_thinking_policy(payload, thinking_capable=thinking_capable)
    return payload, result, resolved_model


def _flatten_content(content: Any) -> str:
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""

    parts: list[str] = []
    for block in content:
        if not isinstance(block, dict):
            continue
        if block.get("type") != "text":
            continue
        text = str(block.get("text") or "").strip()
        if text:
            parts.append(text)

    return "\n\n".join(parts)


def _apply_use_tools_marker(payload: dict[str, Any]) -> bool:
    messages = payload.get("messages", [])
    if not isinstance(messages, list):
        return False
    found = False
    for message in messages:
        if not isinstance(message, dict):
            continue
        if message.get("role") != "user":
            continue
        content = message.get("content")
        if isinstance(content, str):
            updated, changed = _strip_use_tools_marker(content)
            if changed:
                message["content"] = updated
                found = True
            continue
        if not isinstance(content, list):
            continue
        updated_blocks: list[Any] = []
        changed_any = False
        for block in content:
            if not isinstance(block, dict) or block.get("type") != "text":
                updated_blocks.append(block)
                continue
            updated_text, changed = _strip_use_tools_marker(str(block.get("text") or ""))
            if changed:
                new_block = dict(block)
                new_block["text"] = updated_text
                updated_blocks.append(new_block)
                changed_any = True
            else:
                updated_blocks.append(block)
        if changed_any:
            message["content"] = updated_blocks
            found = True
    return found


def _strip_use_tools_marker(text: str) -> tuple[str, bool]:
    updated, count = _USE_TOOLS_PATTERN.subn("", text)
    if count == 0:
        return text, False
    return updated, True


def _ensure_tool_use_system_instruction(payload: dict[str, Any]) -> None:
    system = payload.get("system")
    if isinstance(system, str):
        blocks: list[dict[str, Any]] = [{"type": "text", "text": system}]
    elif isinstance(system, list):
        blocks = list(system)
    elif system is None:
        blocks = []
    else:
        blocks = [{"type": "text", "text": str(system)}]
    blocks.append({"type": "text", "text": _TOOL_USE_SYSTEM_INSTRUCTION})
    payload["system"] = blocks
