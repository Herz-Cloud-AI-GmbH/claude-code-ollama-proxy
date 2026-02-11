from __future__ import annotations

import json
import logging
import time
import uuid

from fastapi import FastAPI, Request, Response

from .request_context import set_request_id
from .routing import load_routing_config

_SENSITIVE_HEADERS = {"authorization", "x-api-key"}
_BODY_LOG_LIMIT = 10_000


def _redact_headers(headers: dict[str, str]) -> dict[str, str]:
    redacted: dict[str, str] = {}
    for key, value in headers.items():
        if key.lower() in _SENSITIVE_HEADERS:
            redacted[key] = "redacted"
        else:
            redacted[key] = value
    return redacted


def _format_body_for_log(body: bytes) -> dict[str, object]:
    text = body.decode("utf-8", errors="replace")
    truncated = False
    if len(text) > _BODY_LOG_LIMIT:
        text = text[:_BODY_LOG_LIMIT]
        truncated = True
    try:
        parsed = json.loads(text)
        return {"body": parsed, "truncated": truncated}
    except json.JSONDecodeError:
        return {"body": text, "truncated": truncated}


def install_request_logging_middleware(app: FastAPI) -> None:
    logger = logging.getLogger("cc-proxy")

    @app.middleware("http")
    async def _log_requests(request: Request, call_next):  # type: ignore[no-untyped-def]
        start = time.perf_counter()

        rid = request.headers.get("x-request-id") or request.headers.get("x-correlation-id") or str(uuid.uuid4())
        set_request_id(rid)

        client_ip = request.client.host if request.client else None
        path = request.url.path
        debug_logging = load_routing_config().debug_logging

        logger.info(
            "",
            extra={
                "event": "http.request.start",
                "request_id": rid,
                "method": request.method,
                "path": path,
                "client_ip": client_ip,
            },
        )
        if debug_logging.get("request_headers"):
            logger.info(
                "",
                extra={
                    "event": "http.request.headers",
                    "request_id": rid,
                    "meta": {"headers": _redact_headers(dict(request.headers))},
                },
            )

        if debug_logging.get("request_body"):
            body = await request.body()
            request._body = body
            logger.info(
                "",
                extra={
                    "event": "http.request.body",
                    "request_id": rid,
                    "meta": _format_body_for_log(body),
                },
            )

        try:
            response: Response = await call_next(request)
        except Exception:
            logger.exception(
                "",
                extra={
                    "event": "http.request.error",
                    "request_id": rid,
                    "method": request.method,
                    "path": path,
                    "client_ip": client_ip,
                },
            )
            set_request_id(None)
            raise
        response_headers_enabled = debug_logging.get(
            "response_headers", debug_logging.get("request_headers", False)
        )
        response_body_enabled = debug_logging.get(
            "response_body", debug_logging.get("request_body", False)
        )

        response_body_bytes: bytes | None = None
        if response_body_enabled:
            response_body_bytes = b""
            async for chunk in response.body_iterator:
                response_body_bytes += chunk
            response = Response(
                content=response_body_bytes,
                status_code=response.status_code,
                headers=dict(response.headers),
                media_type=response.media_type,
                background=response.background,
            )

        if response_headers_enabled:
            logger.info(
                "",
                extra={
                    "event": "http.response.headers",
                    "request_id": rid,
                    "meta": {"headers": _redact_headers(dict(response.headers))},
                },
            )
        if response_body_enabled and response_body_bytes is not None:
            logger.info(
                "",
                extra={
                    "event": "http.response.body",
                    "request_id": rid,
                    "meta": _format_body_for_log(response_body_bytes),
                },
            )

        # Don't leak request_id across requests
        set_request_id(None)

        duration_ms = (time.perf_counter() - start) * 1000.0
        logger.info(
            "",
            extra={
                "event": "http.request.end",
                "request_id": rid,
                "method": request.method,
                "path": path,
                "client_ip": client_ip,
                "status_code": response.status_code,
                "duration_ms": duration_ms,
            },
        )

        response.headers["X-Request-ID"] = rid
        return response

