"""Database-backed deterministic classification service."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from decimal import Decimal
from typing import cast

import psycopg
from psycopg import Connection

from app.classify.llm import LlmClassificationError, OpenAiCompatibleClassifier
from app.classify.pipeline import (
    CategorizationRule,
    ClassificationFlags,
    ClassificationMethod,
    ClassificationResult,
    HistoricalExample,
    ManualOverride,
    MatchField,
    MatchOperator,
    MerchantAlias,
    RecurringMatch,
    TransactionForClassification,
    classify_transaction,
)
from app.config import AppConfig
from app.settings import load_classification_settings


@dataclass(frozen=True)
class ClassifyResult:
    classified_count: int
    review_count: int
    method_counts: dict[str, int]


@dataclass(frozen=True)
class _ClassificationRuntimeSettings:
    llm_enabled: bool
    llm_confidence_threshold: Decimal


def classify_transactions(database_url: str, config: AppConfig | None = None) -> ClassifyResult:
    with psycopg.connect(database_url) as connection:
        with connection.transaction():
            rules = _load_rules(connection)
            aliases = _load_aliases(connection)
            recurring_matches = _load_recurring_matches(connection)
            overrides = _load_manual_overrides(connection)
            historical_examples = _load_historical_examples(connection)
            category_names = _load_category_names(connection)
            runtime_settings = _load_runtime_settings(database_url, config)
            llm_classifier = _create_llm_classifier(config, enabled=runtime_settings.llm_enabled)
            classified_count = 0
            review_count = 0
            method_counts: Counter[str] = Counter()
            for transaction_id, transaction in _load_transactions(connection):
                result = classify_transaction(
                    transaction,
                    manual_overrides=overrides,
                    rules=rules,
                    merchant_aliases=aliases,
                    recurring_matches=recurring_matches,
                    historical_examples=historical_examples,
                )
                if result.method == ClassificationMethod.UNCATEGORIZED and llm_classifier is not None:
                    result = _try_llm_classification(
                        llm_classifier,
                        transaction,
                        category_names,
                        result,
                        confidence_threshold=runtime_settings.llm_confidence_threshold,
                    )
                _update_enriched_transaction(connection, transaction_id, result)
                classified_count += 1
                method_counts[result.method.value] += 1
                if result.needs_review:
                    review_count += 1

    return ClassifyResult(
        classified_count=classified_count,
        review_count=review_count,
        method_counts=dict(method_counts),
    )


def _load_runtime_settings(database_url: str, config: AppConfig | None) -> _ClassificationRuntimeSettings:
    if config is None:
        return _ClassificationRuntimeSettings(llm_enabled=False, llm_confidence_threshold=Decimal("0.60"))
    settings = load_classification_settings(database_url, config)
    return _ClassificationRuntimeSettings(
        llm_enabled=settings.llm_enabled,
        llm_confidence_threshold=settings.llm_confidence_threshold,
    )


def _create_llm_classifier(config: AppConfig | None, *, enabled: bool) -> OpenAiCompatibleClassifier | None:
    if config is None or not enabled:
        return None
    return OpenAiCompatibleClassifier(
        base_url=config.llm_base_url,
        model=config.llm_model,
        timeout_seconds=config.llm_timeout_seconds,
        temperature=config.llm_temperature,
    )


def _try_llm_classification(
    llm_classifier: OpenAiCompatibleClassifier,
    transaction: TransactionForClassification,
    category_names: list[str],
    fallback: ClassificationResult,
    *,
    confidence_threshold: Decimal,
) -> ClassificationResult:
    try:
        suggestion = llm_classifier.classify(transaction, categories=category_names)
    except LlmClassificationError:
        return fallback
    if suggestion is None:
        return fallback
    if suggestion.confidence < confidence_threshold:
        return fallback
    return ClassificationResult(
        method=ClassificationMethod.LLM,
        category=suggestion.category,
        merchant=suggestion.merchant,
        confidence=suggestion.confidence,
        needs_review=True,
        reason=f"LLM suggestion: {suggestion.reason}",
        model_ref=suggestion.model_ref,
        runtime=suggestion.runtime,
        prompt_version=suggestion.prompt_version,
    )


def _load_transactions(
    connection: Connection[tuple[object, ...]],
) -> list[tuple[int, TransactionForClassification]]:
    rows = connection.execute(
        """
        SELECT
            enriched_transactions.id,
            raw_transactions.account_id,
            raw_transactions.amount,
            raw_transactions.description,
            raw_transactions.counterparty_name,
            raw_transactions.counterparty_iban,
            merchants.name
        FROM enriched_transactions
        JOIN raw_transactions ON raw_transactions.id = enriched_transactions.raw_transaction_id
        LEFT JOIN merchants ON merchants.id = enriched_transactions.merchant_id
        ORDER BY enriched_transactions.id
        """
    ).fetchall()
    return [
        (
            _read_int(row[0]),
            TransactionForClassification(
                id=_read_int(row[0]),
                account_id=_read_int(row[1]),
                amount=_read_decimal(row[2]),
                description=str(row[3]),
                counterparty_name=_optional_str(row[4]),
                counterparty_iban=_optional_str(row[5]),
                merchant_name=_optional_str(row[6]),
            ),
        )
        for row in rows
    ]


def _load_rules(connection: Connection[tuple[object, ...]]) -> list[CategorizationRule]:
    rows = connection.execute(
        """
        SELECT
            categorization_rules.id,
            categorization_rules.name,
            categorization_rules.priority,
            categorization_rules.field,
            categorization_rules.operator,
            categorization_rules.pattern,
            categories.name,
            merchants.name,
            categorization_rules.set_is_income,
            categorization_rules.set_is_transfer,
            categorization_rules.set_is_savings,
            categorization_rules.set_is_fixed_cost,
            categorization_rules.set_is_excluded_from_budget,
            categorization_rules.is_active
        FROM categorization_rules
        LEFT JOIN categories ON categories.id = categorization_rules.category_id
        LEFT JOIN merchants ON merchants.id = categorization_rules.merchant_id
        ORDER BY categorization_rules.priority, categorization_rules.id
        """
    ).fetchall()
    return [
        CategorizationRule(
            id=_read_int(row[0]),
            name=str(row[1]),
            priority=_read_int(row[2]),
            field=MatchField(str(row[3])),
            operator=MatchOperator(str(row[4])),
            pattern=str(row[5]),
            category=_optional_str(row[6]),
            merchant=_optional_str(row[7]),
            flags=ClassificationFlags(
                is_income=_optional_bool(row[8]),
                is_transfer=_optional_bool(row[9]),
                is_savings=_optional_bool(row[10]),
                is_fixed_cost=_optional_bool(row[11]),
                is_excluded_from_budget=_optional_bool(row[12]),
            ),
            is_active=bool(row[13]),
        )
        for row in rows
    ]


def _load_aliases(connection: Connection[tuple[object, ...]]) -> list[MerchantAlias]:
    rows = connection.execute(
        """
        SELECT
            merchants.name,
            merchant_aliases.match_text,
            merchant_aliases.match_type,
            merchant_aliases.priority,
            categories.name,
            merchant_aliases.is_active
        FROM merchant_aliases
        JOIN merchants ON merchants.id = merchant_aliases.merchant_id
        LEFT JOIN categories ON categories.id = merchants.default_category_id
        ORDER BY merchant_aliases.priority, merchant_aliases.id
        """
    ).fetchall()
    return [
        MerchantAlias(
            merchant=str(row[0]),
            match_text=str(row[1]),
            match_type=MatchOperator(str(row[2])),
            priority=_read_int(row[3]),
            default_category=_optional_str(row[4]),
            is_active=bool(row[5]),
        )
        for row in rows
    ]


def _load_manual_overrides(connection: Connection[tuple[object, ...]]) -> list[ManualOverride]:
    rows = connection.execute(
        """
        SELECT
            manual_overrides.enriched_transaction_id,
            categories.name,
            merchants.name,
            manual_overrides.flags_json,
            manual_overrides.notes
        FROM manual_overrides
        LEFT JOIN categories ON categories.id = manual_overrides.category_id
        LEFT JOIN merchants ON merchants.id = manual_overrides.merchant_id
        ORDER BY manual_overrides.id
        """
    ).fetchall()
    return [
        ManualOverride(
            transaction_id=_read_int(row[0]),
            category=_optional_str(row[1]),
            merchant=_optional_str(row[2]),
            flags=_classification_flags(row[3]),
            notes=_optional_str(row[4]),
        )
        for row in rows
    ]


def _load_recurring_matches(connection: Connection[tuple[object, ...]]) -> list[RecurringMatch]:
    rows = connection.execute(
        """
        SELECT
            recurring_series.id,
            recurring_series.name,
            categories.name,
            merchants.name,
            recurring_series.expected_amount,
            COALESCE(recurring_series.amount_tolerance, 0)
        FROM recurring_series
        LEFT JOIN categories ON categories.id = recurring_series.category_id
        LEFT JOIN merchants ON merchants.id = recurring_series.merchant_id
        WHERE recurring_series.is_active = true
            AND recurring_series.expected_amount IS NOT NULL
        ORDER BY recurring_series.is_confirmed DESC, recurring_series.confidence DESC, recurring_series.id
        """
    ).fetchall()
    return [
        RecurringMatch(
            id=_read_int(row[0]),
            name=str(row[1]),
            category=_optional_str(row[2]),
            merchant=_optional_str(row[3]),
            expected_amount=_read_decimal(row[4]),
            amount_tolerance=_read_decimal(row[5]),
        )
        for row in rows
    ]


def _load_historical_examples(connection: Connection[tuple[object, ...]]) -> list[HistoricalExample]:
    rows = connection.execute(
        """
        SELECT
            manual_overrides.enriched_transaction_id,
            raw_transactions.amount,
            raw_transactions.description,
            raw_transactions.counterparty_name,
            categories.name,
            merchants.name
        FROM manual_overrides
        JOIN enriched_transactions ON enriched_transactions.id = manual_overrides.enriched_transaction_id
        JOIN raw_transactions ON raw_transactions.id = enriched_transactions.raw_transaction_id
        LEFT JOIN categories ON categories.id = manual_overrides.category_id
        LEFT JOIN merchants ON merchants.id = manual_overrides.merchant_id
        ORDER BY manual_overrides.id
        """
    ).fetchall()
    return [
        HistoricalExample(
            transaction_id=_read_int(row[0]),
            amount=_read_decimal(row[1]),
            description=str(row[2]),
            counterparty_name=_optional_str(row[3]),
            category=_optional_str(row[4]),
            merchant=_optional_str(row[5]),
        )
        for row in rows
    ]


def _load_category_names(connection: Connection[tuple[object, ...]]) -> list[str]:
    rows = connection.execute("SELECT name FROM categories ORDER BY name").fetchall()
    return [str(row[0]) for row in rows]


def _update_enriched_transaction(
    connection: Connection[tuple[object, ...]],
    transaction_id: int,
    result: ClassificationResult,
) -> None:
    merchant_normalized_name = _upsert_suggested_merchant(connection, result)
    connection.execute(
        """
        UPDATE enriched_transactions
        SET
            category_id = COALESCE((SELECT id FROM categories WHERE name = %s), category_id),
            merchant_id = COALESCE((SELECT id FROM merchants WHERE normalized_name = %s), merchant_id),
            is_income = COALESCE(%s, is_income),
            is_transfer = COALESCE(%s, is_transfer),
            is_savings = COALESCE(%s, is_savings),
            is_fixed_cost = COALESCE(%s, is_fixed_cost),
            is_variable_cost = CASE WHEN %s IS TRUE THEN false ELSE is_variable_cost END,
            is_recurring = COALESCE(%s, is_recurring),
            is_one_off = COALESCE(%s, is_one_off),
            is_excluded_from_budget = COALESCE(%s, is_excluded_from_budget),
            needs_review = %s,
            classification_method = %s,
            classification_confidence = %s,
            classification_reason = %s,
            classification_model = %s,
            classification_runtime = %s,
            classification_prompt_version = %s,
            rule_id = %s,
            recurring_series_id = COALESCE(%s, recurring_series_id),
            updated_at = now()
        WHERE id = %s
        """,
        (
            result.category,
            merchant_normalized_name,
            result.flags.is_income,
            result.flags.is_transfer,
            result.flags.is_savings,
            result.flags.is_fixed_cost,
            result.flags.is_fixed_cost,
            result.flags.is_recurring,
            result.flags.is_one_off,
            result.flags.is_excluded_from_budget,
            result.needs_review,
            result.method,
            result.confidence,
            result.reason,
            result.model_ref,
            result.runtime,
            result.prompt_version,
            result.rule_id,
            result.recurring_series_id,
            transaction_id,
        ),
    )


def _upsert_suggested_merchant(
    connection: Connection[tuple[object, ...]],
    result: ClassificationResult,
) -> str | None:
    if result.merchant is None or result.merchant.strip() == "":
        return None
    normalized_name = result.merchant.strip().casefold()
    connection.execute(
        """
        INSERT INTO merchants (name, normalized_name, default_category_id)
        VALUES (
            %s,
            %s,
            (SELECT id FROM categories WHERE name = %s)
        )
        ON CONFLICT (normalized_name)
        DO UPDATE SET
            name = EXCLUDED.name,
            default_category_id = COALESCE(EXCLUDED.default_category_id, merchants.default_category_id),
            updated_at = now()
        """,
        (result.merchant.strip(), normalized_name, result.category),
    )
    return normalized_name


def _read_int(value: object) -> int:
    if not isinstance(value, int):
        raise RuntimeError(f"expected integer, got {type(value).__name__}")
    return value


def _read_decimal(value: object) -> Decimal:
    if not isinstance(value, Decimal):
        raise RuntimeError(f"expected decimal, got {type(value).__name__}")
    return value


def _optional_str(value: object) -> str | None:
    if value is None:
        return None
    return str(value)


def _classification_flags(value: object) -> ClassificationFlags:
    if not isinstance(value, dict):
        return ClassificationFlags()
    flags = cast(dict[str, object], value)
    return ClassificationFlags(
        is_income=_optional_flag(flags.get("is_income")),
        is_transfer=_optional_flag(flags.get("is_transfer")),
        is_savings=_optional_flag(flags.get("is_savings")),
        is_fixed_cost=_optional_flag(flags.get("is_fixed_cost")),
        is_recurring=_optional_flag(flags.get("is_recurring")),
        is_one_off=_optional_flag(flags.get("is_one_off")),
        is_excluded_from_budget=_optional_flag(flags.get("is_excluded_from_budget")),
    )


def _optional_flag(value: object) -> bool | None:
    if value is None:
        return None
    if not isinstance(value, bool):
        raise RuntimeError(f"expected boolean flag, got {type(value).__name__}")
    return value


def _optional_bool(value: object) -> bool | None:
    if value is None:
        return None
    if not isinstance(value, bool):
        raise RuntimeError(f"expected boolean, got {type(value).__name__}")
    return value
