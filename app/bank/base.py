"""Bank adapter contracts."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Protocol


@dataclass(frozen=True)
class BankMutation:
    provider_transaction_id: str | None
    booking_date: date
    value_date: date | None
    amount: Decimal
    currency: str
    counterparty_name: str | None
    counterparty_iban: str | None
    description: str
    raw_payload: dict[str, str]


class BankAdapter(Protocol):
    provider: str

    def fetch_recent_mutations(self) -> list[BankMutation]:
        """Return recent bank mutations from the provider."""
        ...
