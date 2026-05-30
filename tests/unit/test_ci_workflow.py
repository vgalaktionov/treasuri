from __future__ import annotations

from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]


def test_ci_workflow_runs_checks_before_publishing_image() -> None:
    workflow = (PROJECT_ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8")

    assert "npm ci" in workflow
    assert "npm run check" in workflow
    assert "npm run build" in workflow
    assert "npx playwright install --with-deps chromium" in workflow
    assert "npm run test:e2e" in workflow
    assert "needs: checks" in workflow
    assert "ghcr.io/${{ github.repository }}" in workflow
    assert "push: ${{ github.event_name == 'push' }}" in workflow
    assert "GIT_SHA=${{ github.sha }}" in workflow
    assert "type=sha,prefix=sha-" in workflow
