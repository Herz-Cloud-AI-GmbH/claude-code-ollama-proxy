from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import Annotated, AsyncIterator

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import StreamingResponse

from .auth import auth_dependency
from .middleware_request_logging import install_request_logging_middleware
from .adapt_request import prepare_anthropic_payload
from .adapt_response import from_anthropic_compat, stream_from_anthropic_compat
from .capability import get_tool_capability
from .models_anthropic import MessagesRequest, MessagesResponse
from .observability import setup_observability, emit_span_event, LogEvent
from .routing import load_routing_config
from .settings import get_settings
from .transport import OllamaClient

setup_observability()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """
    Manage application lifespan: create and clean up shared resources.

    The OllamaClient is created once and reused for all requests,
    benefiting from connection pooling.
    """
    settings = get_settings()
    app.state.ollama_client = OllamaClient(
        base_url=settings.ollama_base_url,
        timeout_seconds=settings.ollama_timeout_seconds,
    )
    yield
    await app.state.ollama_client.close()


app = FastAPI(title="cc-proxy", version="0.0.0-phase0", lifespan=lifespan)
install_request_logging_middleware(app)

try:
    from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

    FastAPIInstrumentor.instrument_app(app)
except ImportError:
    # Instrumentation is best-effort; OpenTelemetry packages may not be installed.
    pass


@app.get("/health")
def health() -> dict[str, str]:
    logger = logging.getLogger("cc-proxy")
    endpoint = "GET /health"
    logger.info("", extra={"event": LogEvent.ENDPOINT_ENTER, "endpoint": endpoint})
    emit_span_event(LogEvent.ENDPOINT_ENTER, endpoint=endpoint)
    try:
        return {"status": "ok"}
    finally:
        logger.info("", extra={"event": LogEvent.ENDPOINT_EXIT, "endpoint": endpoint})
        emit_span_event(LogEvent.ENDPOINT_EXIT, endpoint=endpoint)


def _get_ollama_client(request: Request) -> OllamaClient:
    """
    Get the OllamaClient, preferring the lifespan-managed instance.

    Falls back to creating a new client if app.state.ollama_client is not set
    (e.g., when running tests without the full lifespan context).
    """
    if hasattr(request.app.state, "ollama_client"):
        return request.app.state.ollama_client
    # Fallback for tests that don't use the lifespan
    settings = get_settings()
    return OllamaClient(
        base_url=settings.ollama_base_url,
        timeout_seconds=settings.ollama_timeout_seconds,
    )


@app.post("/v1/messages", response_model=None)
async def messages(
    request: MessagesRequest,
    http_request: Request,
    _auth: Annotated[None, Depends(auth_dependency)],
    response: Response,
):
    logger = logging.getLogger("cc-proxy")
    endpoint = "POST /v1/messages"
    logger.info("", extra={"event": LogEvent.ENDPOINT_ENTER, "endpoint": endpoint})
    emit_span_event(LogEvent.ENDPOINT_ENTER, endpoint=endpoint)
    try:
        routing = load_routing_config()
        adapted, thinking_result, resolved_model = prepare_anthropic_payload(
            request, routing=routing
        )
        logger.info(
            "",
            extra={
                "event": LogEvent.MODEL_RESOLVED,
                "requested_model": request.model,
                "resolved_model": resolved_model,
            },
        )

        # Use lifespan-managed client for connection pooling
        client = _get_ollama_client(http_request)
        # Tools may not be defined on the model, so use getattr safely
        request_tools = getattr(request, "tools", None)
        if not isinstance(request_tools, list) or not request_tools:
            request_tools = None
        if request_tools:
            capability = await get_tool_capability(
                model=resolved_model, routing=routing, client=client
            )
            logger.info(
                "",
                extra={
                    "event": LogEvent.TOOL_CAPABILITY_DETECTED,
                    "model": resolved_model,
                    "capability": capability,
                },
            )
            if capability == "none":
                raise HTTPException(
                    status_code=400,
                    detail={
                        "error": {
                            "type": "invalid_request_error",
                            "message": f"Model '{resolved_model}' does not support tool calling",
                        }
                    },
                )

        # Handle streaming vs non-streaming
        is_streaming = adapted.get("stream", False)

        if is_streaming and request_tools and not routing.tool_call_streaming_enabled:
            logger.info(
                "Tool-call streaming blocked by configuration.",
                extra={
                    "event": LogEvent.STREAMING_TOOL_BLOCKED,
                    "model": resolved_model,
                },
            )
            raise HTTPException(
                status_code=400,
                detail={
                    "error": {
                        "type": "invalid_request_error",
                        "message": "Tool-call streaming is disabled. Retry with stream=false.",
                    }
                },
            )

        if is_streaming:
            logger.info("Streaming request detected.", extra={"event": "streaming.start"})
            chunk_iterator = client.chat_anthropic_compat_stream(adapted)
            sse_generator = stream_from_anthropic_compat(
                chunk_iterator,
                model=request.model,
                request_tools=request_tools,
            )

            if thinking_result.warning_needed:
                response.headers["X-CC-Proxy-Warning"] = "thinking_dropped"

            return StreamingResponse(
                sse_generator,
                media_type="text/event-stream",
                headers={
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive",
                },
            )

        # Non-streaming path (existing logic)
        upstream = await client.chat_anthropic_compat(adapted)

        if thinking_result.warning_needed:
            response.headers["X-CC-Proxy-Warning"] = "thinking_dropped"
            logger.info(
                "Thinking blocks dropped for non-capable model.",
                extra={
                    "event": LogEvent.THINKING_BLOCK_HANDLED,
                    "model": resolved_model,
                    "thinking_capable": thinking_result.thinking_capable,
                    "thinking_blocks": thinking_result.thinking_blocks,
                    "redacted_blocks": thinking_result.redacted_blocks,
                    "dropped_blocks": thinking_result.dropped_blocks,
                },
            )

        adapted_response, repair_stats = from_anthropic_compat(
            upstream, model=request.model, request_tools=request_tools
        )
        if repair_stats:
            warnings: list[str] = []
            if repair_stats.get("added_ids", 0) or repair_stats.get(
                "parsed_stringified_input", 0
            ):
                warnings.append("tool_use_repaired")
            if repair_stats.get("dropped_invalid_tools", 0):
                warnings.append("tool_use_dropped")
            if warnings:
                response.headers["X-CC-Proxy-Warning"] = ",".join(warnings)

            logger.info(
                "Tool use repairs applied.",
                extra={
                    "event": LogEvent.TOOL_USE_REPAIRED,
                    "added_ids": repair_stats.get("added_ids", 0),
                    "parsed_stringified_input": repair_stats.get(
                        "parsed_stringified_input", 0
                    ),
                    "dropped_invalid_tools": repair_stats.get("dropped_invalid_tools", 0),
                },
            )
            if repair_stats.get("dropped_invalid_tools", 0):
                logger.info(
                    "Tool use blocks dropped.",
                    extra={
                        "event": LogEvent.TOOL_USE_DROPPED,
                        "dropped_invalid_tools": repair_stats.get("dropped_invalid_tools", 0),
                    },
                )
            if routing.verbose_tool_logging:
                logger.debug(
                    "Tool use repair details.",
                    extra={
                        "event": LogEvent.TOOL_USE_REPAIR_DETAILS,
                        "stats": repair_stats,
                    },
                )
        return adapted_response
    finally:
        logger.info("", extra={"event": LogEvent.ENDPOINT_EXIT, "endpoint": endpoint})
        emit_span_event(LogEvent.ENDPOINT_EXIT, endpoint=endpoint)
