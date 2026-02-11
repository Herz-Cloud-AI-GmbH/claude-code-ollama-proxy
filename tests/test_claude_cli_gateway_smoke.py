from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from pathlib import Path

import httpx
import pytest

from .utils import env_set, get_repo_context, run_manage, wait_for_health_ok


def _ollama_available() -> bool:
    try:
        r = httpx.get("http://host.docker.internal:11434/api/tags", timeout=2.0)
        return r.status_code == 200
    except httpx.RequestError:
        return False


@pytest.mark.skipif(shutil.which("claude") is None, reason="claude CLI not installed in this environment")
def test_claude_cli_uses_gateway_settings_no_login_prompt() -> None:
    if not _ollama_available():
        pytest.skip("Ollama not reachable on host.docker.internal:11434")
    ctx = get_repo_context()

    original_env = ctx.env_file.read_text()
    try:
        # Ensure proxy uses a deterministic key the CLI will send.
        env_set(ctx.env_file, "PROFILE", "ollama-proxy")
        env_set(ctx.env_file, "CC_PROXY_PORT", "3456")
        env_set(ctx.env_file, "CC_PROXY_AUTH_KEY", "smoke-key-123")

        # Start proxy and wait for readiness.
        r = run_manage(["proxy-start"], timeout_s=20)
        assert r.returncode == 0, r.stderr or r.stdout
        wait_for_health_ok(port=3456, timeout_s=6.0)

        # Use a temporary settings file so we do not mutate user settings.
        settings = {
            "env": {
                "ANTHROPIC_BASE_URL": "http://localhost:3456",
                "ANTHROPIC_AUTH_TOKEN": "smoke-key-123",
                "ANTHROPIC_MODEL": "sonnet",
            }
        }
        with tempfile.TemporaryDirectory() as td:
            settings_path = Path(td) / "settings.json"
            settings_path.write_text(json.dumps(settings) + "\n")

            try:
                proc = subprocess.run(
                    [
                        "claude",
                        "--settings",
                        str(settings_path),
                        "--setting-sources",
                        "user",
                        "-p",
                        "ping",
                        "--output-format",
                        "json",
                    ],
                    capture_output=True,
                    text=True,
                    timeout=8,
                    check=False,
                )
            except subprocess.TimeoutExpired as e:
                raise AssertionError("claude CLI timed out (likely prompting for login or stuck)") from e

            combined = (proc.stdout or "") + "\n" + (proc.stderr or "")
            assert "Select login method" not in combined
            assert proc.returncode == 0, combined

    finally:
        run_manage(["proxy-stop"], timeout_s=8)
        ctx.env_file.write_text(original_env)

