from __future__ import annotations

import logging

from .json_log_utils import parse_json_logs_from_caplog


def test_parse_json_logs_from_caplog(caplog) -> None:
    logger = logging.getLogger("cc-proxy-test-json-logs")
    with caplog.at_level(logging.INFO):
        logger.info('{"event":"one","n":1}')
        logger.info("not json")
        logger.info('{"event":"two","n":2}')

    parsed = parse_json_logs_from_caplog(caplog)
    assert [p["event"] for p in parsed] == ["one", "two"]

