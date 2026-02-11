from __future__ import annotations

import os
from pathlib import Path

from app.apps_env import load_apps_env


def test_apps_sample_env_contains_required_keys() -> None:
    repo_root = Path(__file__).resolve().parents[1]
    sample = (repo_root / "sample.env").read_text()

    # OpenTelemetry standard env vars
    assert "OTEL_SERVICE_NAME=" in sample
    assert "OTEL_RESOURCE_ATTRIBUTES=" in sample
    assert "OTEL_EXPORTER_OTLP_ENDPOINT=" in sample
    assert "OTEL_TRACES_EXPORTER=" in sample
    assert "OTEL_METRICS_EXPORTER=" in sample
    assert "OTEL_LOGS_EXPORTER=" in sample


def test_load_apps_env_loads_apps_dotenv(tmp_path, monkeypatch) -> None:
    # Arrange a fake repo root with .env
    (tmp_path / ".env").write_text(
        "\n".join(
            [
                "OTEL_SERVICE_NAME=cc-proxy-test",
                "",
            ]
        )
    )

    # Ensure the environment is clean for the keys we set
    monkeypatch.delenv("OTEL_SERVICE_NAME", raising=False)

    loaded_path = load_apps_env(repo_root=tmp_path)
    assert loaded_path == tmp_path / ".env"

    # `python-dotenv` mutates os.environ
    assert os.environ.get("OTEL_SERVICE_NAME") == "cc-proxy-test"

