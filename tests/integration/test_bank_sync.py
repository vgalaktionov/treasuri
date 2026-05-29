from __future__ import annotations

from collections.abc import Iterator
from datetime import date
from decimal import Decimal

import psycopg
import pytest
from testcontainers.postgres import PostgresContainer

from app.bank.abn import AbnAmroAdapter, AbnCredentials
from app.bank.base import BankMutation
from app.bank.fake import FakeBankAdapter
from app.bank.sync import sync_bank_transactions
from app.migrate import run_migrations


@pytest.fixture(scope="module")
def migrated_postgres_url() -> Iterator[str]:
    with PostgresContainer(
        image="postgres:16-alpine",
        username="treasuri",
        password="treasuri",
        dbname="treasuri",
        driver=None,
    ) as postgres:
        database_url = postgres.get_connection_url(driver=None)
        run_migrations(database_url)
        yield database_url


def test_fake_bank_sync_imports_raw_transactions_idempotently(migrated_postgres_url: str) -> None:
    first_result = sync_bank_transactions(
        migrated_postgres_url,
        FakeBankAdapter(),
        account_iban="NL00FAKE0123456789",
    )
    second_result = sync_bank_transactions(
        migrated_postgres_url,
        FakeBankAdapter(),
        account_iban="NL00FAKE0123456789",
    )

    with psycopg.connect(migrated_postgres_url) as connection:
        raw_count = connection.execute("SELECT count(*) FROM raw_transactions").fetchone()
        sync_counts = connection.execute(
            """
            SELECT new_transaction_count, updated_transaction_count
            FROM sync_runs
            WHERE metadata_json @> '{"source":"bank-sync"}'
            ORDER BY id
            """
        ).fetchall()

    assert first_result.new_transaction_count == 3
    assert first_result.updated_transaction_count == 0
    assert second_result.new_transaction_count == 0
    assert second_result.updated_transaction_count == 3
    assert raw_count == (3,)
    assert sync_counts == [(3, 0), (0, 3)]


def test_abn_adapter_imports_raw_transactions_idempotently(migrated_postgres_url: str) -> None:
    adapter = AbnAmroAdapter(
        AbnCredentials(
            account_iban="NL01ABNA0123456789",
            card_number="123",
            soft_token="12345",
        ),
        session_factory=StaticAbnSession,
    )

    first_result = sync_bank_transactions(migrated_postgres_url, adapter, account_iban="NL01ABNA0123456789")
    second_result = sync_bank_transactions(migrated_postgres_url, adapter, account_iban="NL01ABNA0123456789")

    with psycopg.connect(migrated_postgres_url) as connection:
        row = connection.execute(
            """
            SELECT
                accounts.provider,
                raw_transactions.provider_transaction_id,
                raw_transactions.amount,
                raw_transactions.counterparty_name,
                raw_transactions.counterparty_iban,
                raw_transactions.description,
                raw_transactions.raw_payload_json->>'mutationKey'
            FROM raw_transactions
            JOIN accounts ON accounts.id = raw_transactions.account_id
            WHERE raw_transactions.provider = 'abn_amro'
            """
        ).fetchone()

    assert first_result.provider == "abn_amro"
    assert first_result.new_transaction_count == 1
    assert first_result.updated_transaction_count == 0
    assert second_result.new_transaction_count == 0
    assert second_result.updated_transaction_count == 1
    assert row == (
        "abn_amro",
        "abn-test-1",
        Decimal("-25.50"),
        "Sample Cafe",
        "NL00ABNA0000000000",
        "Card payment Sample Cafe",
        "abn-test-1",
    )


def test_bank_sync_applies_configured_lookback_window(migrated_postgres_url: str) -> None:
    result = sync_bank_transactions(
        migrated_postgres_url,
        LookbackBankAdapter(),
        account_iban="NL00LOOKBACK123456789",
        lookback_days=7,
        as_of=date(2026, 5, 29),
    )

    with psycopg.connect(migrated_postgres_url) as connection:
        rows = connection.execute(
            """
            SELECT provider_transaction_id, booking_date
            FROM raw_transactions
            WHERE provider = 'lookback'
            ORDER BY provider_transaction_id
            """
        ).fetchall()
        sync_row = connection.execute(
            """
            SELECT new_transaction_count, updated_transaction_count, metadata_json
            FROM sync_runs
            WHERE provider = 'lookback'
            """
        ).fetchone()

    assert result.new_transaction_count == 1
    assert result.updated_transaction_count == 0
    assert result.skipped_old_transaction_count == 1
    assert rows == [("recent-lookback", date(2026, 5, 26))]
    assert sync_row is not None
    assert sync_row[0:2] == (1, 0)
    assert sync_row[2]["lookback_days"] == 7
    assert sync_row[2]["skipped_old_transaction_count"] == 1


def test_bank_sync_records_failed_sync_run(migrated_postgres_url: str) -> None:
    with pytest.raises(RuntimeError, match="sample adapter failure"):
        sync_bank_transactions(
            migrated_postgres_url,
            FailingBankAdapter(),
            account_iban="NL00FAIL0123456789",
        )

    with psycopg.connect(migrated_postgres_url) as connection:
        row = connection.execute(
            """
            SELECT provider, status, error_message, new_transaction_count, updated_transaction_count
            FROM sync_runs
            WHERE provider = 'failing'
            """
        ).fetchone()
        raw_count = connection.execute(
            """
            SELECT count(*)
            FROM raw_transactions
            JOIN accounts ON accounts.id = raw_transactions.account_id
            WHERE accounts.provider = 'failing'
            """
        ).fetchone()

    assert row == ("failing", "failed", "sample adapter failure", 0, 0)
    assert raw_count == (0,)


class StaticAbnSession:
    def __init__(self, _iban: str) -> None:
        pass

    def login(self, card: str, token: str) -> None:
        _ = card, token
        pass

    def mutations(self, iban: str, last_key: str | None = None):
        _ = iban, last_key
        return {
            "mutations": [
                {
                    "mutationKey": "abn-test-1",
                    "bookingDate": "2026-05-28",
                    "valueDate": "2026-05-28",
                    "amount": {"value": "-25.50", "currency": "EUR"},
                    "counterpartyName": "Sample Cafe",
                    "counterpartyIban": "NL00ABNA0000000000",
                    "descriptionLines": ["Card payment", "Sample Cafe"],
                }
            ]
        }


class FailingBankAdapter:
    provider = "failing"

    def fetch_recent_mutations(self) -> list[BankMutation]:
        raise RuntimeError("sample adapter failure")


class LookbackBankAdapter:
    provider = "lookback"

    def fetch_recent_mutations(self) -> list[BankMutation]:
        return [
            BankMutation(
                provider_transaction_id="old-lookback",
                booking_date=date(2026, 5, 1),
                value_date=date(2026, 5, 1),
                amount=Decimal("-10.00"),
                currency="EUR",
                counterparty_name="Old Sample",
                counterparty_iban=None,
                description="Old sample",
                raw_payload={"source": "lookback"},
            ),
            BankMutation(
                provider_transaction_id="recent-lookback",
                booking_date=date(2026, 5, 26),
                value_date=date(2026, 5, 26),
                amount=Decimal("-20.00"),
                currency="EUR",
                counterparty_name="Recent Sample",
                counterparty_iban=None,
                description="Recent sample",
                raw_payload={"source": "lookback"},
            ),
        ]
