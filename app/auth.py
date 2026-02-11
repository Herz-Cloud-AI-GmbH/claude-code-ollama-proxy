from __future__ import annotations

import logging
import os

from fastapi import Header, HTTPException, Request
from opentelemetry import trace

from .observability import emit_span_event, LogEvent


def _expected_key() -> str:
    key = (os.getenv("CC_PROXY_AUTH_KEY") or "").strip()
    if not key:
        # Misconfiguration: treat as server error to avoid silently running open.
        raise HTTPException(status_code=500, detail="cc-proxy is not configured (CC_PROXY_AUTH_KEY missing)")
    return key


def require_auth(
    *,
    request: Request,
    authorization: str | None,
    x_api_key: str | None,
) -> None:
    """
    Accept either of the auth schemes Claude Code may use:
    - `Authorization: Bearer <key>`
    - `x-api-key: <key>`
    """

    logger = logging.getLogger("cc-proxy")
    span = trace.get_current_span()

    def log_event(level: str, event: str, **fields) -> None:
        extra = {"event": event, "method": request.method, "path": request.url.path, **fields}
        if level == "warning":
            logger.warning("", extra=extra)
        else:
            logger.info("", extra=extra)

        # Also attach to the current request span if available
        ctx = span.get_span_context()
        if ctx and ctx.is_valid:
            span.add_event(event, attributes={k: v for k, v in fields.items() if v is not None})

    log_event("info", "auth.start")

    try:
        expected = _expected_key()
    except HTTPException:
        log_event("warning", "auth.result", authorized=False, reason="misconfigured")
        raise

    # 1) Bearer token
    bearer_present = bool((authorization or "").strip())
    bearer_match = False
    if bearer_present:
        parts = (authorization or "").split(" ", 1)
        bearer_match = len(parts) == 2 and parts[0].lower() == "bearer" and parts[1].strip() == expected
    log_event("info", "auth.check.bearer", present=bearer_present, match=bearer_match)
    if bearer_match:
        log_event("info", "auth.result", authorized=True, reason="ok")
        return

    # 2) x-api-key
    x_present = bool((x_api_key or "").strip())
    x_match = x_present and (x_api_key or "").strip() == expected
    log_event("info", "auth.check.x_api_key", present=x_present, match=bool(x_match))
    if x_match:
        log_event("info", "auth.result", authorized=True, reason="ok")
        return

    log_event("warning", "auth.result", authorized=False, reason="mismatch")
    raise HTTPException(status_code=401, detail="Unauthorized")


def auth_dependency(
    request: Request,
    authorization: str | None = Header(default=None, alias="authorization"),
    x_api_key: str | None = Header(default=None, alias="x-api-key"),
) -> None:
    require_auth(request=request, authorization=authorization, x_api_key=x_api_key)
