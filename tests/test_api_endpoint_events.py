from __future__ import annotations

import logging

from fastapi.testclient import TestClient
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from cc_proxy.app.models_ollama import OpenAIChatCompletionsResponse
from cc_proxy.app.transport import OllamaClient


def test_endpoint_enter_exit_events_logged_and_added_to_span(monkeypatch, caplog) -> None:
    monkeypatch.setenv("CC_PROXY_AUTH_KEY", "k-endpoint")

    async def fake_chat(self, request) -> OpenAIChatCompletionsResponse:
        return OpenAIChatCompletionsResponse.model_validate(
            {
                "id": "chatcmpl-auth",
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": "ok"},
                        "finish_reason": "stop",
                    }
                ],
                "usage": {"prompt_tokens": 1, "completion_tokens": 1},
            }
        )

    monkeypatch.setattr(OllamaClient, "chat_openai_compat", fake_chat)

    exporter = InMemorySpanExporter()
    provider = trace.get_tracer_provider()
    if not isinstance(provider, TracerProvider):
        try:
            trace.set_tracer_provider(TracerProvider())
            provider = trace.get_tracer_provider()
        except Exception:
            provider = trace.get_tracer_provider()

    if isinstance(provider, TracerProvider):
        provider.add_span_processor(SimpleSpanProcessor(exporter))

    from cc_proxy.app.main import app

    client = TestClient(app)
    payload = {"model": "sonnet", "messages": [{"role": "user", "content": "hi"}]}

    with caplog.at_level(logging.INFO, logger="cc-proxy"):
        r = client.post("/v1/messages", json=payload, headers={"x-api-key": "k-endpoint"})
    assert r.status_code == 200

    endpoint_events = [rec for rec in caplog.records if getattr(rec, "event", None) in ("endpoint.enter", "endpoint.exit")]
    assert any(getattr(rec, "endpoint", None) == "POST /v1/messages" for rec in endpoint_events)

    spans = exporter.get_finished_spans()
    if spans:
        event_names = {ev.name for s in spans for ev in s.events}
        assert "endpoint.enter" in event_names
        assert "endpoint.exit" in event_names

