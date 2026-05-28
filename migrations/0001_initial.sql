CREATE TABLE accounts (
    id bigserial PRIMARY KEY,
    provider text NOT NULL,
    iban text NOT NULL,
    name text NOT NULL,
    currency char(3) NOT NULL DEFAULT 'EUR',
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (provider, iban)
);

CREATE TABLE categories (
    id bigserial PRIMARY KEY,
    name text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE merchants (
    id bigserial PRIMARY KEY,
    name text NOT NULL UNIQUE,
    normalized_name text NOT NULL UNIQUE,
    default_category_id bigint REFERENCES categories (id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE raw_transactions (
    id bigserial PRIMARY KEY,
    account_id bigint NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    provider text NOT NULL,
    provider_transaction_id text,
    source_hash text NOT NULL,
    booking_date date NOT NULL,
    value_date date,
    amount numeric(14, 2) NOT NULL,
    currency char(3) NOT NULL DEFAULT 'EUR',
    counterparty_name text,
    counterparty_iban text,
    description text NOT NULL DEFAULT '',
    raw_payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    first_seen_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (account_id, source_hash)
);

CREATE UNIQUE INDEX raw_transactions_provider_id_idx
    ON raw_transactions (provider, provider_transaction_id)
    WHERE provider_transaction_id IS NOT NULL;

CREATE INDEX raw_transactions_booking_date_idx ON raw_transactions (booking_date DESC);

CREATE TABLE recurring_series (
    id bigserial PRIMARY KEY,
    merchant_id bigint REFERENCES merchants (id),
    category_id bigint REFERENCES categories (id),
    name text NOT NULL,
    cadence text NOT NULL CHECK (cadence IN ('weekly', 'monthly', 'quarterly', 'yearly', 'irregular')),
    amount_mode text NOT NULL CHECK (amount_mode IN ('fixed', 'variable')),
    expected_amount numeric(14, 2),
    amount_tolerance numeric(14, 2),
    expected_day_of_month integer CHECK (expected_day_of_month BETWEEN 1 AND 31),
    next_expected_date date,
    confidence numeric(5, 4) NOT NULL DEFAULT 0,
    is_confirmed boolean NOT NULL DEFAULT false,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE merchant_aliases (
    id bigserial PRIMARY KEY,
    merchant_id bigint NOT NULL REFERENCES merchants (id) ON DELETE CASCADE,
    match_text text NOT NULL,
    match_type text NOT NULL CHECK (match_type IN ('contains', 'exact', 'regex')),
    priority integer NOT NULL DEFAULT 100,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX merchant_aliases_priority_idx ON merchant_aliases (is_active, priority);

CREATE TABLE categorization_rules (
    id bigserial PRIMARY KEY,
    name text NOT NULL,
    priority integer NOT NULL DEFAULT 100,
    is_active boolean NOT NULL DEFAULT true,
    field text NOT NULL CHECK (
        field IN ('description', 'counterparty_name', 'counterparty_iban', 'amount', 'account_id', 'merchant')
    ),
    operator text NOT NULL CHECK (
        operator IN ('contains', 'exact', 'regex', 'starts_with', 'ends_with', 'amount_between')
    ),
    pattern text NOT NULL,
    category_id bigint REFERENCES categories (id),
    merchant_id bigint REFERENCES merchants (id),
    set_is_income boolean,
    set_is_transfer boolean,
    set_is_savings boolean,
    set_is_fixed_cost boolean,
    set_is_excluded_from_budget boolean,
    created_from_transaction_id bigint,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX categorization_rules_priority_idx ON categorization_rules (is_active, priority);

CREATE TABLE enriched_transactions (
    id bigserial PRIMARY KEY,
    raw_transaction_id bigint NOT NULL UNIQUE REFERENCES raw_transactions (id) ON DELETE CASCADE,
    merchant_id bigint REFERENCES merchants (id),
    category_id bigint REFERENCES categories (id),
    subcategory text,
    is_income boolean NOT NULL DEFAULT false,
    is_transfer boolean NOT NULL DEFAULT false,
    is_savings boolean NOT NULL DEFAULT false,
    is_fixed_cost boolean NOT NULL DEFAULT false,
    is_variable_cost boolean NOT NULL DEFAULT true,
    is_recurring boolean NOT NULL DEFAULT false,
    is_one_off boolean NOT NULL DEFAULT false,
    is_excluded_from_budget boolean NOT NULL DEFAULT false,
    needs_review boolean NOT NULL DEFAULT true,
    classification_method text,
    classification_confidence numeric(5, 4),
    classification_reason text,
    classification_model text,
    classification_prompt_version text,
    rule_id bigint REFERENCES categorization_rules (id),
    recurring_series_id bigint REFERENCES recurring_series (id),
    notes text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX enriched_transactions_review_idx ON enriched_transactions (needs_review, updated_at DESC);
CREATE INDEX enriched_transactions_category_idx ON enriched_transactions (category_id);

ALTER TABLE categorization_rules
    ADD CONSTRAINT categorization_rules_created_from_transaction_id_fkey
    FOREIGN KEY (created_from_transaction_id) REFERENCES enriched_transactions (id);

CREATE TABLE manual_overrides (
    id bigserial PRIMARY KEY,
    enriched_transaction_id bigint NOT NULL UNIQUE REFERENCES enriched_transactions (id) ON DELETE CASCADE,
    category_id bigint REFERENCES categories (id),
    merchant_id bigint REFERENCES merchants (id),
    flags_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    notes text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE monthly_forecasts (
    id bigserial PRIMARY KEY,
    year_month char(7) NOT NULL UNIQUE,
    income_received numeric(14, 2) NOT NULL DEFAULT 0,
    expected_income_remaining numeric(14, 2) NOT NULL DEFAULT 0,
    fixed_costs_paid numeric(14, 2) NOT NULL DEFAULT 0,
    fixed_costs_upcoming numeric(14, 2) NOT NULL DEFAULT 0,
    variable_spent numeric(14, 2) NOT NULL DEFAULT 0,
    predicted_variable_remaining numeric(14, 2) NOT NULL DEFAULT 0,
    target_savings numeric(14, 2) NOT NULL DEFAULT 0,
    safety_buffer numeric(14, 2) NOT NULL DEFAULT 0,
    safe_to_spend numeric(14, 2) NOT NULL DEFAULT 0,
    safe_per_day numeric(14, 2) NOT NULL DEFAULT 0,
    projected_savings numeric(14, 2) NOT NULL DEFAULT 0,
    confidence text NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
    explanation_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sync_runs (
    id bigserial PRIMARY KEY,
    provider text NOT NULL,
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    status text NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    new_transaction_count integer NOT NULL DEFAULT 0,
    updated_transaction_count integer NOT NULL DEFAULT 0,
    error_message text,
    metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX sync_runs_started_at_idx ON sync_runs (started_at DESC);

CREATE TABLE export_runs (
    id bigserial PRIMARY KEY,
    export_type text NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    status text NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    started_at timestamptz,
    finished_at timestamptz,
    error_message text,
    created_by text,
    metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE export_files (
    id bigserial PRIMARY KEY,
    export_run_id bigint NOT NULL REFERENCES export_runs (id) ON DELETE CASCADE,
    filename text NOT NULL,
    content_type text NOT NULL,
    content bytea NOT NULL,
    size_bytes integer NOT NULL CHECK (size_bytes >= 0),
    sha256 text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app_settings (
    key text PRIMARY KEY,
    value_json jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
