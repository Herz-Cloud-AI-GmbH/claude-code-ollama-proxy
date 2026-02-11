from __future__ import annotations

from pathlib import Path


def test_dev_otelcol_config_has_expected_receivers_and_ports() -> None:
    """
    Keep this test lightweight: we don't parse YAML, we just assert the dev config
    contains the expected OTLP + health_check endpoints and a traces pipeline.
    """

    repo_root = Path(__file__).resolve().parents[2]
    cfg = (repo_root / "apps" / "otelcol-config.yaml").read_text()

    assert "receivers:" in cfg
    assert "otlp:" in cfg
    assert "grpc:" in cfg
    assert "4317" in cfg

    assert "extensions:" in cfg
    assert "health_check" in cfg
    assert "13133" in cfg

    assert "pipelines:" in cfg
    assert "traces:" in cfg
    assert "exporters:" in cfg
    assert "debug:" in cfg

