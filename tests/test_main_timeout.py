from __future__ import annotations

from cc_proxy.app import main


def test_ollama_timeout_prefers_explicit_seconds(monkeypatch) -> None:
    monkeypatch.setenv("OLLAMA_TIMEOUT_SECONDS", "45")
    monkeypatch.delenv("OLLAMA_LOAD_TIMEOUT", raising=False)
    assert main._ollama_timeout_seconds() == 45.0


def test_ollama_timeout_uses_load_timeout_duration(monkeypatch) -> None:
    monkeypatch.delenv("OLLAMA_TIMEOUT_SECONDS", raising=False)
    monkeypatch.setenv("OLLAMA_LOAD_TIMEOUT", "5m")
    assert main._ollama_timeout_seconds() == 300.0


def test_ollama_timeout_falls_back_on_invalid(monkeypatch) -> None:
    monkeypatch.delenv("OLLAMA_TIMEOUT_SECONDS", raising=False)
    monkeypatch.setenv("OLLAMA_LOAD_TIMEOUT", "0")
    assert main._ollama_timeout_seconds() == 300.0
