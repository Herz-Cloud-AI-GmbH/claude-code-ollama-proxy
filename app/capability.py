from __future__ import annotations

import logging
from typing import Any

from .routing import RoutingConfig
from .transport import OllamaClient

_capability_cache: dict[str, str] = {}


def _normalize_capabilities(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip().lower() for item in value if str(item).strip()]


async def get_tool_capability(
    *,
    model: str,
    routing: RoutingConfig,
    client: OllamaClient,
) -> str:
    if model in routing.tool_calling_capable_models:
        return "structured"

    if model in _capability_cache:
        return _capability_cache[model]

    logger = logging.getLogger("cc-proxy")
    try:
        data = await client.show_model(model)
        capabilities = _normalize_capabilities(data.get("capabilities"))
        capability = "structured" if "tools" in capabilities else "none"
        _capability_cache[model] = capability
        return capability
    except Exception as exc:
        logger.warning(
            "Tool capability detection failed; defaulting to none.",
            extra={"event": "tool.capability.detect.failed", "model": model, "error": str(exc)},
        )
        return "none"
