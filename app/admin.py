"""Administrative command entrypoint."""

from __future__ import annotations

import argparse
from collections.abc import Sequence

import psycopg

from app.bank.fake import FakeBankAdapter
from app.bank.sync import sync_bank_transactions
from app.categories import DEFAULT_CATEGORIES
from app.config import AppConfig, load_config
from app.normalize import normalize_raw_transactions
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
    if config.bank_provider != "fake":
        raise NotImplementedError("Only the fake bank adapter is wired so far")

    account_iban = config.abn_account_iban or "NL00FAKE0123456789"
    result = sync_bank_transactions(config.database_url, FakeBankAdapter(), account_iban=account_iban)
    normalize_result = normalize_raw_transactions(config.database_url)
    print(
        "Synced "
        f"{result.provider}: {result.new_transaction_count} new, "
        f"{result.updated_transaction_count} updated, "
        f"{normalize_result.created_count} normalized"
    )


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m app.admin")
    parser.add_argument("command", choices=["seed-categories", "load-sample-data", "sync-now"])
    parser.add_argument("--database-url", default=None)
    args = parser.parse_args()

    config = load_config()
    database_url = args.database_url or config.database_url
    if not database_url:
        parser.error("DATABASE_URL or --database-url is required")
    config = AppConfig(
        app_env=config.app_env,
        secret_key=config.secret_key,
        database_url=database_url,
        http_host=config.http_host,
        http_port=config.http_port,
        allowed_emails=config.allowed_emails,
        oidc_enabled=config.oidc_enabled,
        oidc_client_secrets=config.oidc_client_secrets,
        oidc_scopes=config.oidc_scopes,
        oidc_testing_profile=config.oidc_testing_profile,
        oidc_cookie_secure=config.oidc_cookie_secure,
        llm_enabled=config.llm_enabled,
        llm_base_url=config.llm_base_url,
        llm_model=config.llm_model,
        llm_timeout_seconds=config.llm_timeout_seconds,
        llm_temperature=config.llm_temperature,
        bank_provider=config.bank_provider,
        abn_account_iban=config.abn_account_iban,
    )

    if args.command == "seed-categories":
        count = seed_categories(database_url)
        print(f"Seeded category taxonomy ({count} categories checked)")
        return

    if args.command == "load-sample-data":
        load_sample_data(database_url)
        print("Loaded deterministic sample data")
        return

    sync_now(config)


if __name__ == "__main__":
    main()
