from __future__ import annotations

from typing import Any, Literal, Union

from pydantic import BaseModel, ConfigDict, Field


class Message(BaseModel):
    model_config = ConfigDict(extra="allow")

    role: Literal["user", "assistant"] | str
    # Claude Code can send rich content blocks; for Phase 2 we accept anything.
    content: Any


class MessagesRequest(BaseModel):
    """
    Minimal subset of Anthropic Messages API request that Claude Code sends.
    Keep permissive for Phase 2; we only need `model` and `messages`.
    """

    model_config = ConfigDict(extra="allow")

    model: str
    messages: list[Message]
    max_tokens: int | None = None


class ContentBlockText(BaseModel):
    model_config = ConfigDict(extra="allow")

    type: Literal["text"] = "text"
    text: str


class ContentBlockThinking(BaseModel):
    model_config = ConfigDict(extra="allow")

    type: Literal["thinking"] = "thinking"
    thinking: str
    signature: str | None = None


class ContentBlockRedactedThinking(BaseModel):
    model_config = ConfigDict(extra="allow")

    type: Literal["redacted_thinking"] = "redacted_thinking"
    data: str


class ContentBlockToolUse(BaseModel):
    model_config = ConfigDict(extra="allow")

    type: Literal["tool_use"] = "tool_use"
    id: str
    name: str
    input: Any


class ContentBlockToolResult(BaseModel):
    model_config = ConfigDict(extra="allow")

    type: Literal["tool_result"] = "tool_result"
    tool_use_id: str
    content: Any
    is_error: bool | None = None


class ContentBlockFallback(BaseModel):
    model_config = ConfigDict(extra="allow")

    type: str


ContentBlock = Union[
    ContentBlockText,
    ContentBlockThinking,
    ContentBlockRedactedThinking,
    ContentBlockToolUse,
    ContentBlockToolResult,
    ContentBlockFallback,
]


class Usage(BaseModel):
    model_config = ConfigDict(extra="allow")

    input_tokens: int = 0
    output_tokens: int = 0


class MessagesResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str | None = None
    type: Literal["message"] = "message"
    role: Literal["assistant"] = "assistant"
    model: str
    content: list[ContentBlock] = Field(default_factory=list)
    stop_reason: str | None = None
    stop_sequence: str | None = None
    usage: Usage = Field(default_factory=Usage)
