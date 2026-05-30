CREATE TABLE account_balance_snapshots (
    id bigserial PRIMARY KEY,
    account_id bigint NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    balance numeric(14, 2) NOT NULL,
    currency char(3) NOT NULL DEFAULT 'EUR',
    source text NOT NULL,
    as_of timestamptz NOT NULL,
    sync_run_id bigint REFERENCES sync_runs (id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (account_id, source, as_of)
);

CREATE INDEX account_balance_snapshots_latest_idx
    ON account_balance_snapshots (account_id, as_of DESC);
