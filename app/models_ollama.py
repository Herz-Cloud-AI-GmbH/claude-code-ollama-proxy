from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict


class OpenAIMessage(BaseModel):
    model_config = ConfigDict(extra="allow")

    role: Literal["system", "user", "assistant"] | str
    content: str | None = None


class OpenAIChatCompletionsRequest(BaseModel):
    """
    Minimal OpenAI-compat request shape used by Ollama `/v1/chat/completions`.
    """

    model_config = ConfigDict(extra="allow")

    model: str
    messages: list[OpenAIMessage]
    temperature: float | None = None
    max_tokens: int | None = None
    stream: bool = False


class OpenAIChoice(BaseModel):
    model_config = ConfigDict(extra="allow")

    index: int = 0
    message: OpenAIMessage
    finish_reason: str | None = None


class OpenAIUsage(BaseModel):
    model_config = ConfigDict(extra="allow")

    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None


class OpenAIChatCompletionsResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str | None = None
    model: str | None = None
    choices: list[OpenAIChoice]
    usage: OpenAIUsage | None = None
