"""Deterministic fake data for local development and tests."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

import psycopg
from psycopg import Connection

from app.forecast.service import update_monthly_forecast_in_connection
from app.settings import ForecastSettings, save_forecast_settings_in_connection

SAMPLE_YEAR_MONTH = "2026-05"
SAMPLE_FORECAST_DATE = date(2026, 5, 26)


@dataclass(frozen=True)
class SampleTransaction:
    source_hash: str
    booking_date: date
    amount: Decimal
    counterparty_name: str
    description: str
    category: str
    merchant: str
    needs_review: bool = False
    classification_method: str = "sample"
    classification_confidence: Decimal = Decimal("1")
    is_income: bool = False
    is_transfer: bool = False
    is_savings: bool = False
    is_fixed_cost: bool = False
    is_variable_cost: bool = True
    is_one_off: bool = False
    is_excluded_from_budget: bool = False


SAMPLE_TRANSACTIONS: tuple[SampleTransaction, ...] = (
    SampleTransaction(
        source_hash="sample-salary-2026-05",
        booking_date=date(2026, 5, 24),
        amount=Decimal("5258.00"),
        counterparty_name="Sample Employer",
        description="Monthly salary sample",
        category="Income",
        merchant="Sample Employer",
        is_income=True,
        is_variable_cost=False,
    ),
    SampleTransaction(
        source_hash="sample-rent-2026-05",
        booking_date=date(2026, 5, 1),
        amount=Decimal("-1450.00"),
        counterparty_name="Sample Housing",
        description="Monthly rent sample",
        category="Rent / Mortgage",
        merchant="Sample Housing",
        is_fixed_cost=True,
        is_variable_cost=False,
    ),
    SampleTransaction(
        source_hash="sample-groceries-2026-05",
        booking_date=date(2026, 5, 26),
        amount=Decimal("-64.35"),
        counterparty_name="Sample Supermarket",
        description="Groceries sample",
        category="Groceries",
        merchant="Sample Supermarket",
    ),
    SampleTransaction(
        source_hash="sample-dog-2026-05",
        booking_date=date(2026, 5, 20),
        amount=Decimal("-89.95"),
        counterparty_name="Sample Pet Care",
        description="Dog food sample",
        category="Dog",
        merchant="Sample Pet Care",
    ),
    SampleTransaction(
        source_hash="sample-oneoff-2026-05",
        booking_date=date(2026, 5, 18),
        amount=Decimal("-320.00"),
        counterparty_name="Sample Furniture",
        description="Large one-off sample purchase",
        category="One-off / Large purchase",
        merchant="Sample Furniture",
        is_one_off=True,
        is_excluded_from_budget=True,
    ),
    SampleTransaction(
        source_hash="sample-transfer-2026-05",
        booking_date=date(2026, 5, 16),
        amount=Decimal("-500.00"),
        counterparty_name="Sample Own Savings",
        description="Savings transfer sample",
        category="Savings",
        merchant="Sample Own Savings",
        is_transfer=True,
        is_savings=True,
        is_variable_cost=False,
    ),
    SampleTransaction(
        source_hash="sample-review-2026-05",
        booking_date=date(2026, 5, 27),
        amount=Decimal("-42.10"),
        counterparty_name="Unknown Sample Merchant",
        description="Needs review sample",
        category="Unknown",
        merchant="Unknown Sample Merchant",
        needs_review=True,
        classification_method="uncategorized",
        classification_confidence=Decimal("0"),
    ),
)


def load_sample_data(database_url: str) -> None:
    with psycopg.connect(database_url) as connection:
        with connection.transaction():
            account_id = _upsert_sample_account(connection)
            _upsert_merchants(connection)
            for transaction in SAMPLE_TRANSACTIONS:
                _upsert_sample_transaction(connection, account_id, transaction)
            _upsert_sample_recurring_series(connection)
            _upsert_sample_settings(connection)
            _upsert_sample_sync_run(connection)
            update_monthly_forecast_in_connection(connection, as_of=SAMPLE_FORECAST_DATE)


def _upsert_sample_account(connection: Connection[tuple[object, ...]]) -> int:
    row = connection.execute(
        """
        INSERT INTO accounts (provider, iban, name, currency)
        VALUES ('fake', 'NL00FAKE0123456789', 'Sample current account', 'EUR')
        ON CONFLICT (provider, iban)
        DO UPDATE SET name = EXCLUDED.name, updated_at = now()
        RETURNING id
        """
    ).fetchone()
    if row is None:
        raise RuntimeError("sample account upsert did not return an id")
    return _read_int_id(row[0])


def _upsert_merchants(connection: Connection[tuple[object, ...]]) -> None:
    for transaction in SAMPLE_TRANSACTIONS:
        connection.execute(
            """
            INSERT INTO merchants (name, normalized_name, default_category_id)
            VALUES (
                %s,
                %s,
                (SELECT id FROM categories WHERE name = %s)
            )
            ON CONFLICT (normalized_name)
            DO UPDATE SET default_category_id = EXCLUDED.default_category_id, updated_at = now()
            """,
            (transaction.merchant, transaction.merchant.casefold(), transaction.category),
        )


def _upsert_sample_transaction(
    connection: Connection[tuple[object, ...]], account_id: int, transaction: SampleTransaction
) -> None:
    raw_row = connection.execute(
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
            description,
            raw_payload_json
        )
        VALUES (%s, 'fake', %s, %s, %s, %s, %s, 'EUR', %s, %s, %s::jsonb)
        ON CONFLICT (account_id, source_hash)
        DO UPDATE SET
            last_seen_at = now(),
            amount = EXCLUDED.amount,
            counterparty_name = EXCLUDED.counterparty_name,
            description = EXCLUDED.description
        RETURNING id
        """,
        (
            account_id,
            transaction.source_hash,
            transaction.source_hash,
            transaction.booking_date,
            transaction.booking_date,
            transaction.amount,
            transaction.counterparty_name,
            transaction.description,
            '{"source":"sample"}',
        ),
    ).fetchone()
    if raw_row is None:
        raise RuntimeError("sample raw transaction upsert did not return an id")

    connection.execute(
        """
        INSERT INTO enriched_transactions (
            raw_transaction_id,
            merchant_id,
            category_id,
            is_income,
            is_transfer,
            is_savings,
            is_fixed_cost,
            is_variable_cost,
            is_one_off,
            is_excluded_from_budget,
            needs_review,
            classification_method,
            classification_confidence,
            classification_reason
        )
        VALUES (
            %s,
            (SELECT id FROM merchants WHERE normalized_name = %s),
            (SELECT id FROM categories WHERE name = %s),
            %s,
            %s,
            %s,
            %s,
            %s,
            %s,
            %s,
            %s,
            %s,
            %s,
            %s
        )
        ON CONFLICT (raw_transaction_id)
        DO UPDATE SET
            merchant_id = EXCLUDED.merchant_id,
            category_id = EXCLUDED.category_id,
            is_income = EXCLUDED.is_income,
            is_transfer = EXCLUDED.is_transfer,
            is_savings = EXCLUDED.is_savings,
            is_fixed_cost = EXCLUDED.is_fixed_cost,
            is_variable_cost = EXCLUDED.is_variable_cost,
            is_one_off = EXCLUDED.is_one_off,
            is_excluded_from_budget = EXCLUDED.is_excluded_from_budget,
            needs_review = EXCLUDED.needs_review,
            classification_method = EXCLUDED.classification_method,
            classification_confidence = EXCLUDED.classification_confidence,
            classification_reason = EXCLUDED.classification_reason,
            updated_at = now()
        """,
        (
            _read_int_id(raw_row[0]),
            transaction.merchant.casefold(),
            transaction.category,
            transaction.is_income,
            transaction.is_transfer,
            transaction.is_savings,
            transaction.is_fixed_cost,
            transaction.is_variable_cost,
            transaction.is_one_off,
            transaction.is_excluded_from_budget,
            transaction.needs_review,
            transaction.classification_method,
            transaction.classification_confidence,
            "Deterministic sample data.",
        ),
    )


def _upsert_sample_settings(connection: Connection[tuple[object, ...]]) -> None:
    save_forecast_settings_in_connection(
        connection,
        ForecastSettings(
            current_liquid_balance=Decimal("3215.77"),
            target_monthly_savings=Decimal("1000.00"),
            safety_buffer=Decimal("1000.00"),
            salary_day=24,
            baseline_months=6,
            sync_lookback_days=90,
            fixed_costs_upcoming=Decimal("620.00"),
            variable_baseline_3m=Decimal("0.00"),
            variable_baseline_6m=Decimal("0.00"),
        ),
    )


def _upsert_sample_recurring_series(connection: Connection[tuple[object, ...]]) -> None:
    connection.execute(
        """
        INSERT INTO merchants (name, normalized_name, default_category_id)
        VALUES (
            'Sample Streaming',
            'sample streaming',
            (SELECT id FROM categories WHERE name = 'Subscriptions')
        )
        ON CONFLICT (normalized_name)
        DO UPDATE SET default_category_id = EXCLUDED.default_category_id, updated_at = now()
        """
    )
    connection.execute("DELETE FROM recurring_series WHERE name = 'Sample Streaming'")
    connection.execute(
        """
        INSERT INTO recurring_series (
            merchant_id,
            category_id,
            name,
            cadence,
            amount_mode,
            expected_amount,
            amount_tolerance,
            expected_day_of_month,
            next_expected_date,
            confidence,
            is_confirmed
        )
        VALUES (
            (SELECT id FROM merchants WHERE normalized_name = 'sample streaming'),
            (SELECT id FROM categories WHERE name = 'Subscriptions'),
            'Sample Streaming',
            'monthly',
            'fixed',
            12.99,
            2.00,
            30,
            '2026-05-30',
            0.80,
            false
        )
        """
    )


def _upsert_sample_sync_run(connection: Connection[tuple[object, ...]]) -> None:
    connection.execute("DELETE FROM sync_runs WHERE metadata_json @> %s::jsonb", ('{"source":"sample"}',))
    connection.execute(
        """
        INSERT INTO sync_runs (
            provider,
            started_at,
            finished_at,
            status,
            new_transaction_count,
            updated_transaction_count,
            metadata_json
        )
        VALUES (
            'fake',
            '2026-05-28 08:00:00+00',
            '2026-05-28 08:00:01+00',
            'completed',
            %s,
            0,
            '{"source":"sample"}'::jsonb
        )
        """,
        (len(SAMPLE_TRANSACTIONS),),
    )


def _read_int_id(value: object) -> int:
    if not isinstance(value, int):
        raise RuntimeError(f"expected integer id, got {type(value).__name__}")
    return value
