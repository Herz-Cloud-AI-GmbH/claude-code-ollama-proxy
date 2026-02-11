from __future__ import annotations

import httpx
from fastapi import HTTPException
from typing import Any, AsyncIterator

from .models_ollama import OpenAIChatCompletionsRequest, OpenAIChatCompletionsResponse


class OllamaClient:
    """
    HTTP client for Ollama with connection pooling support.

    When used as a lifespan-managed resource, create once and call close()
    on shutdown to benefit from connection pooling across requests.
    """

    def __init__(
        self,
        *,
        base_url: str,
        timeout_seconds: float = 30.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._timeout_seconds = timeout_seconds
        self._transport = transport
        # Persistent client for connection pooling (created lazily)
        self._client: httpx.AsyncClient | None = None

    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create the persistent HTTP client."""
        if self._client is None:
            self._client = httpx.AsyncClient(
                timeout=self._timeout_seconds,
                transport=self._transport,
            )
        return self._client

    async def close(self) -> None:
        """Close the persistent HTTP client and release connections."""
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    async def chat_openai_compat(
        self, request: OpenAIChatCompletionsRequest
    ) -> OpenAIChatCompletionsResponse:
        url = f"{self._base_url}/v1/chat/completions"
        payload = request.model_dump(exclude_none=True)

        try:
            client = await self._get_client()
            response = await client.post(url, json=payload)
        except httpx.RequestError as exc:
            raise HTTPException(status_code=502, detail="Ollama connection failed") from exc

        if response.status_code >= 400:
            raise HTTPException(
                status_code=502,
                detail={"error": "Ollama upstream error", "status_code": response.status_code},
            )

        return OpenAIChatCompletionsResponse.model_validate(response.json())

    async def chat_anthropic_compat(self, payload: dict[str, Any]) -> dict[str, Any]:
        url = f"{self._base_url}/v1/messages"
        try:
            client = await self._get_client()
            response = await client.post(url, json=payload)
        except httpx.RequestError as exc:
            raise HTTPException(status_code=502, detail="Ollama connection failed") from exc

        if response.status_code >= 400:
            raise HTTPException(
                status_code=502,
                detail={"error": "Ollama upstream error", "status_code": response.status_code},
            )

        data = response.json()
        return data if isinstance(data, dict) else {}

    async def chat_anthropic_compat_stream(
        self, payload: dict[str, Any]
    ) -> AsyncIterator[bytes]:
        """
        Stream responses from Ollama's Anthropic-compatible endpoint.

        Yields raw bytes from the SSE stream which must be parsed by the caller.
        The stream format is Server-Sent Events (SSE) with 'data: {...}' lines.
        """
        url = f"{self._base_url}/v1/messages"
        try:
            client = await self._get_client()
            async with client.stream("POST", url, json=payload) as response:
                if response.status_code >= 400:
                    # Read error body before raising
                    error_body = await response.aread()
                    raise HTTPException(
                        status_code=502,
                        detail={
                            "error": "Ollama upstream error",
                            "status_code": response.status_code,
                            "body": error_body.decode("utf-8", errors="replace")[:500],
                        },
                    )

                async for chunk in response.aiter_bytes():
                    yield chunk

        except httpx.RequestError as exc:
            raise HTTPException(status_code=502, detail="Ollama connection failed") from exc

    async def show_model(self, model: str) -> dict[str, Any]:
        url = f"{self._base_url}/api/show"
        try:
            client = await self._get_client()
            response = await client.post(url, json={"model": model})
        except httpx.RequestError as exc:
            raise HTTPException(status_code=502, detail="Ollama connection failed") from exc

        if response.status_code >= 400:
            raise HTTPException(
                status_code=502,
                detail={"error": "Ollama upstream error", "status_code": response.status_code},
            )

        data = response.json()
        return data if isinstance(data, dict) else {}
