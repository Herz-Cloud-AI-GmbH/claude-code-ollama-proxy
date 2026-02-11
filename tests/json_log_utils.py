from __future__ import annotations

import json
from typing import Any


def parse_json_log_messages(messages: list[str]) -> list[dict[str, Any]]:
    """
    Parse a list of log messages where each message may (or may not) be JSON.

    Returns only the successfully parsed JSON objects.
    """

    out: list[dict[str, Any]] = []
    for msg in messages:
        try:
            parsed = json.loads(msg)
        except Exception:
            continue
        if isinstance(parsed, dict):
            out.append(parsed)
    return out


def parse_json_logs_from_caplog(caplog) -> list[dict[str, Any]]:
    """
    Convenience wrapper for pytest's caplog fixture.
    """

    return parse_json_log_messages([r.getMessage() for r in caplog.records])

