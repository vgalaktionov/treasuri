from __future__ import annotations

from types import SimpleNamespace

from app.bank.sync import SyncResult
from app.config import AppConfig
from app.jobs import sync as sync_job


class StubBankAdapter:
    provider = "stub"


def test_sync_now_uses_saved_sync_lookback_setting(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def sync_bank_transactions(*args, **kwargs):
        captured["args"] = args
        captured["kwargs"] = kwargs
        return SyncResult(
            provider="stub",
            new_transaction_count=1,
            updated_transaction_count=0,
            skipped_old_transaction_count=2,
        )

    monkeypatch.setattr(sync_job, "build_bank_adapter", lambda _config: (StubBankAdapter(), "NL00STUB0123456789"))
    monkeypatch.setattr(
        sync_job,
        "load_forecast_settings",
        lambda _database_url: SimpleNamespace(sync_lookback_days=42),
    )
    monkeypatch.setattr(sync_job, "sync_bank_transactions", sync_bank_transactions)
    monkeypatch.setattr(sync_job, "normalize_raw_transactions", lambda _database_url: SimpleNamespace(created_count=1))
    monkeypatch.setattr(
        sync_job,
        "classify_transactions",
        lambda _database_url, _config: SimpleNamespace(review_count=0),
    )
    monkeypatch.setattr(sync_job, "detect_recurring", lambda _database_url: SimpleNamespace(detected_count=0))
    monkeypatch.setattr(
        sync_job,
        "update_monthly_forecast",
        lambda _database_url: SimpleNamespace(year_month="2026-05"),
    )

    result = sync_job.run_sync_now(
        AppConfig(
            app_env="test",
            secret_key="test-secret",
            database_url="postgresql://example",
            oidc_enabled=False,
            llm_enabled=False,
        )
    )

    assert captured["kwargs"] == {
        "account_iban": "NL00STUB0123456789",
        "lookback_days": 42,
    }
    assert result.skipped_old_transaction_count == 2
    assert "2 outside lookback" in result.as_summary()
