from __future__ import annotations

from pathlib import Path

import pytest

from app.migrate import (
    Migration,
    MigrationError,
    _connect_for_migrations,
    discover_migrations,
    select_pending_migrations,
)


def test_discover_migrations_returns_sorted_sql_files(tmp_path: Path) -> None:
    (tmp_path / "0002_second.sql").write_text("SELECT 2;", encoding="utf-8")
    (tmp_path / "0001_first.sql").write_text("SELECT 1;", encoding="utf-8")
    (tmp_path / "notes.txt").write_text("ignore me", encoding="utf-8")

    migrations = discover_migrations(tmp_path)

    assert [migration.version for migration in migrations] == ["0001_first", "0002_second"]


def test_discover_migrations_rejects_missing_directory(tmp_path: Path) -> None:
    with pytest.raises(MigrationError, match="does not exist"):
        discover_migrations(tmp_path / "missing")


def test_select_pending_migrations_skips_applied_versions(tmp_path: Path) -> None:
    migrations = [
        Migration("0001_initial", tmp_path / "0001_initial.sql"),
        Migration("0002_seed_categories", tmp_path / "0002_seed_categories.sql"),
    ]

    pending = select_pending_migrations(migrations, {"0001_initial"})

    assert [migration.version for migration in pending] == ["0002_seed_categories"]


def test_connect_for_migrations_retries_transient_startup_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    attempts = 0
    connection = object()

    def connect(_database_url: str) -> object:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            import psycopg

            raise psycopg.OperationalError("starting")
        return connection

    monkeypatch.setattr("app.migrate.psycopg.connect", connect)
    monkeypatch.setattr("app.migrate.time.sleep", lambda _seconds: None)

    assert _connect_for_migrations("postgresql://example", delay_seconds=0) is connection
    assert attempts == 2
