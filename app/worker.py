"""Background worker entrypoint."""

from __future__ import annotations

import signal
import time

from app.config import load_config


class StopSignal:
    def __init__(self) -> None:
        self.received = False

    def request_stop(self, _signum: int, _frame: object) -> None:
        self.received = True


def main() -> None:
    config = load_config()
    if not config.database_url:
        raise SystemExit("DATABASE_URL is required")

    stop_signal = StopSignal()
    signal.signal(signal.SIGINT, stop_signal.request_stop)
    signal.signal(signal.SIGTERM, stop_signal.request_stop)

    print("Treasuri worker ready", flush=True)
    while not stop_signal.received:
        time.sleep(5)


if __name__ == "__main__":
    main()
