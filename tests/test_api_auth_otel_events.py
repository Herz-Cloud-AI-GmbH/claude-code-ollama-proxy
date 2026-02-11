from __future__ import annotations

import logging

from fastapi.testclient import TestClient
from opentelemetry import trace
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
import pytest
from opentelemetry.sdk.trace import TracerProvider

from cc_proxy.app.models_ollama import OpenAIChatCompletionsResponse
from cc_proxy.app.transport import OllamaClient


def _span_event_names(spans) -> set[str]:
    names: set[str] = set()
    for s in spans:
        for ev in s.events:
            names.add(ev.name)
    return names


def test_auth_emits_logs_and_span_events_on_mismatch(monkeypatch, caplog) -> None:
    monkeypatch.setenv("CC_PROXY_AUTH_KEY", "k-auth")

    exporter = InMemorySpanExporter()
    provider = trace.get_tracer_provider()
    if not isinstance(provider, TracerProvider):
        try:
            trace.set_tracer_provider(TracerProvider())
            provider = trace.get_tracer_provider()
        except Exception:
            pytest.skip("Cannot install SDK tracer provider in this process")
    provider.add_span_processor(SimpleSpanProcessor(exporter))  # type: ignore[attr-defined]

    from cc_proxy.app.main import app

    client = TestClient(app)
    payload = {"model": "sonnet", "messages": [{"role": "user", "content": "hi"}]}

    with caplog.at_level(logging.INFO, logger="cc-proxy"):
        r = client.post("/v1/messages", json=payload, headers={"Authorization": "Bearer wrong"})
    assert r.status_code == 401

    events = [getattr(rec, "event", None) for rec in caplog.records if hasattr(rec, "event")]
    assert "auth.start" in events
    assert "auth.check.bearer" in events
    assert "auth.check.x_api_key" in events
    assert "auth.result" in events

    spans = exporter.get_finished_spans()
    assert {"auth.start", "auth.check.bearer", "auth.check.x_api_key", "auth.result"}.issubset(
        _span_event_names(spans)
    )


def test_auth_emits_logs_and_span_events_on_x_api_key_success(monkeypatch, caplog) -> None:
    monkeypatch.setenv("CC_PROXY_AUTH_KEY", "k-ok")

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
            pytest.skip("Cannot install SDK tracer provider in this process")
    provider.add_span_processor(SimpleSpanProcessor(exporter))  # type: ignore[attr-defined]

    from cc_proxy.app.main import app

    client = TestClient(app)
    payload = {"model": "sonnet", "messages": [{"role": "user", "content": "hi"}]}

    with caplog.at_level(logging.INFO, logger="cc-proxy"):
        r = client.post("/v1/messages", json=payload, headers={"x-api-key": "k-ok"})
    assert r.status_code == 200

    # Ensure we logged an auth.result
    results = [rec for rec in caplog.records if getattr(rec, "event", None) == "auth.result"]
    assert results

    spans = exporter.get_finished_spans()
    assert "auth.result" in _span_event_names(spans)

