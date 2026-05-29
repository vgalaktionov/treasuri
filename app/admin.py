"""Administrative command entrypoint."""

from __future__ import annotations

import argparse
from collections.abc import Sequence
from dataclasses import replace

import psycopg

from app.categories import DEFAULT_CATEGORIES
from app.config import AppConfig, load_config
from app.forecast.service import update_monthly_forecast
from app.jobs.enqueue import enqueue_sync_abn_transactions
from app.jobs.sync import run_sync_now
from app.recurring import detect_recurring
from app.sample_data import load_sample_data


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


def sync_now(config: AppConfig) -> None:
    print(run_sync_now(config).as_summary())


def with_database_url(config: AppConfig, database_url: str) -> AppConfig:
    return replace(config, database_url=database_url)


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m app.admin")
    parser.add_argument(
        "command",
        choices=[
            "seed-categories",
            "load-sample-data",
            "sync-now",
            "enqueue-sync",
            "update-forecast",
            "detect-recurring",
        ],
    )
    parser.add_argument("--database-url", default=None)
    args = parser.parse_args()

    config = load_config()
    database_url = args.database_url or config.database_url
    if not database_url:
        parser.error("DATABASE_URL or --database-url is required")
    config = with_database_url(config, database_url)

    if args.command == "seed-categories":
        count = seed_categories(database_url)
        print(f"Seeded category taxonomy ({count} categories checked)")
        return

    if args.command == "load-sample-data":
        load_sample_data(database_url)
        print("Loaded deterministic sample data")
        return

    if args.command == "update-forecast":
        result = update_monthly_forecast(database_url)
        print(f"Updated {result.year_month} forecast: safe to spend {result.safe_to_spend}")
        return

    if args.command == "detect-recurring":
        result = detect_recurring(database_url)
        print(f"Detected {result.detected_count} recurring series")
        return

    if args.command == "enqueue-sync":
        job_id = enqueue_sync_abn_transactions(database_url)
        print(f"Enqueued sync_abn_transactions job {job_id}")
        return

    sync_now(config)


if __name__ == "__main__":
    main()
