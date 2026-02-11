from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from cc_proxy.app.main import app


def test_returns_400_when_model_incapable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CC_PROXY_AUTH_KEY", "test-key")

    async def fake_capability(*args, **kwargs) -> str:
        return "none"

    monkeypatch.setattr("cc_proxy.app.main.get_tool_capability", fake_capability)

    client = TestClient(app)
    response = client.post(
        "/v1/messages",
        headers={"Authorization": "Bearer test-key"},
        json={
            "model": "sonnet",
            "max_tokens": 16,
            "messages": [{"role": "user", "content": "use tool"}],
            "tools": [
                {
                    "name": "get_weather",
                    "description": "Get weather",
                    "input_schema": {
                        "type": "object",
                        "properties": {"location": {"type": "string"}},
                        "required": ["location"],
                    },
                }
            ],
        },
    )

    assert response.status_code == 400
    data = response.json()
    assert data.get("detail", {}).get("error", {}).get("type") == "invalid_request_error"
