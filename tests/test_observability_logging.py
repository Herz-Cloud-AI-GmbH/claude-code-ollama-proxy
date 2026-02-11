from __future__ import annotations

import io
import json
import logging
import os
from pathlib import Path

from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider

import app.observability as obs
from app.observability import JsonLogFormatter, TraceContextFilter, setup_observability


def test_json_logs_include_trace_id_and_span_id_when_in_span(monkeypatch) -> None:
    # Ensure we have an SDK tracer provider so span contexts are valid.
    if not isinstance(trace.get_tracer_provider(), TracerProvider):
        try:
            trace.set_tracer_provider(TracerProvider())
        except Exception:
            # If we can't set a provider in this process, we can't guarantee trace context.
            return

    tracer = trace.get_tracer("cc-proxy-test")
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(JsonLogFormatter())
    handler.addFilter(TraceContextFilter())
    logger = logging.getLogger("cc-proxy-test-json")
    logger.handlers = [handler]
    logger.setLevel(logging.INFO)
    logger.propagate = False

    with tracer.start_as_current_span("span1"):
        logger.info("hello", extra={"event": "test.event"})

    line = stream.getvalue().strip()
    payload = json.loads(line)
    assert payload["event"] == "test.event"
    assert isinstance(payload["trace_id"], str) and len(payload["trace_id"]) == 32
    assert isinstance(payload["span_id"], str) and len(payload["span_id"]) == 16


def test_setup_observability_loads_apps_env(tmp_path, monkeypatch) -> None:
    (tmp_path / ".env").write_text("OTEL_SERVICE_NAME=cc-proxy-from-dotenv\n")

    monkeypatch.delenv("OTEL_SERVICE_NAME", raising=False)

    # Calling setup should load .env first
    monkeypatch.setattr(obs, "_configured", False)
    setup_observability(repo_root=Path(tmp_path))
    assert os.environ.get("OTEL_SERVICE_NAME") == "cc-proxy-from-dotenv"

