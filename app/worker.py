"""Background worker entrypoint."""

from __future__ import annotations

from app.config import load_config
from app.jobs.worker import run_worker


def main() -> None:
    config = load_config()
    if not config.database_url:
        raise SystemExit("DATABASE_URL is required")
    import asyncio

    asyncio.run(run_worker(config))


if __name__ == "__main__":
    main()
