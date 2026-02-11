from __future__ import annotations

import os
from functools import lru_cache
from typing import Any


def parse_timeout_seconds(raw_value: str) -> float | None:
    """
    Parse a timeout value with optional unit suffix.

    Supports:
        - Plain numbers (interpreted as seconds): "30", "300.5"
        - Time unit suffixes: "100ms", "30s", "5m", "1h"

    Returns None if the value is empty, invalid, or non-positive.
    """
    if not raw_value:
        return None
    try:
        value = float(raw_value)
        return value if value > 0 else None
    except ValueError:
        pass

    units = {"ms": 0.001, "s": 1.0, "m": 60.0, "h": 3600.0}
    for suffix, multiplier in units.items():
        if raw_value.endswith(suffix):
            number = raw_value[: -len(suffix)].strip()
            try:
                value = float(number) * multiplier
                return value if value > 0 else None
            except ValueError:
                return None

    return None


class Settings:
    """
    Centralized configuration for cc-proxy.

    All settings are read from environment variables at access time,
    making them testable via monkeypatch.

    This class does not use pydantic-settings to avoid adding a dependency,
    but follows the same pattern of environment-based configuration.
    """

    @property
    def proxy_port(self) -> int:
        """Port for the cc-proxy server. Default: 3456"""
        raw = (os.getenv("CC_PROXY_PORT") or "").strip()
        try:
            return int(raw) if raw else 3456
        except ValueError:
            return 3456

    @property
    def ollama_base_url(self) -> str:
        """Base URL for Ollama. Default: http://host.docker.internal:11434"""
        return (os.getenv("OLLAMA_BASE_URL") or "http://host.docker.internal:11434").strip()

    @property
    def ollama_timeout_seconds(self) -> float:
        """
        Request timeout for Ollama in seconds.

        Reads from OLLAMA_TIMEOUT_SECONDS first, then OLLAMA_LOAD_TIMEOUT.
        Supports unit suffixes (ms, s, m, h). Default: 300.0
        """
        for env_var in ("OLLAMA_TIMEOUT_SECONDS", "OLLAMA_LOAD_TIMEOUT"):
            raw = (os.getenv(env_var) or "").strip()
            parsed = parse_timeout_seconds(raw)
            if parsed is not None:
                return parsed
        return 300.0

    @property
    def auth_key(self) -> str | None:
        """
        API key for authentication (CC_PROXY_AUTH_KEY).

        Returns None if not set (which should trigger a 500 error in auth).
        """
        raw = (os.getenv("CC_PROXY_AUTH_KEY") or "").strip()
        return raw if raw else None

    @property
    def otel_endpoint(self) -> str | None:
        """
        OpenTelemetry OTLP endpoint (OTEL_EXPORTER_OTLP_ENDPOINT).

        Returns None if not set.
        """
        raw = (os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT") or "").strip()
        return raw if raw else None


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """
    Get the singleton Settings instance.

    Note: lru_cache ensures we always return the same instance,
    but environment variables are still read at access time (via @property).
    """
    return Settings()
