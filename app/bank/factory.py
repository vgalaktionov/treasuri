"""Bank adapter factory."""

from __future__ import annotations

from app.bank.abn import AbnAmroAdapter, AbnCredentials
from app.bank.base import BankAdapter
from app.bank.fake import FakeBankAdapter
from app.config import AppConfig, ConfigError


def build_bank_adapter(config: AppConfig) -> tuple[BankAdapter, str]:
    if config.bank_provider == "fake":
        return FakeBankAdapter(), config.abn_account_iban or "NL00FAKE0123456789"

    if config.bank_provider in {"abn", "abn_amro"}:
        if not config.abn_account_iban:
            raise ConfigError("ABN_ACCOUNT_IBAN is required when BANK_PROVIDER=abn")
        if not config.abn_card_number:
            raise ConfigError("ABN_CARD_NUMBER is required when BANK_PROVIDER=abn")
        if not config.abn_soft_token:
            raise ConfigError("ABN_SOFT_TOKEN is required when BANK_PROVIDER=abn")
        return (
            AbnAmroAdapter(
                AbnCredentials(
                    account_iban=config.abn_account_iban,
                    card_number=config.abn_card_number,
                    soft_token=config.abn_soft_token,
                ),
                max_pages=config.abn_sync_pages,
            ),
            config.abn_account_iban,
        )

    raise ConfigError(f"unsupported BANK_PROVIDER: {config.bank_provider}")
