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


def test_abn_adapter_follows_pagination_until_max_pages() -> None:
    sessions: list[PagedAbnSession] = []

    def session_factory(iban: str) -> PagedAbnSession:
        session = PagedAbnSession(iban)
        sessions.append(session)
        return session

    adapter = AbnAmroAdapter(
        AbnCredentials(
            account_iban="NL01ABNA0123456789",
            card_number="123",
            soft_token="12345",
        ),
        session_factory=session_factory,
        max_pages=2,
    )

    mutations = adapter.fetch_recent_mutations()

    assert sessions[0].mutation_calls == [
        ("NL01ABNA0123456789", None),
        ("NL01ABNA0123456789", "cursor-1"),
    ]
    assert [mutation.provider_transaction_id for mutation in mutations] == ["abn-page-1", "abn-page-2"]


def test_abn_adapter_accepts_list_responses_and_cent_amounts() -> None:
    adapter = AbnAmroAdapter(
        AbnCredentials(
            account_iban="NL01ABNA0123456789",
            card_number="123",
            soft_token="12345",
        ),
        session_factory=ListAmountAbnSession,
    )

    mutations = adapter.fetch_recent_mutations()

    assert len(mutations) == 1
    assert mutations[0].provider_transaction_id == "abn-cents-1"
    assert mutations[0].booking_date == date(2026, 5, 27)
    assert mutations[0].value_date is None
    assert mutations[0].amount == Decimal("-42.10")
    assert mutations[0].currency == "EUR"
    assert mutations[0].description == "Card payment Sample bookshop"


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


class PagedAbnSession:
    def __init__(self, iban: str) -> None:
        self.iban = iban
        self.mutation_calls: list[tuple[str, str | None]] = []

    def login(self, card: str, token: str) -> None:
        _ = card, token

    def mutations(self, iban: str, last_key: str | None = None):
        self.mutation_calls.append((iban, last_key))
        assert iban == self.iban
        pages = {
            None: {
                "mutations": [
                    {
                        "mutationKey": "abn-page-1",
                        "bookingDate": "2026-05-24",
                        "amount": {"value": "-12.34", "currency": "EUR"},
                        "description": "First page sample",
                    }
                ],
                "lastMutationKey": "cursor-1",
            },
            "cursor-1": {
                "mutations": [
                    {
                        "mutationKey": "abn-page-2",
                        "bookingDate": "2026-05-25",
                        "amount": {"value": "-56.78", "currency": "EUR"},
                        "description": "Second page sample",
                    }
                ],
                "nextMutationKey": "cursor-2",
            },
        }
        return pages[last_key]


class ListAmountAbnSession:
    def __init__(self, _iban: str) -> None:
        pass

    def login(self, card: str, token: str) -> None:
        _ = card, token

    def mutations(self, iban: str, last_key: str | None = None):
        _ = iban, last_key
        return [
            {
                "transactionId": "abn-cents-1",
                "date": "2026-05-27",
                "amountInCents": -4210,
                "currencyCode": "eur",
                "remarks": ["Card payment", "Sample bookshop"],
            }
        ]
