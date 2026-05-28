from __future__ import annotations

from app.categories import DEFAULT_CATEGORIES


def test_default_categories_match_prd_taxonomy() -> None:
    assert DEFAULT_CATEGORIES == (
        "Income",
        "Transfers",
        "Savings",
        "Rent / Mortgage",
        "Utilities",
        "Insurance",
        "Groceries",
        "Eating out",
        "Transport",
        "Car",
        "Dog",
        "Health",
        "Subscriptions",
        "Shopping",
        "Household",
        "Entertainment",
        "Travel",
        "Gifts",
        "Taxes",
        "Fees",
        "One-off / Large purchase",
        "Unknown",
    )
