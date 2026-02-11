from __future__ import annotations

from .utils import ensure_proxy_stopped, run_manage, wait_for_health_ok


def test_cc_proxy_lifecycle_health() -> None:
    ensure_proxy_stopped()

    start = run_manage(["proxy-start"], timeout_s=20)
    assert start.returncode == 0, start.stderr or start.stdout

    wait_for_health_ok(port=3456, timeout_s=6.0)

    stop = run_manage(["proxy-stop"], timeout_s=8)
    assert stop.returncode == 0, stop.stderr or stop.stdout

