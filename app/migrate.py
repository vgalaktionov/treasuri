"""Hand-rolled, up-only SQL migration runner."""

from __future__ import annotations

import argparse
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, LiteralString, cast

import psycopg
from psycopg import Connection

from app.config import load_config

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MIGRATIONS_PATH = PROJECT_ROOT / "migrations"
MIGRATION_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
);
"""


@dataclass(frozen=True)
class Migration:
    version: str
    path: Path


class MigrationError(RuntimeError):
    """Raised when migration files or execution are invalid."""


def discover_migrations(migrations_path: Path = DEFAULT_MIGRATIONS_PATH) -> list[Migration]:
    if not migrations_path.exists():
        raise MigrationError(f"migrations directory does not exist: {migrations_path}")

    migrations = [Migration(path.stem, path) for path in sorted(migrations_path.glob("*.sql"))]
    versions = [migration.version for migration in migrations]
    if len(versions) != len(set(versions)):
        raise MigrationError("duplicate migration versions found")
    return migrations


def select_pending_migrations(migrations: Sequence[Migration], applied_versions: Iterable[str]) -> list[Migration]:
    applied = set(applied_versions)
    return [migration for migration in migrations if migration.version not in applied]


def read_applied_versions(connection: Connection[tuple[Any, ...]]) -> set[str]:
    connection.execute(MIGRATION_TABLE_SQL)
    rows = connection.execute("SELECT version FROM schema_migrations ORDER BY version")
    return {str(row[0]) for row in rows}


def apply_migration(connection: Connection[tuple[Any, ...]], migration: Migration) -> None:
    sql = migration.path.read_text(encoding="utf-8").strip()
    if not sql:
        raise MigrationError(f"migration is empty: {migration.path}")

    with connection.transaction():
        connection.execute(cast(LiteralString, sql))
        connection.execute("INSERT INTO schema_migrations (version) VALUES (%s)", (migration.version,))


def run_migrations(database_url: str, migrations_path: Path = DEFAULT_MIGRATIONS_PATH) -> list[str]:
    migrations = discover_migrations(migrations_path)
    applied_now: list[str] = []

    with psycopg.connect(database_url) as connection:
        applied_versions = read_applied_versions(connection)
        for migration in select_pending_migrations(migrations, applied_versions):
            apply_migration(connection, migration)
            applied_now.append(migration.version)

    return applied_now


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m app.migrate")
    parser.add_argument("--database-url", default=None)
    parser.add_argument("--migrations-path", type=Path, default=DEFAULT_MIGRATIONS_PATH)
    args = parser.parse_args()

    database_url = args.database_url or load_config().database_url
    if not database_url:
        parser.error("DATABASE_URL or --database-url is required")

    applied = run_migrations(database_url, args.migrations_path)
    if applied:
        print(f"Applied migrations: {', '.join(applied)}")
    else:
        print("No pending migrations")


if __name__ == "__main__":
    main()
