"""ABN AMRO adapter backed by the abna library."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any, Protocol, cast

import abna

from app.bank.base import BankMutation


class AbnSession(Protocol):
    def login(self, card: str, token: str) -> None: ...

    def mutations(self, iban: str, last_key: str | None = None) -> Any: ...


SessionFactory = Callable[[str], AbnSession]


@dataclass(frozen=True)
class AbnCredentials:
    account_iban: str
    card_number: str
    soft_token: str


class AbnAmroAdapter:
    provider = "abn_amro"

    def __init__(
        self,
        credentials: AbnCredentials,
        *,
        session_factory: SessionFactory = abna.Session,
        max_pages: int = 1,
    ) -> None:
        if max_pages < 1:
            raise ValueError("max_pages must be at least 1")
        self.credentials = credentials
        self.session_factory = session_factory
        self.max_pages = max_pages

    def fetch_recent_mutations(self) -> list[BankMutation]:
        session = self.session_factory(self.credentials.account_iban)
        session.login(self.credentials.card_number, self.credentials.soft_token)

        mutations: list[BankMutation] = []
        last_key: str | None = None
        for _page in range(self.max_pages):
            response = session.mutations(self.credentials.account_iban, last_key=last_key)
            mutations.extend(_parse_mutation(item) for item in _extract_mutation_items(response))
            next_key = _extract_next_key(response)
            if next_key is None or next_key == last_key:
                break
            last_key = next_key
        return mutations


def _extract_mutation_items(response: Any) -> list[Mapping[str, Any]]:
    if isinstance(response, list):
        return [_expect_mapping(item) for item in response]
    if not isinstance(response, Mapping):
        raise ValueError("ABN mutations response must be a JSON object or list")
    for key in ("mutations", "accountMutations", "transactions", "items"):
        value = response.get(key)
        if isinstance(value, list):
            return [_expect_mapping(item) for item in value]
    raise ValueError("ABN mutations response did not contain a supported mutation list")


def _extract_next_key(response: Any) -> str | None:
    if not isinstance(response, Mapping):
        return None
    for key in ("lastMutationKey", "nextMutationKey", "nextKey"):
        value = response.get(key)
        if value is not None and str(value).strip():
            return str(value)
    return None


def _parse_mutation(payload: Mapping[str, Any]) -> BankMutation:
    amount, currency = _read_amount_and_currency(payload)
    return BankMutation(
        provider_transaction_id=_first_text(
            payload,
            ("transactionId", "mutationId", "id", "mutationKey", "transactionKey"),
        ),
        booking_date=_read_date(payload, ("bookingDate", "bookDate", "transactionDate", "mutationDate", "date")),
        value_date=_read_optional_date(payload, ("valueDate", "valutaDate")),
        amount=amount,
        currency=currency,
        counterparty_name=_first_text(
            payload,
            ("counterpartyName", "counterPartyName", "contraAccountName", "name", "accountName"),
        ),
        counterparty_iban=_first_text(
            payload,
            ("counterpartyIban", "counterPartyAccountNumber", "contraAccountNumber", "accountNumber", "iban"),
        ),
        description=_read_description(payload),
        raw_payload=dict(payload),
    )


def _read_amount_and_currency(payload: Mapping[str, Any]) -> tuple[Decimal, str]:
    amount_value = payload.get("amount")
    currency_value: object = payload.get("currency") or payload.get("currencyCode")
    if isinstance(amount_value, Mapping):
        currency_value = amount_value.get("currency") or amount_value.get("currencyCode") or currency_value
        amount_value = amount_value.get("value") or amount_value.get("amount")
    elif amount_value is None:
        amount_value = payload.get("transactionAmount") or payload.get("mutationAmount")

    if amount_value is None and payload.get("amountInCents") is not None:
        amount_value = Decimal(str(payload["amountInCents"])) / Decimal("100")

    try:
        amount = Decimal(str(amount_value))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise ValueError("ABN mutation amount is missing or invalid") from exc

    currency = str(currency_value or "EUR").strip().upper()
    if len(currency) != 3:
        raise ValueError("ABN mutation currency must be a three-letter code")
    return amount, currency


def _read_description(payload: Mapping[str, Any]) -> str:
    for key in ("description", "remittanceInformation", "mutationDescription", "remarks"):
        value = payload.get(key)
        if isinstance(value, list):
            text = " ".join(str(item).strip() for item in value if str(item).strip())
        else:
            text = str(value).strip() if value is not None else ""
        if text:
            return text

    lines = payload.get("descriptionLines")
    if isinstance(lines, list):
        text = " ".join(str(item).strip() for item in lines if str(item).strip())
        if text:
            return text
    raise ValueError("ABN mutation description is missing")


def _read_date(payload: Mapping[str, Any], keys: tuple[str, ...]) -> date:
    value = _first_text(payload, keys)
    if value is None:
        raise ValueError("ABN mutation date is missing")
    try:
        return date.fromisoformat(value[:10])
    except ValueError as exc:
        raise ValueError(f"ABN mutation date is invalid: {value}") from exc


def _read_optional_date(payload: Mapping[str, Any], keys: tuple[str, ...]) -> date | None:
    value = _first_text(payload, keys)
    if value is None:
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError as exc:
        raise ValueError(f"ABN mutation date is invalid: {value}") from exc


def _first_text(payload: Mapping[str, Any], keys: tuple[str, ...]) -> str | None:
    for key in keys:
        value = payload.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return None


def _expect_mapping(value: object) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ValueError("ABN mutation item must be a JSON object")
    return cast(Mapping[str, Any], value)
