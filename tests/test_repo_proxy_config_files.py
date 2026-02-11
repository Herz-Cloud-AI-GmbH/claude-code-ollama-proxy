from __future__ import annotations

from pathlib import Path

import yaml


def test_proxy_config_files_exist_and_parse() -> None:
    repo_root = Path(__file__).resolve().parents[1]
    proxy_config = repo_root / "cc-proxy.yaml"
    user_config = repo_root / "example" / "cc-proxy.user.yaml"

    assert proxy_config.exists()
    assert user_config.exists()

    proxy_data = yaml.safe_load(proxy_config.read_text())
    user_data = yaml.safe_load(user_config.read_text())

    assert proxy_data["schema_version"] == 1
    assert proxy_data["default_alias"] in proxy_data["aliases"]
    assert "sonnet" in proxy_data["aliases"]
    assert "sonnet" in user_data["aliases"]
