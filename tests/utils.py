from __future__ import annotations

import os
import signal
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

import httpx


@dataclass(frozen=True)
class RepoContext:
    root: Path
    manage: list[str]
    env_file: Path
    pid_file: Path


def get_repo_context() -> RepoContext:
    root = Path(__file__).resolve().parents[2]
    return RepoContext(
        root=root,
        manage=[sys.executable, str(root / "scripts" / "manage.py")],
        env_file=root / ".devcontainer" / ".env",
        pid_file=Path("/tmp/cc_proxy.pid"),
    )


def run_manage(args: list[str], *, timeout_s: float) -> subprocess.CompletedProcess[str]:
    ctx = get_repo_context()
    return subprocess.run(
        ctx.manage + args,
        cwd=str(ctx.root),
        capture_output=True,
        text=True,
        timeout=timeout_s,
        check=False,
    )


def run_cmd(args: list[str], *, timeout_s: float) -> subprocess.CompletedProcess[str]:
    ctx = get_repo_context()
    return subprocess.run(
        args,
        cwd=str(ctx.root),
        capture_output=True,
        text=True,
        timeout=timeout_s,
        check=False,
    )


def env_get(path: Path, key: str) -> str | None:
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        if k.strip() == key:
            return v.strip()
    return None


def env_set(path: Path, key: str, value: str) -> None:
    lines = path.read_text().splitlines()
    out: list[str] = []
    replaced = False
    for raw in lines:
        if raw.strip().startswith("#") or "=" not in raw:
            out.append(raw)
            continue
        k, _v = raw.split("=", 1)
        if k.strip() == key:
            out.append(f"{key}={value}")
            replaced = True
        else:
            out.append(raw)
    if not replaced:
        out.append(f"{key}={value}")
    path.write_text("\n".join(out) + "\n")


def best_effort_kill_pidfile() -> None:
    ctx = get_repo_context()
    try:
        if not ctx.pid_file.exists():
            return
        pid_raw = ctx.pid_file.read_text().strip()
        if not pid_raw.isdigit():
            return
        os.kill(int(pid_raw), signal.SIGTERM)
        time.sleep(0.5)
    except Exception:
        return
    finally:
        try:
            ctx.pid_file.unlink(missing_ok=True)
        except Exception:
            pass


def ensure_proxy_stopped() -> None:
    """
    Stop via manage.py; if that fails, fall back to PID-file kill.
    Never raises.
    """
    try:
        run_manage(["proxy-stop"], timeout_s=8)
    except Exception:
        best_effort_kill_pidfile()


def wait_for_health_ok(*, port: int = 3456, timeout_s: float = 6.0) -> None:
    deadline = time.time() + timeout_s
    last_err: Exception | None = None
    while time.time() < deadline:
        try:
            r = httpx.get(f"http://localhost:{port}/health", timeout=0.5)
            if r.status_code == 200 and r.json().get("status") == "ok":
                return
        except Exception as e:  # noqa: BLE001 - diagnostic only
            last_err = e
        time.sleep(0.2)
    raise AssertionError(f"cc-proxy /health never became ready: {last_err}")

