"""Sync job task implementation."""

from __future__ import annotations

from dataclasses import dataclass

from app.bank.factory import build_bank_adapter
from app.bank.sync import sync_bank_transactions
from app.classify.service import classify_transactions
from app.config import AppConfig
from app.forecast.service import update_monthly_forecast
from app.normalize import normalize_raw_transactions
from app.recurring import detect_recurring


@dataclass(frozen=True)
class SyncNowResult:
    provider: str
    new_transaction_count: int
    updated_transaction_count: int
    normalized_count: int
    review_count: int
    recurring_detected_count: int
    forecast_year_month: str

    def as_summary(self) -> str:
        return (
            f"Synced {self.provider}: {self.new_transaction_count} new, "
            f"{self.updated_transaction_count} updated, "
            f"{self.normalized_count} normalized, "
            f"{self.review_count} still need review, "
            f"{self.recurring_detected_count} recurring detected, "
            f"{self.forecast_year_month} forecast updated"
        )


def run_sync_now(config: AppConfig) -> SyncNowResult:
    adapter, account_iban = build_bank_adapter(config)
    sync_result = sync_bank_transactions(config.database_url, adapter, account_iban=account_iban)
    normalize_result = normalize_raw_transactions(config.database_url)
    classify_result = classify_transactions(config.database_url, config)
    recurring_result = detect_recurring(config.database_url)
    forecast_result = update_monthly_forecast(config.database_url)
    return SyncNowResult(
        provider=sync_result.provider,
        new_transaction_count=sync_result.new_transaction_count,
        updated_transaction_count=sync_result.updated_transaction_count,
        normalized_count=normalize_result.created_count,
        review_count=classify_result.review_count,
        recurring_detected_count=recurring_result.detected_count,
        forecast_year_month=forecast_result.year_month,
    )
