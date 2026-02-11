from __future__ import annotations

import json
from pathlib import Path

from .utils import env_set, get_repo_context, run_manage


def test_setup_writes_claude_settings_json(monkeypatch) -> None:
    ctx = get_repo_context()
    settings_path = Path.home() / ".claude" / "settings.json"

    original_env = ctx.env_file.read_text()
    original_settings = settings_path.read_text() if settings_path.exists() else None

    try:
        # Ensure deterministic key + port for assertion.
        env_set(ctx.env_file, "PROFILE", "ollama-proxy")
        env_set(ctx.env_file, "CC_PROXY_PORT", "3456")
        env_set(ctx.env_file, "CC_PROXY_AUTH_KEY", "test-key-123")

        r = run_manage(["setup", "ollama-proxy"], timeout_s=30)
        assert r.returncode == 0, r.stderr or r.stdout

        assert settings_path.exists(), "Expected ~/.claude/settings.json to be written"
        data = json.loads(settings_path.read_text())
        env = data.get("env") or {}
        assert env.get("ANTHROPIC_BASE_URL") == "http://localhost:3456"
        assert env.get("ANTHROPIC_AUTH_TOKEN") == "test-key-123"
        assert env.get("ANTHROPIC_MODEL") == "sonnet"

    finally:
        run_manage(["proxy-stop"], timeout_s=8)
        ctx.env_file.write_text(original_env)
        if original_settings is None:
            settings_path.unlink(missing_ok=True)
        else:
            settings_path.write_text(original_settings)

