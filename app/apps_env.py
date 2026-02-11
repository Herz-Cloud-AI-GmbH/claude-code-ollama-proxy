from __future__ import annotations

from pathlib import Path

from dotenv import load_dotenv


def _detect_repo_root(start: Path) -> Path:
    for candidate in (start, *start.parents):
        if (candidate / "cc-proxy.yaml").exists():
            return candidate
    return start


def load_apps_env(*, repo_root: Path | None = None) -> Path:
    """
    Load runtime configuration from `.env`.

    - The file is gitignored (see `sample.env`).
    - We intentionally do NOT require callers to export env vars in their shell.
    - We do NOT introduce env-var-based path overrides; tests can pass repo_root.
    """

    if repo_root is None:
        repo_root = _detect_repo_root(Path(__file__).resolve().parent)

    env_path = repo_root / ".env"
    if env_path.exists():
        load_dotenv(env_path, override=False)
    return env_path

