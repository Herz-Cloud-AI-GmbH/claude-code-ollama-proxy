from __future__ import annotations

import json
from pathlib import Path

from .utils import env_get, env_set, get_repo_context, run_manage, wait_for_health_ok


def test_setup_ollama_proxy_generates_key_and_starts_proxy() -> None:
    """
    Mirrors the repo workflow:
    - ensure placeholder key in `.devcontainer/.env`
    - run `scripts/manage.py setup ollama-proxy`
    - confirm the key was generated (placeholder replaced)
    - confirm /health is reachable
    - confirm setup writes `~/.claude/settings.json` pointing to the proxy

    This test restores `.devcontainer/.env` after it runs.
    """
    ctx = get_repo_context()
    if not ctx.env_file.exists():
        raise AssertionError(f"Expected env file to exist: {ctx.env_file}")

    original_env = ctx.env_file.read_text()
    settings_path = Path.home() / ".claude" / "settings.json"
    original_settings = settings_path.read_text() if settings_path.exists() else None
    try:
        env_set(ctx.env_file, "PROFILE", "ollama-proxy")
        env_set(ctx.env_file, "CC_PROXY_PORT", "3456")
        env_set(ctx.env_file, "CC_PROXY_AUTH_KEY", "your-cc-proxy-key")

        r = run_manage(["setup", "ollama-proxy"], timeout_s=30)
        assert r.returncode == 0, r.stderr or r.stdout

        # Key must have been generated.
        new_key = env_get(ctx.env_file, "CC_PROXY_AUTH_KEY")
        assert new_key, "CC_PROXY_AUTH_KEY missing after setup"
        assert new_key != "your-cc-proxy-key", "setup did not replace placeholder CC_PROXY_AUTH_KEY"

        assert settings_path.exists(), "Expected ~/.claude/settings.json to be written"
        data = json.loads(settings_path.read_text())
        env = data.get("env") or {}
        assert env.get("ANTHROPIC_BASE_URL") == "http://localhost:3456"
        assert env.get("ANTHROPIC_AUTH_TOKEN") == new_key

        wait_for_health_ok(port=3456, timeout_s=6.0)

    finally:
        run_manage(["proxy-stop"], timeout_s=8)
        ctx.env_file.write_text(original_env)
        if original_settings is None:
            settings_path.unlink(missing_ok=True)
        else:
            settings_path.write_text(original_settings)

