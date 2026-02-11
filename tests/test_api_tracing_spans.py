from __future__ import annotations

from opentelemetry import trace
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace import TracerProvider


def test_fastapi_instrumentation_creates_http_server_span() -> None:
    exporter = InMemorySpanExporter()

    provider = trace.get_tracer_provider()
    if not isinstance(provider, TracerProvider):
        try:
            trace.set_tracer_provider(TracerProvider())
            provider = trace.get_tracer_provider()
        except Exception:
            return
    provider.add_span_processor(SimpleSpanProcessor(exporter))  # type: ignore[attr-defined]

    from fastapi.testclient import TestClient

    from cc_proxy.app.main import app

    client = TestClient(app)
    r = client.get("/health")
    assert r.status_code == 200

    spans = exporter.get_finished_spans()
    assert spans, "expected at least one finished span"

    # Look for a span with HTTP-ish attributes. Attribute keys vary across semantic conventions.
    def has_http_method(s) -> bool:
        attrs = dict(s.attributes or {})
        return ("http.method" in attrs) or ("http.request.method" in attrs)

    http_spans = [s for s in spans if has_http_method(s)]
    assert http_spans, f"no HTTP server span found; spans={[s.name for s in spans]}"

