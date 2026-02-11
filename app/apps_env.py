from __future__ import annotations

from pathlib import Path

from dotenv import load_dotenv


def load_apps_env(*, repo_root: Path | None = None) -> Path:
    """
    Load runtime configuration from `cc_proxy/.env`.

    - The file is gitignored (see `cc_proxy/sample.env`).
    - We intentionally do NOT require callers to export env vars in their shell.
    - We do NOT introduce env-var-based path overrides; tests can pass repo_root.
    """

    if repo_root is None:
        repo_root = Path(__file__).resolve().parents[2]

    env_path = repo_root / "cc_proxy" / ".env"
    if env_path.exists():
        load_dotenv(env_path, override=False)
    return env_path

