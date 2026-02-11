from __future__ import annotations

from pathlib import Path

from cc_proxy.app.routing import load_routing_config


def test_load_routing_config_reads_thinking_capable_models(tmp_path: Path) -> None:
    proxy_dir = tmp_path / "cc_proxy"
    user_dir = tmp_path / ".cc-proxy"
    proxy_dir.mkdir()
    user_dir.mkdir()

    (proxy_dir / "cc-proxy.yaml").write_text(
        """
schema_version: 1
default_alias: sonnet
thinking_capable_models:
  - qwen3:14b
  - qwen3:8b
"""
    )
    (user_dir / "cc-proxy.user.yaml").write_text("schema_version: 1\n")

    cfg = load_routing_config(repo_root=tmp_path)
    assert cfg.thinking_capable_models == ["qwen3:14b", "qwen3:8b"]
