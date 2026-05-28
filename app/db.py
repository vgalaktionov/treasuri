"""Plain psycopg database helpers."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import psycopg
from flask import current_app
from psycopg import Connection


@contextmanager
def connect() -> Iterator[Connection[tuple[Any, ...]]]:
    database_url = current_app.config.get("DATABASE_URL", "")
    if not database_url:
        raise RuntimeError("DATABASE_URL is not configured")
    with psycopg.connect(database_url) as connection:
        yield connection


@contextmanager
def transaction() -> Iterator[Connection[tuple[Any, ...]]]:
    with connect() as connection:
        with connection.transaction():
            yield connection
