from __future__ import annotations

from decimal import Decimal

import pytest

from app.classify.pipeline import (
    CategorizationRule,
    ClassificationFlags,
    ClassificationMethod,
    HistoricalExample,
    ManualOverride,
    MatchField,
    MatchOperator,
    MerchantAlias,
    RecurringMatch,
    TransactionForClassification,
    classify_transaction,
    recurring_match_matches,
    rule_matches,
)


def sample_transaction() -> TransactionForClassification:
    return TransactionForClassification(
        id=42,
        account_id=7,
        amount=Decimal("-18.95"),
        description="ALBERT HEIJN 1297 AMSTERDAM",
        counterparty_name="AH TO GO",
    )


def test_manual_override_wins_before_rules_and_aliases() -> None:
    result = classify_transaction(
        sample_transaction(),
        manual_overrides=[
            ManualOverride(
                transaction_id=42,
                category="Dog",
                merchant="Vet Clinic",
                flags=ClassificationFlags(is_excluded_from_budget=True),
            )
        ],
        rules=[
            CategorizationRule(
                id=1,
                name="Albert Heijn groceries",
                priority=1,
                field=MatchField.DESCRIPTION,
                operator=MatchOperator.CONTAINS,
                pattern="ALBERT HEIJN",
                category="Groceries",
                merchant="Albert Heijn",
            )
        ],
        merchant_aliases=[
            MerchantAlias(
                merchant="Albert Heijn",
                match_text="AH TO GO",
                match_type=MatchOperator.CONTAINS,
                default_category="Groceries",
            )
        ],
    )

    assert result.method == ClassificationMethod.MANUAL_OVERRIDE
    assert result.category == "Dog"
    assert result.merchant == "Vet Clinic"
    assert result.needs_review is False
    assert result.flags.is_excluded_from_budget is True


def test_highest_priority_matching_rule_wins() -> None:
    result = classify_transaction(
        sample_transaction(),
        manual_overrides=[],
        rules=[
            CategorizationRule(
                id=1,
                name="Generic supermarket",
                priority=50,
                field=MatchField.DESCRIPTION,
                operator=MatchOperator.CONTAINS,
                pattern="HEIJN",
                category="Shopping",
            ),
            CategorizationRule(
                id=2,
                name="Groceries at Albert Heijn",
                priority=10,
                field=MatchField.DESCRIPTION,
                operator=MatchOperator.CONTAINS,
                pattern="ALBERT HEIJN",
                category="Groceries",
                merchant="Albert Heijn",
            ),
        ],
        merchant_aliases=[],
    )

    assert result.method == ClassificationMethod.RULE
    assert result.rule_id == 2
    assert result.category == "Groceries"
    assert result.merchant == "Albert Heijn"


def test_merchant_alias_classifies_with_default_category() -> None:
    result = classify_transaction(
        sample_transaction(),
        manual_overrides=[],
        rules=[],
        merchant_aliases=[
            MerchantAlias(
                merchant="Albert Heijn",
                match_text="AH TO GO",
                match_type=MatchOperator.CONTAINS,
                default_category="Groceries",
            )
        ],
    )

    assert result.method == ClassificationMethod.MERCHANT_ALIAS
    assert result.category == "Groceries"
    assert result.merchant == "Albert Heijn"
    assert result.needs_review is False


def test_merchant_alias_supports_multiple_aliases_for_one_merchant() -> None:
    result = classify_transaction(
        TransactionForClassification(
            id=42,
            account_id=7,
            amount=Decimal("-12.50"),
            description="AH TO GO CENTRAL STATION",
            counterparty_name="AH TO GO",
        ),
        manual_overrides=[],
        rules=[],
        merchant_aliases=[
            MerchantAlias(
                merchant="Albert Heijn",
                match_text="albert heijn",
                match_type=MatchOperator.CONTAINS,
                default_category="Groceries",
            ),
            MerchantAlias(
                merchant="Albert Heijn",
                match_text="ah to go",
                match_type=MatchOperator.CONTAINS,
                default_category="Groceries",
            ),
        ],
    )

    assert result.method == ClassificationMethod.MERCHANT_ALIAS
    assert result.merchant == "Albert Heijn"
    assert result.category == "Groceries"


def test_alias_without_default_category_still_needs_review() -> None:
    result = classify_transaction(
        sample_transaction(),
        manual_overrides=[],
        rules=[],
        merchant_aliases=[
            MerchantAlias(
                merchant="Albert Heijn",
                match_text="AH TO GO",
                match_type=MatchOperator.CONTAINS,
            )
        ],
    )

    assert result.method == ClassificationMethod.MERCHANT_ALIAS
    assert result.category is None
    assert result.needs_review is True


def test_recurring_match_runs_before_historical_similarity() -> None:
    result = classify_transaction(
        TransactionForClassification(
            id=43,
            account_id=7,
            amount=Decimal("-13.20"),
            description="SAMPLE STREAMING MONTHLY",
            counterparty_name="Sample Streaming",
        ),
        manual_overrides=[],
        rules=[],
        merchant_aliases=[],
        recurring_matches=[
            RecurringMatch(
                id=9,
                name="Sample Streaming",
                category="Subscriptions",
                merchant="Sample Streaming",
                expected_amount=Decimal("12.99"),
                amount_tolerance=Decimal("1.00"),
            )
        ],
        historical_examples=[
            HistoricalExample(
                transaction_id=42,
                amount=Decimal("-13.20"),
                description="SAMPLE STREAMING MONTHLY",
                counterparty_name="Sample Streaming",
                category="Shopping",
                merchant="Sample Streaming",
            )
        ],
    )

    assert result.method == ClassificationMethod.RECURRING_MATCH
    assert result.category == "Subscriptions"
    assert result.merchant == "Sample Streaming"
    assert result.recurring_series_id == 9
    assert result.needs_review is False
    assert result.flags.is_fixed_cost is True
    assert result.flags.is_recurring is True


def test_recurring_match_requires_negative_amount_within_tolerance_and_text_match() -> None:
    match = RecurringMatch(
        id=9,
        name="Sample Streaming",
        category="Subscriptions",
        merchant="Sample Streaming",
        expected_amount=Decimal("12.99"),
        amount_tolerance=Decimal("1.00"),
    )

    assert recurring_match_matches(
        TransactionForClassification(
            id=43,
            account_id=7,
            amount=Decimal("-13.20"),
            description="SAMPLE STREAMING MONTHLY",
            counterparty_name=None,
        ),
        match,
    )
    assert not recurring_match_matches(
        TransactionForClassification(
            id=43,
            account_id=7,
            amount=Decimal("13.20"),
            description="SAMPLE STREAMING REFUND",
            counterparty_name=None,
        ),
        match,
    )
    assert not recurring_match_matches(
        TransactionForClassification(
            id=43,
            account_id=7,
            amount=Decimal("-19.20"),
            description="SAMPLE STREAMING MONTHLY",
            counterparty_name=None,
        ),
        match,
    )
    assert not recurring_match_matches(
        TransactionForClassification(
            id=43,
            account_id=7,
            amount=Decimal("-13.20"),
            description="UNRELATED MONTHLY",
            counterparty_name=None,
        ),
        match,
    )


def test_unmatched_transaction_is_marked_for_review() -> None:
    result = classify_transaction(
        sample_transaction(),
        manual_overrides=[],
        rules=[],
        merchant_aliases=[],
    )

    assert result.method == ClassificationMethod.UNCATEGORIZED
    assert result.category is None
    assert result.needs_review is True


def test_historical_similarity_suggests_from_manual_correction() -> None:
    result = classify_transaction(
        TransactionForClassification(
            id=43,
            account_id=7,
            amount=Decimal("-19.20"),
            description="ALBERT HEIJN AMSTERDAM CARD",
            counterparty_name="AH TO GO",
        ),
        manual_overrides=[],
        rules=[],
        merchant_aliases=[],
        historical_examples=[
            HistoricalExample(
                transaction_id=42,
                amount=Decimal("-18.95"),
                description="ALBERT HEIJN 1297 AMSTERDAM",
                counterparty_name="AH TO GO",
                category="Groceries",
                merchant="Albert Heijn",
            )
        ],
    )

    assert result.method == ClassificationMethod.HISTORICAL_SIMILARITY
    assert result.category == "Groceries"
    assert result.merchant == "Albert Heijn"
    assert result.needs_review is True


def test_historical_similarity_avoids_low_score_false_positive() -> None:
    result = classify_transaction(
        TransactionForClassification(
            id=43,
            account_id=7,
            amount=Decimal("-240.00"),
            description="SAMPLE INSURANCE PREMIUM",
            counterparty_name="Sample Insurance",
        ),
        manual_overrides=[],
        rules=[],
        merchant_aliases=[],
        historical_examples=[
            HistoricalExample(
                transaction_id=42,
                amount=Decimal("-18.95"),
                description="ALBERT HEIJN 1297 AMSTERDAM",
                counterparty_name="AH TO GO",
                category="Groceries",
                merchant="Albert Heijn",
            )
        ],
    )

    assert result.method == ClassificationMethod.UNCATEGORIZED
    assert result.category is None
    assert result.needs_review is True


@pytest.mark.parametrize(
    ("field", "operator", "pattern"),
    [
        (MatchField.DESCRIPTION, MatchOperator.CONTAINS, "heijn"),
        (MatchField.DESCRIPTION, MatchOperator.EXACT, "ALBERT HEIJN 1297 AMSTERDAM"),
        (MatchField.DESCRIPTION, MatchOperator.REGEX, r"heijn\s+\d+"),
        (MatchField.DESCRIPTION, MatchOperator.STARTS_WITH, "albert"),
        (MatchField.DESCRIPTION, MatchOperator.ENDS_WITH, "amsterdam"),
        (MatchField.AMOUNT, MatchOperator.AMOUNT_BETWEEN, "-20.00..-10.00"),
        (MatchField.ACCOUNT_ID, MatchOperator.EXACT, "7"),
    ],
)
def test_rule_operators_match(field: MatchField, operator: MatchOperator, pattern: str) -> None:
    rule = CategorizationRule(
        id=1,
        name="test",
        priority=1,
        field=field,
        operator=operator,
        pattern=pattern,
    )

    assert rule_matches(sample_transaction(), rule) is True


def test_amount_between_requires_range_pattern() -> None:
    rule = CategorizationRule(
        id=1,
        name="broken amount rule",
        priority=1,
        field=MatchField.AMOUNT,
        operator=MatchOperator.AMOUNT_BETWEEN,
        pattern="-20",
    )

    with pytest.raises(ValueError, match="amount_between"):
        rule_matches(sample_transaction(), rule)
