from __future__ import annotations

import sys

from .utils import run_cmd, run_manage


def test_manage_help_includes_proxy_commands() -> None:
    r = run_manage(["--help"], timeout_s=10)
    assert r.returncode == 0, r.stderr or r.stdout
    assert "proxy-start" in r.stdout
    assert "proxy-stop" in r.stdout

    # Provider names are shown on the setup subcommand help.
    r_setup = run_manage(["setup", "--help"], timeout_s=10)
    assert r_setup.returncode == 0, r_setup.stderr or r_setup.stdout
    assert "ollama-proxy" in r_setup.stdout


def test_manage_py_compiles() -> None:
    r = run_cmd([sys.executable, "-m", "py_compile", "scripts/manage.py"], timeout_s=10)
    assert r.returncode == 0, r.stderr or r.stdout

