from __future__ import annotations

from pathlib import Path

from app.routing import load_routing_config, resolve_model


def test_load_routing_config_uses_home_default_user_config(tmp_path: Path, monkeypatch) -> None:
    repo_root = tmp_path
    (repo_root / "cc-proxy.yaml").write_text(
        """
schema_version: 1
aliases:
  sonnet:
    promise:
      tool_calling: planned
"""
    )

    home_root = tmp_path / "home"
    home_user_dir = home_root / ".config" / "cc-proxy"
    home_user_dir.mkdir(parents=True)
    (home_user_dir / "cc-proxy.user.yaml").write_text(
        """
schema_version: 1
aliases:
  sonnet: qwen3:14b
"""
    )
    monkeypatch.setattr(Path, "home", lambda: home_root)

    cfg = load_routing_config(repo_root=repo_root)
    assert cfg.alias_to_model == {"sonnet": "qwen3:14b"}


def test_load_routing_config_ignores_repo_dot_cc_proxy_fallback(tmp_path: Path, monkeypatch) -> None:
    repo_root = tmp_path
    user_dir = repo_root / "legacy-user-config"
    user_dir.mkdir()

    (repo_root / "cc-proxy.yaml").write_text(
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
    home_user_dir = home_root / ".config" / "cc-proxy"
    home_user_dir.mkdir(parents=True)
    (home_user_dir / "cc-proxy.user.yaml").write_text(
        """
schema_version: 1
aliases:
  sonnet: qwen3:8b
"""
    )
    monkeypatch.setattr(Path, "home", lambda: home_root)

    cfg = load_routing_config(repo_root=repo_root)
    assert cfg.alias_to_model == {"sonnet": "qwen3:8b"}


def test_load_routing_config_respects_proxy_promises(tmp_path: Path) -> None:
    user_dir = tmp_path / "test-user-config"
    user_config_path = user_dir / "cc-proxy.user.yaml"
    user_dir.mkdir()

    (tmp_path / "cc-proxy.yaml").write_text(
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
    user_dir = tmp_path / "test-user-config"
    user_config_path = user_dir / "cc-proxy.user.yaml"
    user_dir.mkdir()

    (tmp_path / "cc-proxy.yaml").write_text(
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
    user_dir = tmp_path / "test-user-config"
    user_config_path = user_dir / "cc-proxy.user.yaml"
    user_dir.mkdir()

    (tmp_path / "cc-proxy.yaml").write_text(
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


def test_load_routing_config_uses_user_config_path_from_base_config(tmp_path: Path) -> None:
    configured_dir = tmp_path / "custom-config"
    configured_dir.mkdir()
    configured_user_config = configured_dir / "cc-proxy.user.yaml"
    configured_user_config.write_text(
        """
schema_version: 1
aliases:
  sonnet: qwen3:4b
"""
    )
    (tmp_path / "cc-proxy.yaml").write_text(
        """
schema_version: 1
user_config_path: custom-config/cc-proxy.user.yaml
aliases:
  sonnet:
    promise:
      tool_calling: planned
"""
    )

    cfg = load_routing_config(repo_root=tmp_path)
    assert cfg.alias_to_model == {"sonnet": "qwen3:4b"}
    assert cfg.user_config_path and cfg.user_config_path.endswith(
        "custom-config/cc-proxy.user.yaml"
    )
