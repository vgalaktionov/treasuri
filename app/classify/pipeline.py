"""Deterministic-first transaction classification."""

from __future__ import annotations

import re
from dataclasses import dataclass
from decimal import Decimal
from enum import StrEnum


class ClassificationMethod(StrEnum):
    MANUAL_OVERRIDE = "manual_override"
    RULE = "rule"
    MERCHANT_ALIAS = "merchant_alias"
    HISTORICAL_SIMILARITY = "historical_similarity"
    LLM = "llm"
    UNCATEGORIZED = "uncategorized"


class MatchOperator(StrEnum):
    CONTAINS = "contains"
    EXACT = "exact"
    REGEX = "regex"
    STARTS_WITH = "starts_with"
    ENDS_WITH = "ends_with"
    AMOUNT_BETWEEN = "amount_between"


class MatchField(StrEnum):
    DESCRIPTION = "description"
    COUNTERPARTY_NAME = "counterparty_name"
    COUNTERPARTY_IBAN = "counterparty_iban"
    AMOUNT = "amount"
    ACCOUNT_ID = "account_id"
    MERCHANT = "merchant"


@dataclass(frozen=True)
class TransactionForClassification:
    id: int
    account_id: int
    amount: Decimal
    description: str
    counterparty_name: str | None = None
    counterparty_iban: str | None = None
    merchant_name: str | None = None


@dataclass(frozen=True)
class ClassificationFlags:
    is_income: bool | None = None
    is_transfer: bool | None = None
    is_savings: bool | None = None
    is_fixed_cost: bool | None = None
    is_one_off: bool | None = None
    is_excluded_from_budget: bool | None = None


@dataclass(frozen=True)
class ManualOverride:
    transaction_id: int
    category: str | None = None
    merchant: str | None = None
    flags: ClassificationFlags = ClassificationFlags()
    notes: str | None = None


@dataclass(frozen=True)
class CategorizationRule:
    id: int
    name: str
    priority: int
    field: MatchField
    operator: MatchOperator
    pattern: str
    category: str | None = None
    merchant: str | None = None
    flags: ClassificationFlags = ClassificationFlags()
    is_active: bool = True


@dataclass(frozen=True)
class MerchantAlias:
    merchant: str
    match_text: str
    match_type: MatchOperator
    priority: int = 100
    default_category: str | None = None
    is_active: bool = True


@dataclass(frozen=True)
class HistoricalExample:
    transaction_id: int
    amount: Decimal
    description: str
    counterparty_name: str | None
    category: str | None
    merchant: str | None


@dataclass(frozen=True)
class ClassificationResult:
    method: ClassificationMethod
    category: str | None
    merchant: str | None
    confidence: Decimal
    needs_review: bool
    reason: str
    rule_id: int | None = None
    model_ref: str | None = None
    prompt_version: str | None = None
    flags: ClassificationFlags = ClassificationFlags()


def classify_transaction(
    transaction: TransactionForClassification,
    *,
    manual_overrides: list[ManualOverride],
    rules: list[CategorizationRule],
    merchant_aliases: list[MerchantAlias],
    historical_examples: list[HistoricalExample] | None = None,
    similarity_threshold: Decimal = Decimal("0.65"),
) -> ClassificationResult:
    override = _find_manual_override(transaction, manual_overrides)
    if override is not None:
        return ClassificationResult(
            method=ClassificationMethod.MANUAL_OVERRIDE,
            category=override.category,
            merchant=override.merchant,
            confidence=Decimal("1"),
            needs_review=False,
            reason="Manual override always wins.",
            flags=override.flags,
        )

    for rule in sorted((rule for rule in rules if rule.is_active), key=lambda item: item.priority):
        if rule_matches(transaction, rule):
            return ClassificationResult(
                method=ClassificationMethod.RULE,
                category=rule.category,
                merchant=rule.merchant,
                confidence=Decimal("1"),
                needs_review=False,
                reason=f"Matched rule: {rule.name}",
                rule_id=rule.id,
                flags=rule.flags,
            )

    for alias in sorted((alias for alias in merchant_aliases if alias.is_active), key=lambda item: item.priority):
        if alias_matches(transaction, alias):
            return ClassificationResult(
                method=ClassificationMethod.MERCHANT_ALIAS,
                category=alias.default_category,
                merchant=alias.merchant,
                confidence=Decimal("0.95"),
                needs_review=alias.default_category is None,
                reason=f"Matched merchant alias for {alias.merchant}.",
            )

    historical_match = best_historical_match(
        transaction,
        historical_examples or [],
        threshold=similarity_threshold,
    )
    if historical_match is not None:
        example, score = historical_match
        return ClassificationResult(
            method=ClassificationMethod.HISTORICAL_SIMILARITY,
            category=example.category,
            merchant=example.merchant,
            confidence=score,
            needs_review=True,
            reason=f"Similar to manual correction #{example.transaction_id}.",
        )

    return ClassificationResult(
        method=ClassificationMethod.UNCATEGORIZED,
        category=None,
        merchant=transaction.merchant_name,
        confidence=Decimal("0"),
        needs_review=True,
        reason="No deterministic classifier matched.",
    )


def rule_matches(transaction: TransactionForClassification, rule: CategorizationRule) -> bool:
    value = _field_value(transaction, rule.field)
    return _matches(value, rule.operator, rule.pattern)


def alias_matches(transaction: TransactionForClassification, alias: MerchantAlias) -> bool:
    searchable_text = " ".join(
        part
        for part in (
            transaction.description,
            transaction.counterparty_name or "",
            transaction.merchant_name or "",
        )
        if part
    )
    return _matches(searchable_text, alias.match_type, alias.match_text)


def best_historical_match(
    transaction: TransactionForClassification,
    examples: list[HistoricalExample],
    *,
    threshold: Decimal,
) -> tuple[HistoricalExample, Decimal] | None:
    scored = [
        (example, historical_similarity_score(transaction, example))
        for example in examples
        if example.transaction_id != transaction.id
    ]
    if not scored:
        return None
    example, score = max(scored, key=lambda item: item[1])
    if score < threshold:
        return None
    return example, score


def historical_similarity_score(transaction: TransactionForClassification, example: HistoricalExample) -> Decimal:
    transaction_tokens = _tokens(
        " ".join(
            part
            for part in (
                transaction.description,
                transaction.counterparty_name or "",
                transaction.merchant_name or "",
            )
            if part
        )
    )
    example_tokens = _tokens(
        " ".join(
            part
            for part in (
                example.description,
                example.counterparty_name or "",
                example.merchant or "",
            )
            if part
        )
    )
    text_score = _jaccard(transaction_tokens, example_tokens)
    amount_score = Decimal("1") if _amount_band(transaction.amount) == _amount_band(example.amount) else Decimal("0")
    counterparty_score = (
        Decimal("1")
        if transaction.counterparty_name
        and example.counterparty_name
        and transaction.counterparty_name.casefold() == example.counterparty_name.casefold()
        else Decimal("0")
    )
    return (
        text_score * Decimal("0.75") + amount_score * Decimal("0.15") + counterparty_score * Decimal("0.10")
    ).quantize(Decimal("0.01"))


def _find_manual_override(
    transaction: TransactionForClassification, manual_overrides: list[ManualOverride]
) -> ManualOverride | None:
    for override in manual_overrides:
        if override.transaction_id == transaction.id:
            return override
    return None


def _tokens(value: str) -> set[str]:
    return {token for token in re.findall(r"[a-z0-9]+", value.casefold()) if len(token) >= 3}


def _jaccard(left: set[str], right: set[str]) -> Decimal:
    if not left or not right:
        return Decimal("0")
    return Decimal(len(left & right)) / Decimal(len(left | right))


def _amount_band(amount: Decimal) -> int:
    absolute = abs(amount)
    if absolute < Decimal("10"):
        return 0
    if absolute < Decimal("25"):
        return 1
    if absolute < Decimal("50"):
        return 2
    if absolute < Decimal("100"):
        return 3
    if absolute < Decimal("250"):
        return 4
    return 5


def _field_value(transaction: TransactionForClassification, field: MatchField) -> str:
    match field:
        case MatchField.DESCRIPTION:
            return transaction.description
        case MatchField.COUNTERPARTY_NAME:
            return transaction.counterparty_name or ""
        case MatchField.COUNTERPARTY_IBAN:
            return transaction.counterparty_iban or ""
        case MatchField.AMOUNT:
            return str(transaction.amount)
        case MatchField.ACCOUNT_ID:
            return str(transaction.account_id)
        case MatchField.MERCHANT:
            return transaction.merchant_name or ""


def _matches(value: str, operator: MatchOperator, pattern: str) -> bool:
    normalized_value = value.casefold()
    normalized_pattern = pattern.casefold()

    match operator:
        case MatchOperator.CONTAINS:
            return normalized_pattern in normalized_value
        case MatchOperator.EXACT:
            return normalized_value == normalized_pattern
        case MatchOperator.REGEX:
            return re.search(pattern, value, re.IGNORECASE) is not None
        case MatchOperator.STARTS_WITH:
            return normalized_value.startswith(normalized_pattern)
        case MatchOperator.ENDS_WITH:
            return normalized_value.endswith(normalized_pattern)
        case MatchOperator.AMOUNT_BETWEEN:
            return _amount_between(value, pattern)


def _amount_between(value: str, pattern: str) -> bool:
    lower_raw, separator, upper_raw = pattern.partition("..")
    if separator == "":
        raise ValueError("amount_between pattern must use '<lower>..<upper>'")
    amount = Decimal(value)
    lower = Decimal(lower_raw)
    upper = Decimal(upper_raw)
    return lower <= amount <= upper
