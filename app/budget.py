"""Category budget averages and current-month pace."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

import psycopg
from psycopg import Connection

FORECAST_EXCLUDED_CATEGORIES = frozenset({"Income", "Transfers", "Savings", "One-off / Large purchase", "Unknown"})
MONEY_QUANT = Decimal("0.01")


@dataclass(frozen=True)
class CategoryBudgetRow:
    category: str
    current_month: Decimal
    average_3m: Decimal
    average_6m: Decimal
    average_12m: Decimal
    suggested_budget: Decimal
    included_in_forecast: bool
    excluded_from_forecast: Decimal

    def as_template_context(self) -> dict[str, object]:
        return {
            "category": self.category,
            "current_month": _format_money(self.current_month),
            "average_3m": _format_money(self.average_3m),
            "average_6m": _format_money(self.average_6m),
            "average_12m": _format_money(self.average_12m),
            "suggested_budget": _format_money(self.suggested_budget),
            "included_in_forecast": self.included_in_forecast,
            "excluded_from_forecast": _format_money(self.excluded_from_forecast),
            "pace_label": _pace_label(self.current_month, self.suggested_budget),
        }


def load_category_budgets(database_url: str) -> list[CategoryBudgetRow]:
    with psycopg.connect(database_url) as connection:
        return load_category_budgets_in_connection(connection)


def load_category_budgets_in_connection(connection: Connection[tuple[object, ...]]) -> list[CategoryBudgetRow]:
    month_start = _current_budget_month(connection)
    next_month = _add_months(month_start, 1)
    start_3m = _add_months(month_start, -3)
    start_6m = _add_months(month_start, -6)
    start_12m = _add_months(month_start, -12)
    rows = connection.execute(
        """
        SELECT
            categories.name,
            COALESCE(sum(abs(raw_transactions.amount)) FILTER (
                WHERE raw_transactions.booking_date >= %s
                    AND raw_transactions.booking_date < %s
                    AND enriched_transactions.is_income = false
                    AND enriched_transactions.is_transfer = false
                    AND enriched_transactions.is_savings = false
                    AND enriched_transactions.is_excluded_from_budget = false
            ), 0),
            COALESCE(sum(abs(raw_transactions.amount)) FILTER (
                WHERE raw_transactions.booking_date >= %s
                    AND raw_transactions.booking_date < %s
                    AND enriched_transactions.is_income = false
                    AND enriched_transactions.is_transfer = false
                    AND enriched_transactions.is_savings = false
                    AND enriched_transactions.is_excluded_from_budget = false
            ), 0),
            COALESCE(sum(abs(raw_transactions.amount)) FILTER (
                WHERE raw_transactions.booking_date >= %s
                    AND raw_transactions.booking_date < %s
                    AND enriched_transactions.is_income = false
                    AND enriched_transactions.is_transfer = false
                    AND enriched_transactions.is_savings = false
                    AND enriched_transactions.is_excluded_from_budget = false
            ), 0),
            COALESCE(sum(abs(raw_transactions.amount)) FILTER (
                WHERE raw_transactions.booking_date >= %s
                    AND raw_transactions.booking_date < %s
                    AND enriched_transactions.is_income = false
                    AND enriched_transactions.is_transfer = false
                    AND enriched_transactions.is_savings = false
                    AND enriched_transactions.is_excluded_from_budget = false
            ), 0),
            COALESCE(sum(abs(raw_transactions.amount)) FILTER (
                WHERE raw_transactions.booking_date >= %s
                    AND raw_transactions.booking_date < %s
                    AND (
                        enriched_transactions.is_income = true
                        OR enriched_transactions.is_transfer = true
                        OR enriched_transactions.is_savings = true
                        OR enriched_transactions.is_excluded_from_budget = true
                    )
            ), 0)
        FROM categories
        LEFT JOIN enriched_transactions ON enriched_transactions.category_id = categories.id
        LEFT JOIN raw_transactions ON raw_transactions.id = enriched_transactions.raw_transaction_id
        GROUP BY categories.name
        ORDER BY
            CASE WHEN categories.name IN ('Income', 'Transfers', 'Savings', 'One-off / Large purchase', 'Unknown')
                THEN 1 ELSE 0 END,
            categories.name
        """,
        (
            month_start,
            next_month,
            start_3m,
            month_start,
            start_6m,
            month_start,
            start_12m,
            month_start,
            month_start,
            next_month,
        ),
    ).fetchall()
    return [_row_to_budget(row) for row in rows]


def _current_budget_month(connection: Connection[tuple[object, ...]]) -> date:
    row = connection.execute("SELECT year_month FROM monthly_forecasts ORDER BY year_month DESC LIMIT 1").fetchone()
    if row is not None:
        return date.fromisoformat(f"{row[0]}-01")
    return date.today().replace(day=1)


def _row_to_budget(row: tuple[object, ...]) -> CategoryBudgetRow:
    category = str(row[0])
    current_month = _read_money(row[1])
    average_3m = _read_money(row[2]) / Decimal("3")
    average_6m = _read_money(row[3]) / Decimal("6")
    average_12m = _read_money(row[4]) / Decimal("12")
    suggested_budget = _round_up_budget(max(current_month, average_3m, average_6m, average_12m))
    return CategoryBudgetRow(
        category=category,
        current_month=_quantize_money(current_month),
        average_3m=_quantize_money(average_3m),
        average_6m=_quantize_money(average_6m),
        average_12m=_quantize_money(average_12m),
        suggested_budget=suggested_budget,
        included_in_forecast=category not in FORECAST_EXCLUDED_CATEGORIES,
        excluded_from_forecast=_read_money(row[5]),
    )


def _add_months(month_start: date, offset: int) -> date:
    month_index = month_start.year * 12 + month_start.month - 1 + offset
    year = month_index // 12
    month = month_index % 12 + 1
    return date(year, month, 1)


def _read_money(value: object) -> Decimal:
    return Decimal(str(value)).quantize(MONEY_QUANT)


def _format_money(value: Decimal) -> str:
    return f"EUR {value:,.2f}"


def _round_up_budget(value: Decimal) -> Decimal:
    if value <= 0:
        return Decimal("0.00")
    rounded_units = int((value + Decimal("9.99")) // Decimal("10"))
    return Decimal(rounded_units * 10).quantize(MONEY_QUANT)


def _quantize_money(value: Decimal) -> Decimal:
    return value.quantize(MONEY_QUANT, rounding=ROUND_HALF_UP)


def _pace_label(current_month: Decimal, suggested_budget: Decimal) -> str:
    if suggested_budget <= 0:
        return "no budget yet"
    delta = current_month - suggested_budget
    if delta > 0:
        return f"{_format_money(delta)} over"
    if delta < 0:
        return f"{_format_money(abs(delta))} left"
    return "on budget"
