"""Dashboard read model."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

import psycopg


@dataclass(frozen=True)
class DashboardSummary:
    month: str
    safe_to_spend: str
    safe_per_day: str
    projected_savings: str
    target_savings: str
    confidence: str
    pace: str
    review_count: int
    last_sync: str

    def as_template_context(self) -> dict[str, str | int]:
        return {
            "month": self.month,
            "safe_to_spend": self.safe_to_spend,
            "safe_per_day": self.safe_per_day,
            "projected_savings": self.projected_savings,
            "target_savings": self.target_savings,
            "confidence": self.confidence,
            "pace": self.pace,
            "review_count": self.review_count,
            "last_sync": self.last_sync,
        }


FALLBACK_DASHBOARD_SUMMARY = DashboardSummary(
    month="Sample month",
    safe_to_spend="EUR 558",
    safe_per_day="EUR 93/day",
    projected_savings="EUR 1,087",
    target_savings="EUR 1,000",
    confidence="Medium",
    pace="EUR 142 ahead of normal pace",
    review_count=7,
    last_sync="Sample data only",
)


def load_dashboard_summary(database_url: str) -> DashboardSummary:
    with psycopg.connect(database_url) as connection:
        forecast = connection.execute(
            """
            SELECT
                year_month,
                safe_to_spend,
                safe_per_day,
                projected_savings,
                target_savings,
                confidence
            FROM monthly_forecasts
            ORDER BY year_month DESC, updated_at DESC
            LIMIT 1
            """
        ).fetchone()
        if forecast is None:
            return FALLBACK_DASHBOARD_SUMMARY

        review_count_row = connection.execute(
            "SELECT count(*) FROM enriched_transactions WHERE needs_review = true"
        ).fetchone()
        last_sync_row = connection.execute(
            """
            SELECT provider, status, finished_at
            FROM sync_runs
            ORDER BY started_at DESC, id DESC
            LIMIT 1
            """
        ).fetchone()

    review_count = int(review_count_row[0]) if review_count_row is not None else 0
    return DashboardSummary(
        month=_format_year_month(str(forecast[0])),
        safe_to_spend=_format_money(forecast[1]),
        safe_per_day=f"{_format_money(forecast[2])}/day",
        projected_savings=_format_money(forecast[3]),
        target_savings=_format_money(forecast[4]),
        confidence=str(forecast[5]).title(),
        pace="EUR 142 ahead of normal pace",
        review_count=review_count,
        last_sync=_format_sync(last_sync_row),
    )


def _format_money(value: object) -> str:
    amount = Decimal(str(value)).quantize(Decimal("1"))
    sign = "-" if amount < 0 else ""
    absolute = abs(amount)
    return f"{sign}EUR {absolute:,.0f}"


def _format_year_month(year_month: str) -> str:
    year, month = year_month.split("-")
    month_names = {
        "01": "January",
        "02": "February",
        "03": "March",
        "04": "April",
        "05": "May",
        "06": "June",
        "07": "July",
        "08": "August",
        "09": "September",
        "10": "October",
        "11": "November",
        "12": "December",
    }
    return f"{month_names[month]} {year}"


def _format_sync(row: tuple[object, ...] | None) -> str:
    if row is None:
        return "No sync yet"
    provider, status, finished_at = row
    if finished_at is None:
        return f"{provider} {status}"
    return f"{provider} {status} at {finished_at:%Y-%m-%d %H:%M}"
