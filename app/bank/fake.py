"""Fake bank provider for development and tests."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from app.bank.base import BankMutation


class FakeBankAdapter:
    provider = "fake"

    def fetch_recent_mutations(self) -> list[BankMutation]:
        return [
            BankMutation(
                provider_transaction_id="fake-salary-2026-05",
                booking_date=date(2026, 5, 24),
                value_date=date(2026, 5, 24),
                amount=Decimal("5258.00"),
                currency="EUR",
                counterparty_name="Sample Employer",
                counterparty_iban=None,
                description="Monthly salary sample",
                raw_payload={"source": "fake", "kind": "salary"},
            ),
            BankMutation(
                provider_transaction_id="fake-groceries-2026-05",
                booking_date=date(2026, 5, 26),
                value_date=date(2026, 5, 26),
                amount=Decimal("-64.35"),
                currency="EUR",
                counterparty_name="Sample Supermarket",
                counterparty_iban=None,
                description="Groceries sample",
                raw_payload={"source": "fake", "kind": "groceries"},
            ),
            BankMutation(
                provider_transaction_id="fake-review-2026-05",
                booking_date=date(2026, 5, 27),
                value_date=date(2026, 5, 27),
                amount=Decimal("-42.10"),
                currency="EUR",
                counterparty_name="Unknown Sample Merchant",
                counterparty_iban=None,
                description="Needs review sample",
                raw_payload={"source": "fake", "kind": "unknown"},
            ),
        ]
