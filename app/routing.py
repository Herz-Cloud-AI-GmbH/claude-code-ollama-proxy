from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml


@dataclass(frozen=True)
class RoutingConfig:
    alias_to_model: dict[str, str]
    default_alias: str | None
    promises: dict[str, dict[str, Any]]
    debug_logging: dict[str, bool]
    thinking_capable_models: list[str]
    tool_calling_capable_models: list[str]
    verbose_tool_logging: bool
    tool_call_streaming_enabled: bool
    ollama_timeout_seconds: float | None


def _read_yaml(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    data = yaml.safe_load(path.read_text())
    return data if isinstance(data, dict) else {}


def load_routing_config(
    *,
    repo_root: Path | None = None,
    user_config_path: Path | None = None,
) -> RoutingConfig:
    if repo_root is None:
        repo_root = Path(__file__).resolve().parents[2]

    proxy_path = repo_root / "cc_proxy" / "cc-proxy.yaml"
    if user_config_path is None:
        home_path = Path.home() / ".cc-proxy" / "cc-proxy.user.yaml"
        repo_path = repo_root / ".cc-proxy" / "cc-proxy.user.yaml"
        user_path = home_path if home_path.exists() else repo_path
    else:
        user_path = user_config_path

    proxy_data = _read_yaml(proxy_path)
    user_data = _read_yaml(user_path)

    proxy_aliases = proxy_data.get("aliases", {}) or {}
    user_aliases = user_data.get("aliases", {}) or {}
    user_debug_logging = user_data.get("debug_logging", {}) or {}
    proxy_thinking_models = proxy_data.get("thinking_capable_models", []) or []
    proxy_tool_models = proxy_data.get("tool_calling_capable_models", []) or []
    proxy_verbose_tool_logging = proxy_data.get("verbose_tool_logging", False)
    user_verbose_tool_logging = user_data.get("verbose_tool_logging", None)
    proxy_tool_call_streaming = proxy_data.get("tool_call_streaming_enabled", False)
    user_tool_call_streaming = user_data.get("tool_call_streaming_enabled", None)
    user_timeout = user_data.get("ollama_timeout_seconds")

    alias_to_model: dict[str, str] = {}
    promises: dict[str, dict[str, Any]] = {}
    for alias, info in proxy_aliases.items():
        if alias in user_aliases:
            alias_to_model[alias] = str(user_aliases[alias]).strip()
        if isinstance(info, dict) and "promise" in info:
            promises[alias] = info["promise"] or {}

    debug_logging: dict[str, bool] = {}
    if isinstance(user_debug_logging, dict):
        for key in (
            "request_headers",
            "request_body",
            "response_headers",
            "response_body",
        ):
            if key in user_debug_logging:
                debug_logging[key] = bool(user_debug_logging[key])

    thinking_capable_models: list[str] = []
    if isinstance(proxy_thinking_models, list):
        for item in proxy_thinking_models:
            model_name = str(item).strip()
            if model_name:
                thinking_capable_models.append(model_name)

    tool_calling_capable_models: list[str] = []
    tool_models_source = proxy_tool_models
    if isinstance(user_data.get("tool_calling_capable_models"), list):
        tool_models_source = user_data.get("tool_calling_capable_models") or []
    if isinstance(tool_models_source, list):
        for item in tool_models_source:
            model_name = str(item).strip()
            if model_name:
                tool_calling_capable_models.append(model_name)

    verbose_tool_logging = bool(proxy_verbose_tool_logging)
    if user_verbose_tool_logging is not None:
        verbose_tool_logging = bool(user_verbose_tool_logging)

    tool_call_streaming_enabled = bool(proxy_tool_call_streaming)
    if user_tool_call_streaming is not None:
        tool_call_streaming_enabled = bool(user_tool_call_streaming)

    ollama_timeout_seconds: float | None = None
    if user_timeout is not None:
        try:
            value = float(user_timeout)
            if value > 0:
                ollama_timeout_seconds = value
        except (TypeError, ValueError):
            pass

    return RoutingConfig(
        alias_to_model=alias_to_model,
        default_alias=proxy_data.get("default_alias"),
        promises=promises,
        debug_logging=debug_logging,
        thinking_capable_models=thinking_capable_models,
        tool_calling_capable_models=tool_calling_capable_models,
        verbose_tool_logging=verbose_tool_logging,
        tool_call_streaming_enabled=tool_call_streaming_enabled,
        ollama_timeout_seconds=ollama_timeout_seconds,
    )


def resolve_model(requested: str, config: RoutingConfig) -> str:
    return config.alias_to_model.get(requested, requested)
