from __future__ import annotations

"""
Compatibility shim.

The Phase 0 repo-integration tests have been split into focused modules:
- test_repo_makefile_help.py
- test_repo_manage_cli.py
- test_repo_proxy_lifecycle.py
- test_repo_setup_workflow.py

This file intentionally contains no tests and is kept only to avoid breaking any
external references to the old filename.
"""


def test_placeholder() -> None:
    # Keep at least one test so pytest doesn't warn about empty modules in some setups.
    assert True

