from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from app.bank.abn import AbnAmroAdapter, AbnCredentials
from app.bank.factory import build_bank_adapter
from app.config import AppConfig, ConfigError


class FakeAbnSession:
    def __init__(self, iban: str) -> None:
        self.iban = iban
        self.login_calls: list[tuple[str, str]] = []

    def login(self, card: str, token: str) -> None:
        self.login_calls.append((card, token))

    def mutations(self, iban: str, last_key: str | None = None):
        assert iban == self.iban
        assert last_key is None
        return {
            "mutations": [
                {
                    "mutationKey": "abn-1",
                    "bookingDate": "2026-05-24",
                    "valueDate": "2026-05-25",
                    "amount": {"value": "-12.34", "currency": "EUR"},
                    "counterpartyName": "Sample Counterparty",
                    "counterpartyIban": "NL00ABNA0000000000",
                    "descriptionLines": ["Card payment", "Sample shop"],
                }
            ]
        }


def test_abn_adapter_maps_mutations_to_bank_contract() -> None:
    sessions: list[FakeAbnSession] = []

    def session_factory(iban: str) -> FakeAbnSession:
        session = FakeAbnSession(iban)
        sessions.append(session)
        return session

    adapter = AbnAmroAdapter(
        AbnCredentials(
            account_iban="NL01ABNA0123456789",
            card_number="123",
            soft_token="12345",
        ),
        session_factory=session_factory,
    )

    mutations = adapter.fetch_recent_mutations()

    assert sessions[0].login_calls == [("123", "12345")]
    assert mutations[0].provider_transaction_id == "abn-1"
    assert mutations[0].booking_date == date(2026, 5, 24)
    assert mutations[0].value_date == date(2026, 5, 25)
    assert mutations[0].amount == Decimal("-12.34")
    assert mutations[0].currency == "EUR"
    assert mutations[0].counterparty_name == "Sample Counterparty"
    assert mutations[0].counterparty_iban == "NL00ABNA0000000000"
    assert mutations[0].description == "Card payment Sample shop"
    assert mutations[0].raw_payload["mutationKey"] == "abn-1"


def test_abn_factory_requires_credentials_when_provider_is_abn() -> None:
    config = AppConfig(
        app_env="test",
        secret_key="test-secret",
        bank_provider="abn",
        abn_account_iban="NL01ABNA0123456789",
        abn_card_number="",
        abn_soft_token="12345",
    )

    with pytest.raises(ConfigError, match="ABN_CARD_NUMBER"):
        build_bank_adapter(config)


def test_abn_adapter_rejects_invalid_payload_shape() -> None:
    class BrokenSession:
        def __init__(self, _iban: str) -> None:
            pass

        def login(self, card: str, token: str) -> None:
            _ = card, token
            pass

        def mutations(self, iban: str, last_key: str | None = None):
            _ = iban, last_key
            return {"mutations": [{"bookingDate": "2026-05-24", "amount": "abc", "description": "bad"}]}

    adapter = AbnAmroAdapter(
        AbnCredentials(
            account_iban="NL01ABNA0123456789",
            card_number="123",
            soft_token="12345",
        ),
        session_factory=BrokenSession,
    )

    with pytest.raises(ValueError, match="amount"):
        adapter.fetch_recent_mutations()
