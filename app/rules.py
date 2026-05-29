"""Categorization rule preview and creation."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

import psycopg
from psycopg import Connection

from app.classify.pipeline import (
    CategorizationRule,
    ClassificationFlags,
    MatchField,
    MatchOperator,
    TransactionForClassification,
    rule_matches,
)

RULE_FIELDS = ("description", "counterparty_name", "counterparty_iban", "merchant")
RULE_OPERATORS = ("contains", "exact", "regex", "starts_with", "ends_with")


@dataclass(frozen=True)
class RuleDraft:
    source_transaction_id: int | None
    name: str
    field: str
    operator: str
    pattern: str
    category_name: str
    merchant_name: str | None


@dataclass(frozen=True)
class RulePreview:
    draft: RuleDraft
    match_count: int
    would_change_count: int
    already_correct_count: int
    manual_overrides_skipped_count: int


@dataclass(frozen=True)
class StoredRule:
    id: int
    name: str
    priority: int
    is_active: bool
    field: str
    operator: str
    pattern: str
    category_name: str | None
    merchant_name: str | None


@dataclass(frozen=True)
class RuleHistoryPreview:
    match_count: int
    would_change_count: int
    already_correct_count: int
    manual_overrides_skipped_count: int


@dataclass(frozen=True)
class RuleListItem:
    rule: StoredRule
    preview: RuleHistoryPreview


@dataclass(frozen=True)
class RuleBackfillResult:
    updated_count: int
    skipped_manual_count: int


@dataclass(frozen=True)
class RuleEditorInput:
    name: str
    priority: int
    is_active: bool
    field: str
    operator: str
    pattern: str
    category_name: str
    merchant_name: str | None


def draft_rule_from_transaction(database_url: str, transaction_id: int) -> RuleDraft:
    with psycopg.connect(database_url) as connection:
        row = connection.execute(
            """
            SELECT
                raw_transactions.counterparty_name,
                raw_transactions.description,
                categories.name,
                merchants.name
            FROM enriched_transactions
            JOIN raw_transactions ON raw_transactions.id = enriched_transactions.raw_transaction_id
            LEFT JOIN categories ON categories.id = enriched_transactions.category_id
            LEFT JOIN merchants ON merchants.id = enriched_transactions.merchant_id
            WHERE enriched_transactions.id = %s
            """,
            (transaction_id,),
        ).fetchone()
    if row is None:
        raise ValueError(f"transaction not found: {transaction_id}")

    counterparty = _optional_str(row[0])
    description = str(row[1])
    pattern = counterparty or description
    field = "counterparty_name" if counterparty else "description"
    return RuleDraft(
        source_transaction_id=transaction_id,
        name=f"Classify {pattern}",
        field=field,
        operator="contains",
        pattern=pattern,
        category_name=str(row[2] or "Unknown"),
        merchant_name=_optional_str(row[3]),
    )


def preview_rule(database_url: str, draft: RuleDraft) -> RulePreview:
    with psycopg.connect(database_url) as connection:
        rows = connection.execute(
            """
            SELECT
                categories.name,
                manual_overrides.id IS NOT NULL
            FROM enriched_transactions
            JOIN raw_transactions ON raw_transactions.id = enriched_transactions.raw_transaction_id
            LEFT JOIN categories ON categories.id = enriched_transactions.category_id
            LEFT JOIN manual_overrides
                ON manual_overrides.enriched_transaction_id = enriched_transactions.id
            WHERE
                CASE
                    WHEN %s = 'counterparty_name'
                        THEN raw_transactions.counterparty_name ILIKE '%%' || %s || '%%'
                    ELSE raw_transactions.description ILIKE '%%' || %s || '%%'
                END
            """,
            (draft.field, draft.pattern, draft.pattern),
        ).fetchall()

    manual_skipped = sum(1 for row in rows if row[1])
    eligible_rows = [row for row in rows if not row[1]]
    already_correct = sum(1 for row in eligible_rows if row[0] == draft.category_name)
    would_change = len(eligible_rows) - already_correct

    return RulePreview(
        draft=draft,
        match_count=len(rows),
        would_change_count=would_change,
        already_correct_count=already_correct,
        manual_overrides_skipped_count=manual_skipped,
    )


def create_rule(database_url: str, draft: RuleDraft) -> int:
    with psycopg.connect(database_url) as connection:
        with connection.transaction():
            merchant_id = _merchant_id(connection, draft.merchant_name)
            row = connection.execute(
                """
                INSERT INTO categorization_rules (
                    name,
                    priority,
                    field,
                    operator,
                    pattern,
                    category_id,
                    merchant_id,
                    created_from_transaction_id
                )
                VALUES (
                    %s,
                    100,
                    %s,
                    %s,
                    %s,
                    (SELECT id FROM categories WHERE name = %s),
                    %s,
                    %s
                )
                RETURNING id
                """,
                (
                    draft.name,
                    draft.field,
                    draft.operator,
                    draft.pattern,
                    draft.category_name,
                    merchant_id,
                    draft.source_transaction_id,
                ),
            ).fetchone()
    if row is None:
        raise RuntimeError("rule insert did not return an id")
    return _read_int(row[0])


def create_rule_from_input(database_url: str, rule_input: RuleEditorInput) -> int:
    with psycopg.connect(database_url) as connection:
        with connection.transaction():
            category_id = _category_id(connection, rule_input.category_name)
            merchant_id = _upsert_merchant_id(connection, rule_input.merchant_name, category_id)
            row = connection.execute(
                """
                INSERT INTO categorization_rules (
                    name,
                    priority,
                    is_active,
                    field,
                    operator,
                    pattern,
                    category_id,
                    merchant_id
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (
                    rule_input.name,
                    rule_input.priority,
                    rule_input.is_active,
                    rule_input.field,
                    rule_input.operator,
                    rule_input.pattern,
                    category_id,
                    merchant_id,
                ),
            ).fetchone()
    if row is None:
        raise RuntimeError("rule insert did not return an id")
    return _read_int(row[0])


def update_rule_from_input(database_url: str, rule_id: int, rule_input: RuleEditorInput) -> None:
    with psycopg.connect(database_url) as connection:
        with connection.transaction():
            category_id = _category_id(connection, rule_input.category_name)
            merchant_id = _upsert_merchant_id(connection, rule_input.merchant_name, category_id)
            connection.execute(
                """
                UPDATE categorization_rules
                SET
                    name = %s,
                    priority = %s,
                    is_active = %s,
                    field = %s,
                    operator = %s,
                    pattern = %s,
                    category_id = %s,
                    merchant_id = %s,
                    updated_at = now()
                WHERE id = %s
                """,
                (
                    rule_input.name,
                    rule_input.priority,
                    rule_input.is_active,
                    rule_input.field,
                    rule_input.operator,
                    rule_input.pattern,
                    category_id,
                    merchant_id,
                    rule_id,
                ),
            )


def parse_rule_editor_input(form: dict[str, str]) -> RuleEditorInput:
    name = form.get("name", "").strip()
    field = form.get("field", "").strip()
    operator = form.get("operator", "").strip()
    pattern = form.get("pattern", "").strip()
    category_name = form.get("category", "").strip()
    merchant_name = form.get("merchant", "").strip() or None
    if not name:
        raise ValueError("rule name is required")
    if field not in RULE_FIELDS:
        raise ValueError(f"unsupported rule field: {field}")
    if operator not in RULE_OPERATORS:
        raise ValueError(f"unsupported rule operator: {operator}")
    if not pattern:
        raise ValueError("rule pattern is required")
    if not category_name:
        raise ValueError("rule category is required")
    return RuleEditorInput(
        name=name,
        priority=_parse_priority(form.get("priority", "")),
        is_active=form.get("is_active") == "1",
        field=field,
        operator=operator,
        pattern=pattern,
        category_name=category_name,
        merchant_name=merchant_name,
    )


def list_rules(database_url: str) -> list[RuleListItem]:
    with psycopg.connect(database_url) as connection:
        rules = _load_stored_rules(connection)
        return [RuleListItem(rule=rule, preview=_preview_stored_rule(connection, rule.id)) for rule in rules]


def set_rule_active(database_url: str, rule_id: int, *, is_active: bool) -> None:
    with psycopg.connect(database_url) as connection:
        with connection.transaction():
            connection.execute(
                "UPDATE categorization_rules SET is_active = %s, updated_at = now() WHERE id = %s",
                (is_active, rule_id),
            )


def backfill_rule(database_url: str, rule_id: int) -> RuleBackfillResult:
    with psycopg.connect(database_url) as connection:
        with connection.transaction():
            rule = _load_rule_for_matching(connection, rule_id)
            if rule is None:
                raise ValueError(f"rule not found: {rule_id}")
            if not rule.is_active:
                return RuleBackfillResult(updated_count=0, skipped_manual_count=0)

            matches = _matching_transactions(connection, rule)
            updated_count = 0
            skipped_manual_count = 0
            for match in matches:
                if match.has_manual_override:
                    skipped_manual_count += 1
                    continue
                _apply_rule_to_transaction(connection, rule, match.transaction_id)
                updated_count += 1

    return RuleBackfillResult(updated_count=updated_count, skipped_manual_count=skipped_manual_count)


def _load_stored_rules(connection: Connection[tuple[object, ...]]) -> list[StoredRule]:
    rows = connection.execute(
        """
        SELECT
            categorization_rules.id,
            categorization_rules.name,
            categorization_rules.priority,
            categorization_rules.is_active,
            categorization_rules.field,
            categorization_rules.operator,
            categorization_rules.pattern,
            categories.name,
            merchants.name
        FROM categorization_rules
        LEFT JOIN categories ON categories.id = categorization_rules.category_id
        LEFT JOIN merchants ON merchants.id = categorization_rules.merchant_id
        ORDER BY categorization_rules.priority, categorization_rules.id
        """
    ).fetchall()
    return [
        StoredRule(
            id=_read_int(row[0]),
            name=str(row[1]),
            priority=_read_int(row[2]),
            is_active=bool(row[3]),
            field=str(row[4]),
            operator=str(row[5]),
            pattern=str(row[6]),
            category_name=_optional_str(row[7]),
            merchant_name=_optional_str(row[8]),
        )
        for row in rows
    ]


@dataclass(frozen=True)
class _RuleTransactionMatch:
    transaction_id: int
    category_name: str | None
    merchant_name: str | None
    has_manual_override: bool


def _preview_stored_rule(connection: Connection[tuple[object, ...]], rule_id: int) -> RuleHistoryPreview:
    rule = _load_rule_for_matching(connection, rule_id)
    if rule is None:
        return RuleHistoryPreview(0, 0, 0, 0)
    matches = _matching_transactions(connection, rule)
    skipped = sum(1 for match in matches if match.has_manual_override)
    eligible = [match for match in matches if not match.has_manual_override]
    already_correct = sum(
        1
        for match in eligible
        if match.category_name == rule.category and (rule.merchant is None or match.merchant_name == rule.merchant)
    )
    return RuleHistoryPreview(
        match_count=len(matches),
        would_change_count=len(eligible) - already_correct,
        already_correct_count=already_correct,
        manual_overrides_skipped_count=skipped,
    )


def _load_rule_for_matching(connection: Connection[tuple[object, ...]], rule_id: int) -> CategorizationRule | None:
    row = connection.execute(
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
        WHERE categorization_rules.id = %s
        """,
        (rule_id,),
    ).fetchone()
    if row is None:
        return None
    return CategorizationRule(
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


def _matching_transactions(
    connection: Connection[tuple[object, ...]],
    rule: CategorizationRule,
) -> list[_RuleTransactionMatch]:
    rows = connection.execute(
        """
        SELECT
            enriched_transactions.id,
            raw_transactions.account_id,
            raw_transactions.amount,
            raw_transactions.description,
            raw_transactions.counterparty_name,
            raw_transactions.counterparty_iban,
            merchants.name,
            categories.name,
            manual_overrides.id IS NOT NULL
        FROM enriched_transactions
        JOIN raw_transactions ON raw_transactions.id = enriched_transactions.raw_transaction_id
        LEFT JOIN merchants ON merchants.id = enriched_transactions.merchant_id
        LEFT JOIN categories ON categories.id = enriched_transactions.category_id
        LEFT JOIN manual_overrides ON manual_overrides.enriched_transaction_id = enriched_transactions.id
        ORDER BY enriched_transactions.id
        """
    ).fetchall()
    matches: list[_RuleTransactionMatch] = []
    for row in rows:
        transaction = TransactionForClassification(
            id=_read_int(row[0]),
            account_id=_read_int(row[1]),
            amount=_read_decimal(row[2]),
            description=str(row[3]),
            counterparty_name=_optional_str(row[4]),
            counterparty_iban=_optional_str(row[5]),
            merchant_name=_optional_str(row[6]),
        )
        if rule_matches(transaction, rule):
            matches.append(
                _RuleTransactionMatch(
                    transaction_id=transaction.id,
                    category_name=_optional_str(row[7]),
                    merchant_name=transaction.merchant_name,
                    has_manual_override=bool(row[8]),
                )
            )
    return matches


def _apply_rule_to_transaction(
    connection: Connection[tuple[object, ...]],
    rule: CategorizationRule,
    transaction_id: int,
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
            needs_review = false,
            classification_method = 'rule',
            classification_confidence = 1,
            classification_reason = %s,
            classification_model = NULL,
            classification_prompt_version = NULL,
            rule_id = %s,
            updated_at = now()
        WHERE id = %s
            AND NOT EXISTS (
                SELECT 1
                FROM manual_overrides
                WHERE manual_overrides.enriched_transaction_id = enriched_transactions.id
            )
        """,
        (
            rule.category,
            rule.merchant,
            rule.flags.is_income,
            rule.flags.is_transfer,
            rule.flags.is_savings,
            rule.flags.is_fixed_cost,
            rule.flags.is_excluded_from_budget,
            f"Backfilled from rule: {rule.name}",
            rule.id,
            transaction_id,
        ),
    )


def _merchant_id(connection: Connection[tuple[object, ...]], merchant_name: str | None) -> int | None:
    if merchant_name is None:
        return None
    row = connection.execute("SELECT id FROM merchants WHERE name = %s", (merchant_name,)).fetchone()
    if row is None:
        return None
    return _read_int(row[0])


def _upsert_merchant_id(
    connection: Connection[tuple[object, ...]],
    merchant_name: str | None,
    category_id: int,
) -> int | None:
    if merchant_name is None or merchant_name.strip() == "":
        return None
    normalized_name = merchant_name.strip().casefold()
    row = connection.execute(
        """
        INSERT INTO merchants (name, normalized_name, default_category_id)
        VALUES (%s, %s, %s)
        ON CONFLICT (normalized_name)
        DO UPDATE SET default_category_id = EXCLUDED.default_category_id, updated_at = now()
        RETURNING id
        """,
        (merchant_name.strip(), normalized_name, category_id),
    ).fetchone()
    if row is None:
        raise RuntimeError("merchant upsert did not return an id")
    return _read_int(row[0])


def _category_id(connection: Connection[tuple[object, ...]], category_name: str) -> int:
    row = connection.execute("SELECT id FROM categories WHERE name = %s", (category_name,)).fetchone()
    if row is None:
        raise ValueError(f"unknown category: {category_name}")
    return _read_int(row[0])


def _parse_priority(value: str) -> int:
    try:
        priority = int(value or "100")
    except ValueError as exc:
        raise ValueError("rule priority must be an integer") from exc
    if priority < 0:
        raise ValueError("rule priority must be non-negative")
    return priority


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


def _read_decimal(value: object) -> Decimal:
    if not isinstance(value, Decimal):
        raise RuntimeError(f"expected decimal, got {type(value).__name__}")
    return value


def _read_int(value: object) -> int:
    if not isinstance(value, int):
        raise RuntimeError(f"expected integer, got {type(value).__name__}")
    return value
