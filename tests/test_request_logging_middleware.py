from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.testclient import TestClient

from cc_proxy.app.middleware_request_logging import install_request_logging_middleware
from cc_proxy.app.routing import RoutingConfig


def test_request_logging_middleware_emits_start_end_and_sets_header(caplog) -> None:
    app = FastAPI()
    install_request_logging_middleware(app)

    @app.get("/ping")
    def ping() -> dict[str, str]:
        return {"ok": "1"}

    client = TestClient(app)

    with caplog.at_level(logging.INFO, logger="cc-proxy"):
        r = client.get("/ping", headers={"X-Request-ID": "rid-1"})

    assert r.status_code == 200
    assert r.headers.get("X-Request-ID") == "rid-1"

    starts = [rec for rec in caplog.records if getattr(rec, "event", None) == "http.request.start"]
    ends = [rec for rec in caplog.records if getattr(rec, "event", None) == "http.request.end"]

    assert len(starts) == 1
    assert len(ends) == 1

    assert getattr(starts[0], "request_id", None) == "rid-1"
    assert getattr(ends[0], "request_id", None) == "rid-1"
    assert getattr(ends[0], "status_code", None) == 200


def test_request_logging_middleware_logs_headers_and_body_when_enabled(
    caplog, monkeypatch
) -> None:
    app = FastAPI()
    install_request_logging_middleware(app)

    @app.post("/ping")
    def ping() -> dict[str, str]:
        return {"ok": "1"}

    monkeypatch.setattr(
        "cc_proxy.app.middleware_request_logging.load_routing_config",
        lambda: RoutingConfig(
            alias_to_model={},
            default_alias=None,
            promises={},
            debug_logging={"request_headers": True, "request_body": True},
            thinking_capable_models=[],
            tool_calling_capable_models=[],
            verbose_tool_logging=False,
            tool_call_streaming_enabled=False,
            ollama_timeout_seconds=None,
        ),
    )

    client = TestClient(app)

    with caplog.at_level(logging.INFO, logger="cc-proxy"):
        client.post(
            "/ping",
            headers={"X-Request-ID": "rid-2", "Authorization": "Bearer secret"},
            json={"msg": "hello"},
        )

    headers_logs = [rec for rec in caplog.records if getattr(rec, "event", None) == "http.request.headers"]
    body_logs = [rec for rec in caplog.records if getattr(rec, "event", None) == "http.request.body"]

    assert len(headers_logs) == 1
    assert len(body_logs) == 1

    logged_headers = getattr(headers_logs[0], "meta", {}).get("headers", {})
    assert logged_headers.get("authorization") == "redacted"

    logged_body = getattr(body_logs[0], "meta", {}).get("body")
    assert logged_body == {"msg": "hello"}

