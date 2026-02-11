from __future__ import annotations

import time

import httpx
import pytest

from .utils import run_manage


def _wait_for_otelcol_health(timeout_s: float = 6.0) -> None:
    deadline = time.time() + timeout_s
    last_exc: Exception | None = None
    while time.time() < deadline:
        try:
            r = httpx.get("http://localhost:13133/", timeout=0.5)
            if r.status_code == 200:
                return
        except Exception as e:  # noqa: BLE001 - diagnostic only
            last_exc = e
        time.sleep(0.2)
    raise AssertionError(f"otelcol health never became ready: {last_exc}")


def test_otelcol_start_stop_lifecycle() -> None:
    """
    Integration test: start the dev OTel Collector and confirm health_check responds.
    """

    # If otelcol isn't installed in this container yet, skip (devcontainer not rebuilt).
    r_ver = run_manage(["otelcol-start"], timeout_s=15)
    if r_ver.returncode != 0 and "otelcol is not installed" in (r_ver.stdout + r_ver.stderr):
        pytest.skip("otelcol not installed in this container yet (rebuild devcontainer)")

    assert r_ver.returncode == 0, r_ver.stdout + "\n" + r_ver.stderr
    try:
        _wait_for_otelcol_health(timeout_s=8.0)
    finally:
        run_manage(["otelcol-stop"], timeout_s=10)

