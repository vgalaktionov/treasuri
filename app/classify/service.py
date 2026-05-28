"""Database-backed deterministic classification service."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

import psycopg
from psycopg import Connection

from app.classify.pipeline import (
    CategorizationRule,
    ClassificationFlags,
    ClassificationResult,
    ManualOverride,
    MatchField,
    MatchOperator,
    MerchantAlias,
    TransactionForClassification,
    classify_transaction,
)


@dataclass(frozen=True)
class ClassifyResult:
    classified_count: int
    review_count: int


def classify_transactions(database_url: str) -> ClassifyResult:
    with psycopg.connect(database_url) as connection:
        with connection.transaction():
            rules = _load_rules(connection)
            aliases = _load_aliases(connection)
            overrides = _load_manual_overrides(connection)
            classified_count = 0
            review_count = 0
            for transaction_id, transaction in _load_transactions(connection):
                result = classify_transaction(
                    transaction,
                    manual_overrides=overrides,
                    rules=rules,
                    merchant_aliases=aliases,
                )
                _update_enriched_transaction(connection, transaction_id, result)
                classified_count += 1
                if result.needs_review:
                    review_count += 1

    return ClassifyResult(classified_count=classified_count, review_count=review_count)


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
            notes=_optional_str(row[3]),
        )
        for row in rows
    ]


def _update_enriched_transaction(
    connection: Connection[tuple[object, ...]],
    transaction_id: int,
    result: ClassificationResult,
) -> None:
    connection.execute(
        """
        UPDATE enriched_transactions
        SET
            category_id = COALESCE((SELECT id FROM categories WHERE name = %s), category_id),
            merchant_id = COALESCE((SELECT id FROM merchants WHERE name = %s), merchant_id),
            is_income = COALESCE(%s, is_income),
            is_transfer = COALESCE(%s, is_transfer),
            is_savings = COALESCE(%s, is_savings),
            is_fixed_cost = COALESCE(%s, is_fixed_cost),
            is_excluded_from_budget = COALESCE(%s, is_excluded_from_budget),
            needs_review = %s,
            classification_method = %s,
            classification_confidence = %s,
            classification_reason = %s,
            rule_id = %s,
            updated_at = now()
        WHERE id = %s
        """,
        (
            result.category,
            result.merchant,
            result.flags.is_income,
            result.flags.is_transfer,
            result.flags.is_savings,
            result.flags.is_fixed_cost,
            result.flags.is_excluded_from_budget,
            result.needs_review,
            result.method,
            result.confidence,
            result.reason,
            result.rule_id,
            transaction_id,
        ),
    )


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


def _optional_bool(value: object) -> bool | None:
    if value is None:
        return None
    if not isinstance(value, bool):
        raise RuntimeError(f"expected boolean, got {type(value).__name__}")
    return value
