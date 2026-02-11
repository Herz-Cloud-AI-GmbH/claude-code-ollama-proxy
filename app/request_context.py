from __future__ import annotations

from contextvars import ContextVar

_request_id_var: ContextVar[str | None] = ContextVar("cc_proxy_request_id", default=None)


def set_request_id(request_id: str | None) -> None:
    _request_id_var.set(request_id)


def get_request_id() -> str | None:
    return _request_id_var.get()

