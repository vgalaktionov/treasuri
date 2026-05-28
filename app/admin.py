"""Administrative command entrypoint."""

from __future__ import annotations

import argparse
from collections.abc import Sequence

import psycopg

from app.categories import DEFAULT_CATEGORIES
from app.config import load_config


def seed_categories(database_url: str, categories: Sequence[str] = DEFAULT_CATEGORIES) -> int:
    inserted_or_existing = 0
    with psycopg.connect(database_url) as connection:
        with connection.transaction():
            for category in categories:
                connection.execute(
                    "INSERT INTO categories (name) VALUES (%s) ON CONFLICT (name) DO NOTHING", (category,)
                )
                inserted_or_existing += 1
    return inserted_or_existing


def sync_now() -> None:
    raise NotImplementedError("sync-now will be wired after the bank adapter and job queue slices")


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m app.admin")
    parser.add_argument("command", choices=["seed-categories", "sync-now"])
    parser.add_argument("--database-url", default=None)
    args = parser.parse_args()

    database_url = args.database_url or load_config().database_url
    if not database_url:
        parser.error("DATABASE_URL or --database-url is required")

    if args.command == "seed-categories":
        count = seed_categories(database_url)
        print(f"Seeded category taxonomy ({count} categories checked)")
        return

    sync_now()


if __name__ == "__main__":
    main()
