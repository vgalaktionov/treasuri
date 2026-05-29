"""Bank import service."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import date, timedelta

import psycopg
from psycopg import Connection

from app.bank.base import BankAdapter, BankMutation
from app.sanitize import sanitize_error_message


@dataclass(frozen=True)
class SyncResult:
    provider: str
    new_transaction_count: int
    updated_transaction_count: int
    skipped_old_transaction_count: int


def sync_bank_transactions(
    database_url: str,
    adapter: BankAdapter,
    *,
    account_iban: str,
    lookback_days: int | None = None,
    as_of: date | None = None,
) -> SyncResult:
    try:
        with psycopg.connect(database_url) as connection:
            with connection.transaction():
                account_id = _upsert_account(connection, adapter.provider, account_iban)
                new_count = 0
                updated_count = 0
                mutations = adapter.fetch_recent_mutations()
                mutations_to_insert = _filter_by_lookback(mutations, lookback_days=lookback_days, as_of=as_of)
                skipped_old_count = len(mutations) - len(mutations_to_insert)
                for mutation in mutations_to_insert:
                    inserted = _upsert_raw_transaction(connection, account_id, adapter.provider, mutation)
                    if inserted:
                        new_count += 1
                    else:
                        updated_count += 1
                _insert_completed_sync_run(
                    connection,
                    adapter.provider,
                    new_count,
                    updated_count,
                    lookback_days=lookback_days,
                    skipped_old_transaction_count=skipped_old_count,
                )
    except Exception as exc:
        try:
            _insert_failed_sync_run(database_url, adapter.provider, exc)
        except psycopg.Error:
            pass
        raise

    return SyncResult(
        provider=adapter.provider,
        new_transaction_count=new_count,
        updated_transaction_count=updated_count,
        skipped_old_transaction_count=skipped_old_count,
    )


def _filter_by_lookback(
    mutations: list[BankMutation],
    *,
    lookback_days: int | None,
    as_of: date | None,
) -> list[BankMutation]:
    if lookback_days is None:
        return mutations
    if lookback_days < 1:
        raise ValueError("lookback_days must be at least 1")
    cutoff = (as_of or date.today()) - timedelta(days=lookback_days)
    return [mutation for mutation in mutations if mutation.booking_date >= cutoff]


def _upsert_account(connection: Connection[tuple[object, ...]], provider: str, iban: str) -> int:
    row = connection.execute(
        """
        INSERT INTO accounts (provider, iban, name, currency)
        VALUES (%s, %s, %s, 'EUR')
        ON CONFLICT (provider, iban)
        DO UPDATE SET updated_at = now()
        RETURNING id
        """,
        (provider, iban, f"{provider} current account"),
    ).fetchone()
    if row is None:
        raise RuntimeError("account upsert did not return an id")
    return _read_int_id(row[0])


def _upsert_raw_transaction(
    connection: Connection[tuple[object, ...]], account_id: int, provider: str, mutation: BankMutation
) -> bool:
    source_hash = build_source_hash(account_id, mutation)
    raw_payload_json = json.dumps(mutation.raw_payload, sort_keys=True)
    row = connection.execute(
        """
        INSERT INTO raw_transactions (
            account_id,
            provider,
            provider_transaction_id,
            source_hash,
            booking_date,
            value_date,
            amount,
            currency,
            counterparty_name,
            counterparty_iban,
            description,
            raw_payload_json
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
        ON CONFLICT (account_id, source_hash)
        DO UPDATE SET
            last_seen_at = now(),
            amount = EXCLUDED.amount,
            counterparty_name = EXCLUDED.counterparty_name,
            counterparty_iban = EXCLUDED.counterparty_iban,
            description = EXCLUDED.description,
            raw_payload_json = EXCLUDED.raw_payload_json
        RETURNING xmax = 0
        """,
        (
            account_id,
            provider,
            mutation.provider_transaction_id,
            source_hash,
            mutation.booking_date,
            mutation.value_date,
            mutation.amount,
            mutation.currency,
            mutation.counterparty_name,
            mutation.counterparty_iban,
            mutation.description,
            raw_payload_json,
        ),
    ).fetchone()
    if row is None:
        raise RuntimeError("raw transaction upsert did not return a result")
    return _read_bool(row[0])


def build_source_hash(account_id: int, mutation: BankMutation) -> str:
    if mutation.provider_transaction_id:
        stable_value = f"provider-id:{mutation.provider_transaction_id}"
    else:
        stable_value = "|".join(
            (
                str(account_id),
                mutation.booking_date.isoformat(),
                str(mutation.amount),
                mutation.counterparty_name or "",
                mutation.counterparty_iban or "",
                mutation.description,
            )
        )
    return hashlib.sha256(stable_value.encode("utf-8")).hexdigest()


def _insert_completed_sync_run(
    connection: Connection[tuple[object, ...]],
    provider: str,
    new_transaction_count: int,
    updated_transaction_count: int,
    *,
    lookback_days: int | None,
    skipped_old_transaction_count: int,
) -> None:
    connection.execute(
        """
        INSERT INTO sync_runs (
            provider,
            finished_at,
            status,
            new_transaction_count,
            updated_transaction_count,
            metadata_json
        )
        VALUES (%s, now(), 'completed', %s, %s, %s::jsonb)
        """,
        (
            provider,
            new_transaction_count,
            updated_transaction_count,
            json.dumps(
                {
                    "source": "bank-sync",
                    "lookback_days": lookback_days,
                    "skipped_old_transaction_count": skipped_old_transaction_count,
                },
                sort_keys=True,
            ),
        ),
    )


def _insert_failed_sync_run(database_url: str, provider: str, error: Exception) -> None:
    with psycopg.connect(database_url) as connection:
        with connection.transaction():
            connection.execute(
                """
                INSERT INTO sync_runs (
                    provider,
                    finished_at,
                    status,
                    error_message,
                    metadata_json
                )
                VALUES (%s, now(), 'failed', %s, %s::jsonb)
                """,
                (
                    provider,
                    _safe_error_message(error),
                    json.dumps({"source": "bank-sync"}, sort_keys=True),
                ),
            )


def _safe_error_message(error: Exception) -> str:
    return sanitize_error_message(error)


def _read_int_id(value: object) -> int:
    if not isinstance(value, int):
        raise RuntimeError(f"expected integer id, got {type(value).__name__}")
    return value


def _read_bool(value: object) -> bool:
    if not isinstance(value, bool):
        raise RuntimeError(f"expected boolean, got {type(value).__name__}")
    return value
