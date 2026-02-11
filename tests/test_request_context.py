from __future__ import annotations

import io
import json
import logging

from cc_proxy.app.observability import JsonLogFormatter, TraceContextFilter
from cc_proxy.app.request_context import get_request_id, set_request_id


def test_request_id_contextvar_roundtrip() -> None:
    set_request_id("r1")
    assert get_request_id() == "r1"
    set_request_id(None)
    assert get_request_id() is None


def test_trace_filter_injects_request_id_when_set() -> None:
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(JsonLogFormatter())
    handler.addFilter(TraceContextFilter())

    logger = logging.getLogger("cc-proxy-test-request-id")
    logger.handlers = [handler]
    logger.setLevel(logging.INFO)
    logger.propagate = False

    set_request_id("req-123")
    try:
        logger.info("x", extra={"event": "evt"})
    finally:
        set_request_id(None)

    payload = json.loads(stream.getvalue().strip())
    assert payload["request_id"] == "req-123"

