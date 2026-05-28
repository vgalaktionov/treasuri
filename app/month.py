"""Current-month read model."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

import psycopg
from psycopg import Connection

from app.budget import CategoryBudgetRow, load_category_budgets_in_connection


@dataclass(frozen=True)
class MonthMetric:
    label: str
    value: str
    detail: str


@dataclass(frozen=True)
class MonthCategoryPace:
    category: str
    current_month: str
    suggested_budget: str
    pace_label: str
    status: str


@dataclass(frozen=True)
class MonthSummary:
    month: str
    safe_to_spend: str
    safe_per_day: str
    projected_savings: str
    confidence: str
    fixed_costs: MonthMetric
    income: MonthMetric
    uncategorized: MonthMetric
    category_pace: tuple[MonthCategoryPace, ...]

    def as_template_context(self) -> dict[str, object]:
        return {
            "month": self.month,
            "safe_to_spend": self.safe_to_spend,
            "safe_per_day": self.safe_per_day,
            "projected_savings": self.projected_savings,
            "confidence": self.confidence,
            "fixed_costs": self.fixed_costs,
            "income": self.income,
            "uncategorized": self.uncategorized,
            "category_pace": self.category_pace,
        }


FALLBACK_MONTH_SUMMARY = MonthSummary(
    month="Sample month",
    safe_to_spend="EUR 558",
    safe_per_day="EUR 93/day",
    projected_savings="EUR 1,558",
    confidence="Medium",
    fixed_costs=MonthMetric("Fixed costs", "EUR 2,070", "EUR 1,450 paid, EUR 620 upcoming"),
    income=MonthMetric("Income status", "Income received", "EUR 5,258 received, EUR 0 expected"),
    uncategorized=MonthMetric("Uncategorized impact", "EUR 42", "1 transaction still needs review"),
    category_pace=(),
)


def load_month_summary(database_url: str) -> MonthSummary:
    with psycopg.connect(database_url) as connection:
        return load_month_summary_in_connection(connection)


def load_month_summary_in_connection(connection: Connection[tuple[object, ...]]) -> MonthSummary:
    forecast = connection.execute(
        """
        SELECT
            year_month,
            safe_to_spend,
            safe_per_day,
            projected_savings,
            confidence,
            income_received,
            expected_income_remaining,
            fixed_costs_paid,
            fixed_costs_upcoming
        FROM monthly_forecasts
        ORDER BY year_month DESC, updated_at DESC
        LIMIT 1
        """
    ).fetchone()
    if forecast is None:
        return FALLBACK_MONTH_SUMMARY

    year_month = str(forecast[0])
    uncategorized_count, uncategorized_amount = _uncategorized_impact(connection, year_month)
    categories = tuple(
        _to_category_pace(row) for row in load_category_budgets_in_connection(connection) if _show_pace(row)
    )

    income_received = _read_money(forecast[5])
    expected_income_remaining = _read_money(forecast[6])
    fixed_paid = _read_money(forecast[7])
    fixed_upcoming = _read_money(forecast[8])

    return MonthSummary(
        month=_format_year_month(year_month),
        safe_to_spend=_format_money(forecast[1]),
        safe_per_day=f"{_format_money(forecast[2])}/day",
        projected_savings=_format_money(forecast[3]),
        confidence=str(forecast[4]).title(),
        fixed_costs=MonthMetric(
            "Fixed costs",
            _format_money(fixed_paid + fixed_upcoming),
            f"{_format_money(fixed_paid)} paid, {_format_money(fixed_upcoming)} upcoming",
        ),
        income=MonthMetric(
            "Income status",
            _income_status(income_received, expected_income_remaining),
            f"{_format_money(income_received)} received, {_format_money(expected_income_remaining)} expected",
        ),
        uncategorized=MonthMetric(
            "Uncategorized impact",
            _format_money(uncategorized_amount),
            _format_uncategorized_detail(uncategorized_count),
        ),
        category_pace=categories,
    )


def _uncategorized_impact(connection: Connection[tuple[object, ...]], year_month: str) -> tuple[int, Decimal]:
    row = connection.execute(
        """
        SELECT count(*), COALESCE(sum(abs(raw_transactions.amount)), 0)
        FROM enriched_transactions
        JOIN raw_transactions ON raw_transactions.id = enriched_transactions.raw_transaction_id
        JOIN categories ON categories.id = enriched_transactions.category_id
        WHERE to_char(raw_transactions.booking_date, 'YYYY-MM') = %s
            AND raw_transactions.amount < 0
            AND enriched_transactions.is_income = false
            AND enriched_transactions.is_transfer = false
            AND (
                enriched_transactions.needs_review = true
                OR categories.name = 'Unknown'
            )
        """,
        (year_month,),
    ).fetchone()
    if row is None:
        return 0, Decimal("0.00")
    return _read_count(row[0]), _read_money(row[1])


def _to_category_pace(row: CategoryBudgetRow) -> MonthCategoryPace:
    status = "ok"
    if row.suggested_budget <= 0:
        status = "empty"
    elif row.current_month > row.suggested_budget:
        status = "over"
    elif row.current_month >= row.suggested_budget * Decimal("0.8"):
        status = "watch"
    return MonthCategoryPace(
        category=row.category,
        current_month=_format_money(row.current_month),
        suggested_budget=_format_money(row.suggested_budget),
        pace_label=str(row.as_template_context()["pace_label"]),
        status=status,
    )


def _show_pace(row: CategoryBudgetRow) -> bool:
    return row.included_in_forecast and (row.current_month > 0 or row.suggested_budget > 0)


def _income_status(income_received: Decimal, expected_income_remaining: Decimal) -> str:
    if income_received > 0 and expected_income_remaining <= 0:
        return "Income received"
    if income_received > 0:
        return "Income partly received"
    if expected_income_remaining > 0:
        return "Income expected"
    return "No income seen yet"


def _format_uncategorized_detail(count: int) -> str:
    if count == 1:
        return "1 transaction still needs review"
    return f"{count} transactions still need review"


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


def _format_money(value: object) -> str:
    amount = _read_money(value).quantize(Decimal("1"))
    sign = "-" if amount < 0 else ""
    absolute = abs(amount)
    return f"{sign}EUR {absolute:,.0f}"


def _read_money(value: object) -> Decimal:
    return Decimal(str(value)).quantize(Decimal("0.01"))


def _read_count(value: object) -> int:
    if not isinstance(value, int):
        raise RuntimeError(f"expected integer count, got {type(value).__name__}")
    return value
