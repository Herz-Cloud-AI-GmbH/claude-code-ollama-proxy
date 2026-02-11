from __future__ import annotations

from pathlib import Path

from cc_proxy.app.routing import load_routing_config, resolve_model


def test_load_routing_config_uses_repo_user_defaults(tmp_path: Path, monkeypatch) -> None:
    repo_root = tmp_path
    proxy_dir = repo_root / "cc_proxy"
    user_dir = repo_root / ".cc-proxy"
    proxy_dir.mkdir()
    user_dir.mkdir()

    (proxy_dir / "cc-proxy.yaml").write_text(
        """
schema_version: 1
aliases:
  sonnet:
    promise:
      tool_calling: planned
"""
    )
    (user_dir / "cc-proxy.user.yaml").write_text(
        """
schema_version: 1
aliases:
  sonnet: qwen3:14b
"""
    )

    home_root = tmp_path / "home"
    home_root.mkdir()
    monkeypatch.setattr(Path, "home", lambda: home_root)

    cfg = load_routing_config(repo_root=repo_root)
    assert cfg.alias_to_model == {"sonnet": "qwen3:14b"}


def test_load_routing_config_prefers_home_overrides(tmp_path: Path, monkeypatch) -> None:
    repo_root = tmp_path
    proxy_dir = repo_root / "cc_proxy"
    user_dir = repo_root / ".cc-proxy"
    proxy_dir.mkdir()
    user_dir.mkdir()

    (proxy_dir / "cc-proxy.yaml").write_text(
        """
schema_version: 1
aliases:
  sonnet:
    promise:
      tool_calling: planned
"""
    )
    (user_dir / "cc-proxy.user.yaml").write_text(
        """
schema_version: 1
aliases:
  sonnet: qwen3:14b
"""
    )

    home_root = tmp_path / "home"
    home_user_dir = home_root / ".cc-proxy"
    home_user_dir.mkdir(parents=True)
    home_override = home_user_dir / "cc-proxy.user.yaml"
    home_override.write_text(
        """
schema_version: 1
aliases:
  sonnet: qwen3:8b
"""
    )
    monkeypatch.setattr(Path, "home", lambda: home_root)

    try:
        cfg = load_routing_config(repo_root=repo_root)
        assert cfg.alias_to_model == {"sonnet": "qwen3:8b"}
    finally:
        home_override.unlink(missing_ok=True)


def test_load_routing_config_respects_proxy_promises(tmp_path: Path) -> None:
    proxy_dir = tmp_path / "cc_proxy"
    user_dir = tmp_path / ".cc-proxy"
    user_config_path = user_dir / "cc-proxy.user.yaml"
    proxy_dir.mkdir()
    user_dir.mkdir()

    (proxy_dir / "cc-proxy.yaml").write_text(
        """
schema_version: 1
default_alias: sonnet
aliases:
  sonnet:
    promise:
      tool_calling: planned
  haiku:
    promise:
      tool_calling: planned
"""
    )
    user_config_path.write_text(
        """
schema_version: 1
aliases:
  sonnet: qwen3:14b
  extra: qwen3:8b
"""
    )

    cfg = load_routing_config(repo_root=tmp_path, user_config_path=user_config_path)
    assert cfg.default_alias == "sonnet"
    assert cfg.alias_to_model == {"sonnet": "qwen3:14b"}
    assert "sonnet" in cfg.promises
    assert "haiku" in cfg.promises


def test_resolve_model_falls_back_to_requested(tmp_path: Path) -> None:
    proxy_dir = tmp_path / "cc_proxy"
    user_dir = tmp_path / ".cc-proxy"
    user_config_path = user_dir / "cc-proxy.user.yaml"
    proxy_dir.mkdir()
    user_dir.mkdir()

    (proxy_dir / "cc-proxy.yaml").write_text(
        """
schema_version: 1
aliases:
  sonnet:
    promise:
      tool_calling: planned
"""
    )
    user_config_path.write_text(
        """
schema_version: 1
aliases:
  sonnet: qwen3:14b
"""
    )

    cfg = load_routing_config(repo_root=tmp_path, user_config_path=user_config_path)
    assert resolve_model("sonnet", cfg) == "qwen3:14b"
    assert resolve_model("qwen3:8b", cfg) == "qwen3:8b"


def test_load_routing_config_reads_ollama_timeout(tmp_path: Path) -> None:
    proxy_dir = tmp_path / "cc_proxy"
    user_dir = tmp_path / ".cc-proxy"
    user_config_path = user_dir / "cc-proxy.user.yaml"
    proxy_dir.mkdir()
    user_dir.mkdir()

    (proxy_dir / "cc-proxy.yaml").write_text(
        """
schema_version: 1
aliases:
  sonnet:
    promise:
      tool_calling: planned
"""
    )
    user_config_path.write_text(
        """
schema_version: 1
ollama_timeout_seconds: 45
aliases:
  sonnet: qwen3:14b
"""
    )

    cfg = load_routing_config(repo_root=tmp_path, user_config_path=user_config_path)
    assert cfg.ollama_timeout_seconds == 45.0
