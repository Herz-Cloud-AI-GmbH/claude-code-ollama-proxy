from __future__ import annotations

import json
import logging
import os
import sys
from datetime import datetime, timezone
from typing import Any

from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

from .apps_env import load_apps_env
from .request_context import get_request_id

_configured = False


class LogEvent:
    """Constants for log event names used throughout cc-proxy."""

    # Endpoint lifecycle
    ENDPOINT_ENTER = "endpoint.enter"
    ENDPOINT_EXIT = "endpoint.exit"

    # HTTP request lifecycle (middleware)
    HTTP_REQUEST_START = "http.request.start"
    HTTP_REQUEST_END = "http.request.end"
    HTTP_REQUEST_ERROR = "http.request.error"

    # Authentication
    AUTH_START = "auth.start"
    AUTH_RESULT = "auth.result"
    AUTH_CHECK_BEARER = "auth.check.bearer"
    AUTH_CHECK_X_API_KEY = "auth.check.x_api_key"

    # Model/routing
    MODEL_RESOLVED = "model.resolved"

    # Thinking policy
    THINKING_BLOCK_HANDLED = "thinking.block_handled"

    # Tool calling
    TOOL_CAPABILITY_DETECTED = "tool.capability.detected"
    TOOL_USE_REPAIRED = "tool.use.repaired"
    TOOL_USE_DROPPED = "tool.use.dropped"
    TOOL_USE_REPAIR_DETAILS = "tool.use.repair.details"

    # Streaming
    STREAMING_TOOL_BLOCKED = "streaming.tool_blocked"


def emit_span_event(event_name: str, **attributes: Any) -> None:
    """
    Add an event to the current OpenTelemetry span if it's valid.

    This helper reduces boilerplate in endpoints by encapsulating the
    span context check pattern.

    Args:
        event_name: The event name (e.g., "endpoint.enter", "auth.result")
        **attributes: Key-value pairs to attach to the event
    """
    span = trace.get_current_span()
    ctx = span.get_span_context()
    if ctx and ctx.is_valid:
        # Filter out None values from attributes
        filtered = {k: v for k, v in attributes.items() if v is not None}
        span.add_event(event_name, attributes=filtered)


class TraceContextFilter(logging.Filter):
    """
    Inject OpenTelemetry trace context into log records.
    """

    def filter(self, record: logging.LogRecord) -> bool:  # noqa: A003 - logging API name
        span = trace.get_current_span()
        ctx = span.get_span_context()
        if ctx and ctx.is_valid:
            record.trace_id = f"{ctx.trace_id:032x}"
            record.span_id = f"{ctx.span_id:016x}"
        else:
            record.trace_id = None
            record.span_id = None

        # Also correlate by request_id if middleware set it for this context.
        if not hasattr(record, "request_id"):
            rid = get_request_id()
            if rid is not None:
                record.request_id = rid
        return True


class JsonLogFormatter(logging.Formatter):
    """
    One JSON object per line. Stable base fields + event-specific extras.
    """

    def format(self, record: logging.LogRecord) -> str:  # noqa: A003 - logging API name
        payload: dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat().replace("+00:00", "Z"),
            "level": record.levelname.lower(),
            "service": "cc-proxy",
            "event": getattr(record, "event", record.getMessage()),
            "trace_id": getattr(record, "trace_id", None),
            "span_id": getattr(record, "span_id", None),
        }

        # Optional common request fields (set via `extra={...}` by middleware/endpoints)
        for key in ("request_id", "method", "path", "client_ip", "status_code", "duration_ms"):
            if hasattr(record, key):
                payload[key] = getattr(record, key)

        # Attach error info if present
        if record.exc_info:
            payload["error"] = {"type": record.exc_info[0].__name__, "message": str(record.exc_info[1])}

        # Include any structured extras passed via `extra={"meta": {...}}`
        meta = getattr(record, "meta", None)
        if isinstance(meta, dict):
            payload["meta"] = meta

        return json.dumps(payload, separators=(",", ":"), ensure_ascii=False)


def setup_observability(*, repo_root=None) -> None:
    """
    Configure JSON logging with trace correlation, and load `.env` early.

    This function is intended to be called once at process startup.
    """

    global _configured
    if _configured:
        return

    # Load runtime config first (OpenTelemetry standard env vars live here).
    load_apps_env(repo_root=repo_root)

    # Minimal tracing setup (dev-friendly). If the process already configured a tracer
    # provider (e.g. tests), do not override it.
    if not isinstance(trace.get_tracer_provider(), TracerProvider):
        endpoint = (os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT") or "").strip()
        if endpoint:
            # OTLP gRPC exporter (Collector listens on :4317).
            from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter

            exporter = OTLPSpanExporter(endpoint=endpoint, insecure=endpoint.startswith("http://"))
            provider = TracerProvider()
            provider.add_span_processor(BatchSpanProcessor(exporter))
            trace.set_tracer_provider(provider)

    handler = logging.StreamHandler(stream=sys.stdout)
    handler.setFormatter(JsonLogFormatter())
    handler.addFilter(TraceContextFilter())

    root = logging.getLogger()
    root.setLevel(logging.INFO)
    root.addHandler(handler)

    _configured = True

