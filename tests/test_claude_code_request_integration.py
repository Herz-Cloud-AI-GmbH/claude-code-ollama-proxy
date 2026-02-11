from __future__ import annotations

import copy
import json
from pathlib import Path

import httpx
from fastapi.testclient import TestClient

from cc_proxy.app.adapt_request import prepare_anthropic_payload
from cc_proxy.app.main import app
from cc_proxy.app.models_anthropic import MessagesRequest
from cc_proxy.app.routing import load_routing_config


def _fixture_path(name: str) -> Path:
    return Path(__file__).resolve().parent / "fixtures" / name


def _load_fixture(name: str) -> dict[str, object]:
    data = json.loads(_fixture_path(name).read_text())
    if not isinstance(data, dict):
        raise AssertionError(f"Fixture {name} is not a JSON object")
    return data


def _adapt_request(payload: dict[str, object]) -> dict[str, object]:
    request = MessagesRequest.model_validate(copy.deepcopy(payload))
    routing = load_routing_config()
    adapted, _, _ = prepare_anthropic_payload(request, routing=routing)
    return adapted


def _assert_ollama_reachable() -> None:
    try:
        resp = httpx.get("http://host.docker.internal:11434/api/tags", timeout=3.0)
        resp.raise_for_status()
    except httpx.RequestError as exc:
        raise AssertionError("Ollama is not reachable on host.docker.internal:11434") from exc


def test_claude_code_request_dump_transformation(tmp_path) -> None:
    original = _load_fixture("claude_code_request.json")
    adapted = _adapt_request(original)

    output_path = tmp_path / "claude_code_request_modified.json"
    output_path.write_text(json.dumps(adapted, indent=2, sort_keys=True))

    assert output_path.read_text().strip() != ""


def test_claude_code_request_proxy_then_direct(monkeypatch) -> None:
    _assert_ollama_reachable()
    original = _load_fixture("claude_code_request.json")
    adapted = _adapt_request(original)

    monkeypatch.setenv("CC_PROXY_AUTH_KEY", "test-key")
    client = TestClient(app)
    proxy_resp = client.post(
        "/v1/messages",
        headers={"Authorization": "Bearer test-key"},
        json=original,
    )
    assert proxy_resp.status_code == 200, f"Proxy status {proxy_resp.status_code}"

    direct_resp = httpx.post(
        "http://host.docker.internal:11434/v1/messages",
        json=adapted,
        timeout=30.0,
    )
    assert direct_resp.status_code == 200, f"Direct status {direct_resp.status_code}"


def test_claude_code_request_proxy_only(monkeypatch) -> None:
    _assert_ollama_reachable()
    original = _load_fixture("claude_code_request.json")

    monkeypatch.setenv("CC_PROXY_AUTH_KEY", "test-key")
    client = TestClient(app)
    proxy_resp = client.post(
        "/v1/messages",
        headers={"Authorization": "Bearer test-key"},
        json=original,
    )
    assert proxy_resp.status_code == 200, f"Proxy status {proxy_resp.status_code}"
