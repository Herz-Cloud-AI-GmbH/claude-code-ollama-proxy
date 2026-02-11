from __future__ import annotations

from .utils import run_cmd


def test_make_help_lists_proxy_targets() -> None:
    r = run_cmd(["make", "help"], timeout_s=10)
    assert r.returncode == 0, r.stderr or r.stdout
    assert "setup-ollama-proxy" in r.stdout
    assert "proxy-start" in r.stdout
    assert "proxy-stop" in r.stdout

