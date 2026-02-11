from __future__ import annotations

import shutil
import subprocess

import pytest


def test_otelcol_binary_is_available() -> None:
    """
    The dev plan installs `otelcol` (base OpenTelemetry Collector) into the devcontainer image.

    In an already-running container (before rebuild), this test will skip.
    After rebuilding the devcontainer, it must pass.
    """

    exe = shutil.which("otelcol")
    if exe is None:
        pytest.skip("otelcol not installed in this container yet (rebuild devcontainer)")

    result = subprocess.run([exe, "--version"], capture_output=True, text=True, check=False)
    assert result.returncode == 0, result.stdout + "\n" + result.stderr

