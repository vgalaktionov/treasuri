from __future__ import annotations

from collections.abc import Iterator
from decimal import Decimal

import psycopg
import pytest
from testcontainers.postgres import PostgresContainer

from app.bank.fake import FakeBankAdapter
from app.bank.sync import sync_bank_transactions
from app.classify.llm import LlmClassificationError, LlmClassificationSuggestion
from app.classify.service import classify_transactions
from app.config import AppConfig
from app.migrate import run_migrations
from app.normalize import normalize_raw_transactions


@pytest.fixture(scope="module")
def normalized_postgres_url() -> Iterator[str]:
    with PostgresContainer(
        image="postgres:16-alpine",
        username="treasuri",
        password="treasuri",
        dbname="treasuri",
        driver=None,
    ) as postgres:
        database_url = postgres.get_connection_url(driver=None)
        run_migrations(database_url)
        sync_bank_transactions(database_url, FakeBankAdapter(), account_iban="NL00FAKE0123456789")
        normalize_raw_transactions(database_url)
        yield database_url


def test_classify_transactions_applies_rules_before_aliases(normalized_postgres_url: str) -> None:
    with psycopg.connect(normalized_postgres_url) as connection:
        with connection.transaction():
            connection.execute(
                """
                INSERT INTO merchants (name, normalized_name, default_category_id)
                VALUES (
                    'Sample Supermarket',
                    'sample supermarket',
                    (SELECT id FROM categories WHERE name = 'Groceries')
                )
                """
            )
            connection.execute(
                """
                INSERT INTO merchant_aliases (merchant_id, match_text, match_type, priority)
                VALUES (
                    (SELECT id FROM merchants WHERE normalized_name = 'sample supermarket'),
                    'Sample Supermarket',
                    'contains',
                    100
                )
                """
            )
            connection.execute(
                """
                INSERT INTO categorization_rules (
                    name,
                    priority,
                    field,
                    operator,
                    pattern,
                    category_id,
                    set_is_income
                )
                VALUES (
                    'Salary income',
                    10,
                    'description',
                    'contains',
                    'salary',
                    (SELECT id FROM categories WHERE name = 'Income'),
                    true
                )
                """
            )

    result = classify_transactions(normalized_postgres_url)

    with psycopg.connect(normalized_postgres_url) as connection:
        rows = connection.execute(
            """
            SELECT
                raw_transactions.description,
                categories.name,
                merchants.name,
                enriched_transactions.needs_review,
                enriched_transactions.classification_method
            FROM enriched_transactions
            JOIN raw_transactions ON raw_transactions.id = enriched_transactions.raw_transaction_id
            LEFT JOIN categories ON categories.id = enriched_transactions.category_id
            LEFT JOIN merchants ON merchants.id = enriched_transactions.merchant_id
            ORDER BY raw_transactions.description
            """
        ).fetchall()

    assert result.classified_count == 3
    assert result.review_count == 1
    assert result.method_counts == {"merchant_alias": 1, "rule": 1, "uncategorized": 1}
    assert rows == [
        ("Groceries sample", "Groceries", "Sample Supermarket", False, "merchant_alias"),
        ("Monthly salary sample", "Income", None, False, "rule"),
        ("Needs review sample", "Unknown", None, True, "uncategorized"),
    ]


def test_classify_transactions_uses_historical_manual_correction(normalized_postgres_url: str) -> None:
    with psycopg.connect(normalized_postgres_url) as connection:
        with connection.transaction():
            account_id = connection.execute("SELECT id FROM accounts WHERE provider = 'fake' LIMIT 1").fetchone()
            if account_id is None:
                raise AssertionError("sample account was not inserted")
            corrected_transaction_id = connection.execute(
                """
                SELECT enriched_transactions.id
                FROM enriched_transactions
                JOIN raw_transactions ON raw_transactions.id = enriched_transactions.raw_transaction_id
                WHERE raw_transactions.description = 'Needs review sample'
                """
            ).fetchone()
            if corrected_transaction_id is None:
                raise AssertionError("needs-review transaction was not inserted")
            merchant_id = connection.execute(
                """
                INSERT INTO merchants (name, normalized_name, default_category_id)
                VALUES (
                    'Sample Review Merchant',
                    'sample review merchant',
                    (SELECT id FROM categories WHERE name = 'Groceries')
                )
                ON CONFLICT (normalized_name)
                DO UPDATE SET default_category_id = EXCLUDED.default_category_id
                RETURNING id
                """
            ).fetchone()
            if merchant_id is None:
                raise AssertionError("review merchant was not inserted")
            connection.execute(
                """
                INSERT INTO manual_overrides (enriched_transaction_id, category_id, merchant_id, notes)
                VALUES (
                    %s,
                    (SELECT id FROM categories WHERE name = 'Groceries'),
                    %s,
                    'Historical correction fixture'
                )
                """,
                (corrected_transaction_id[0], merchant_id[0]),
            )
            raw_id = connection.execute(
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
                VALUES (
                    %s,
                    'fake',
                    'history-similar-1',
                    'history-similar-1',
                    '2026-05-28',
                    '2026-05-28',
                    -41.25,
                    'EUR',
                    'Unknown Sample Merchant',
                    'Needs review sample repeat',
                    '{}'::jsonb
                )
                RETURNING id
                """,
                (account_id[0],),
            ).fetchone()
            if raw_id is None:
                raise AssertionError("similar raw transaction was not inserted")
            connection.execute(
                """
                INSERT INTO enriched_transactions (
                    raw_transaction_id,
                    needs_review,
                    classification_method,
                    classification_confidence,
                    classification_reason
                )
                VALUES (%s, true, 'uncategorized', 0, 'Historical similarity fixture.')
                """,
                (raw_id[0],),
            )

    result = classify_transactions(normalized_postgres_url)

    with psycopg.connect(normalized_postgres_url) as connection:
        row = connection.execute(
            """
            SELECT
                categories.name,
                merchants.name,
                enriched_transactions.needs_review,
                enriched_transactions.classification_method,
                enriched_transactions.classification_confidence
            FROM enriched_transactions
            JOIN raw_transactions ON raw_transactions.id = enriched_transactions.raw_transaction_id
            LEFT JOIN categories ON categories.id = enriched_transactions.category_id
            LEFT JOIN merchants ON merchants.id = enriched_transactions.merchant_id
            WHERE raw_transactions.provider_transaction_id = 'history-similar-1'
            """
        ).fetchone()

    assert result.classified_count == 4
    assert row == ("Groceries", "Sample Review Merchant", True, "historical_similarity", Decimal("0.8800"))


@pytest.fixture
def recurring_postgres_url() -> Iterator[str]:
    with PostgresContainer(
        image="postgres:16-alpine",
        username="treasuri",
        password="treasuri",
        dbname="treasuri",
        driver=None,
    ) as postgres:
        database_url = postgres.get_connection_url(driver=None)
        run_migrations(database_url)
        sync_bank_transactions(database_url, FakeBankAdapter(), account_iban="NL00FAKE0123456789")
        normalize_raw_transactions(database_url)
        yield database_url


def test_classify_transactions_uses_recurring_match_before_llm(
    recurring_postgres_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class GuardedLlmClassifier:
        def __init__(self, **_kwargs: object) -> None:
            pass

        def classify(self, transaction, *, categories):
            _ = categories
            if transaction.description == "Needs review sample":
                raise AssertionError("recurring matches should run before LLM fallback")
            return None

    monkeypatch.setattr("app.classify.service.OpenAiCompatibleClassifier", GuardedLlmClassifier)

    with psycopg.connect(recurring_postgres_url) as connection:
        with connection.transaction():
            connection.execute(
                """
                INSERT INTO merchants (name, normalized_name, default_category_id)
                VALUES (
                    'Unknown Sample Merchant',
                    'unknown sample merchant',
                    (SELECT id FROM categories WHERE name = 'Subscriptions')
                )
                ON CONFLICT (normalized_name)
                DO UPDATE SET default_category_id = EXCLUDED.default_category_id
                """
            )
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
                    (SELECT id FROM merchants WHERE normalized_name = 'unknown sample merchant'),
                    (SELECT id FROM categories WHERE name = 'Subscriptions'),
                    'Unknown Sample Merchant',
                    'monthly',
                    'fixed',
                    42.00,
                    1.00,
                    27,
                    '2026-06-27',
                    0.90,
                    true
                )
                """
            )

    result = classify_transactions(recurring_postgres_url, llm_config(recurring_postgres_url))

    with psycopg.connect(recurring_postgres_url) as connection:
        row = connection.execute(
            """
            SELECT
                categories.name,
                merchants.name,
                enriched_transactions.needs_review,
                enriched_transactions.classification_method,
                enriched_transactions.classification_confidence,
                enriched_transactions.is_recurring,
                enriched_transactions.is_fixed_cost,
                enriched_transactions.is_variable_cost,
                enriched_transactions.recurring_series_id IS NOT NULL
            FROM enriched_transactions
            JOIN raw_transactions ON raw_transactions.id = enriched_transactions.raw_transaction_id
            LEFT JOIN categories ON categories.id = enriched_transactions.category_id
            LEFT JOIN merchants ON merchants.id = enriched_transactions.merchant_id
            WHERE raw_transactions.description = 'Needs review sample'
            """
        ).fetchone()

    assert result.method_counts["recurring_match"] == 1
    assert row == (
        "Subscriptions",
        "Unknown Sample Merchant",
        False,
        "recurring_match",
        Decimal("0.9000"),
        True,
        True,
        False,
        True,
    )


@pytest.fixture
def llm_postgres_url() -> Iterator[str]:
    with PostgresContainer(
        image="postgres:16-alpine",
        username="treasuri",
        password="treasuri",
        dbname="treasuri",
        driver=None,
    ) as postgres:
        database_url = postgres.get_connection_url(driver=None)
        run_migrations(database_url)
        sync_bank_transactions(database_url, FakeBankAdapter(), account_iban="NL00FAKE0123456789")
        normalize_raw_transactions(database_url)
        yield database_url


def llm_config(database_url: str) -> AppConfig:
    return AppConfig(
        app_env="test",
        secret_key="test-secret",
        database_url=database_url,
        oidc_enabled=False,
        llm_enabled=True,
        llm_base_url="http://llama.test/v1",
        llm_model="test-llm",
        llm_timeout_seconds=1,
        bank_provider="fake",
    )


def test_classify_transactions_uses_llm_fallback_without_clearing_review(
    llm_postgres_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeLlmClassifier:
        def __init__(self, **_kwargs: object) -> None:
            pass

        def classify(self, transaction, *, categories):
            if transaction.description != "Needs review sample":
                return None
            assert "Groceries" in categories
            return LlmClassificationSuggestion(
                category="Groceries",
                merchant="Sample Merchant",
                confidence=Decimal("0.61"),
                reason="The description is too vague but resembles a merchant purchase.",
                model_ref="test-llm",
            )

    monkeypatch.setattr("app.classify.service.OpenAiCompatibleClassifier", FakeLlmClassifier)

    result = classify_transactions(llm_postgres_url, llm_config(llm_postgres_url))

    with psycopg.connect(llm_postgres_url) as connection:
        row = connection.execute(
            """
            SELECT
                categories.name,
                merchants.name,
                enriched_transactions.needs_review,
                enriched_transactions.classification_method,
                enriched_transactions.classification_confidence,
                enriched_transactions.classification_model,
                enriched_transactions.classification_runtime,
                enriched_transactions.classification_prompt_version
            FROM enriched_transactions
            JOIN raw_transactions ON raw_transactions.id = enriched_transactions.raw_transaction_id
            LEFT JOIN categories ON categories.id = enriched_transactions.category_id
            LEFT JOIN merchants ON merchants.id = enriched_transactions.merchant_id
            WHERE raw_transactions.description = 'Needs review sample'
            """
        ).fetchone()

    assert result.classified_count == 3
    assert row == (
        "Groceries",
        "Sample Merchant",
        True,
        "llm",
        Decimal("0.6100"),
        "test-llm",
        "llama.cpp-openai-compatible",
        "classification-v1",
    )


def test_classify_transactions_obeys_database_llm_disabled_setting(
    llm_postgres_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class UnexpectedLlmClassifier:
        def __init__(self, **_kwargs: object) -> None:
            raise AssertionError("LLM classifier should not be constructed when disabled in settings")

    with psycopg.connect(llm_postgres_url) as connection:
        with connection.transaction():
            connection.execute(
                """
                INSERT INTO app_settings (key, value_json)
                VALUES ('llm_enabled', 'false'::jsonb)
                ON CONFLICT (key)
                DO UPDATE SET value_json = EXCLUDED.value_json
                """
            )

    monkeypatch.setattr("app.classify.service.OpenAiCompatibleClassifier", UnexpectedLlmClassifier)

    classify_transactions(llm_postgres_url, llm_config(llm_postgres_url))

    with psycopg.connect(llm_postgres_url) as connection:
        row = connection.execute(
            """
            SELECT classification_method, needs_review
            FROM enriched_transactions
            JOIN raw_transactions ON raw_transactions.id = enriched_transactions.raw_transaction_id
            WHERE raw_transactions.description = 'Needs review sample'
            """
        ).fetchone()

    assert row == ("uncategorized", True)


def test_classify_transactions_respects_llm_confidence_threshold(
    llm_postgres_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class LowConfidenceLlmClassifier:
        def __init__(self, **_kwargs: object) -> None:
            pass

        def classify(self, transaction, *, categories):
            if transaction.description != "Needs review sample":
                return None
            assert "Groceries" in categories
            return LlmClassificationSuggestion(
                category="Groceries",
                merchant="Sample Merchant",
                confidence=Decimal("0.61"),
                reason="Below the configured threshold.",
                model_ref="test-llm",
            )

    with psycopg.connect(llm_postgres_url) as connection:
        with connection.transaction():
            connection.execute(
                """
                INSERT INTO app_settings (key, value_json)
                VALUES ('llm_confidence_threshold', '"0.90"'::jsonb)
                ON CONFLICT (key)
                DO UPDATE SET value_json = EXCLUDED.value_json
                """
            )

    monkeypatch.setattr("app.classify.service.OpenAiCompatibleClassifier", LowConfidenceLlmClassifier)

    classify_transactions(llm_postgres_url, llm_config(llm_postgres_url))

    with psycopg.connect(llm_postgres_url) as connection:
        row = connection.execute(
            """
            SELECT
                categories.name,
                enriched_transactions.needs_review,
                enriched_transactions.classification_method,
                enriched_transactions.classification_model
            FROM enriched_transactions
            JOIN raw_transactions ON raw_transactions.id = enriched_transactions.raw_transaction_id
            LEFT JOIN categories ON categories.id = enriched_transactions.category_id
            WHERE raw_transactions.description = 'Needs review sample'
            """
        ).fetchone()

    assert row == ("Unknown", True, "uncategorized", None)


def test_classify_transactions_keeps_uncategorized_when_llm_fails(
    llm_postgres_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FailingLlmClassifier:
        def __init__(self, **_kwargs: object) -> None:
            pass

        def classify(self, _transaction, *, categories):
            _ = categories
            raise LlmClassificationError("boom")

    monkeypatch.setattr("app.classify.service.OpenAiCompatibleClassifier", FailingLlmClassifier)

    classify_transactions(llm_postgres_url, llm_config(llm_postgres_url))

    with psycopg.connect(llm_postgres_url) as connection:
        row = connection.execute(
            """
            SELECT
                categories.name,
                enriched_transactions.needs_review,
                enriched_transactions.classification_method,
                enriched_transactions.classification_model
            FROM enriched_transactions
            JOIN raw_transactions ON raw_transactions.id = enriched_transactions.raw_transaction_id
            LEFT JOIN categories ON categories.id = enriched_transactions.category_id
            WHERE raw_transactions.description = 'Needs review sample'
            """
        ).fetchone()

    assert row == ("Unknown", True, "uncategorized", None)
