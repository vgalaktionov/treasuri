import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Database, Filter, RotateCcw, Save, Search } from "lucide-react";
import type { FormEvent } from "react";
import { useMemo, useState } from "react";

import type {
  TransactionFilters,
  TransactionsResponse,
  TransactionUpdateRequest,
} from "../../shared/management.ts";
import { fetchTransactionRawDetails, fetchTransactions, updateTransaction } from "../lib/api.ts";

const kindOptions = [
  ["", "All types"],
  ["uncategorized", "Uncategorized"],
  ["income", "Income"],
  ["spending", "Spending"],
  ["transfer", "Transfers"],
  ["savings", "Savings"],
  ["fixed", "Fixed costs"],
  ["recurring", "Recurring"],
  ["one_off", "One-off"],
  ["excluded", "Excluded"],
] as const;

export function TransactionWorkspace() {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState(readFiltersFromUrl);
  const transactions = useQuery({
    queryFn: () => fetchTransactions(filters),
    queryKey: ["transactions", filters],
  });
  const update = useMutation({
    mutationFn: ({ id, input }: { id: number; input: TransactionUpdateRequest }) =>
      updateTransaction(id, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["transactions"] }),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    window.history.replaceState(null, "", urlForFilters(filters));
    queryClient.invalidateQueries({ queryKey: ["transactions"] });
  }

  function clearFilters() {
    setFilters({});
    window.history.replaceState(null, "", "/transactions");
  }

  return (
    <section>
      <header className="mb-4">
        <p className="font-medium text-treasuri-muted text-xs sm:text-sm">History</p>
        <h1 className="mt-1 font-semibold text-lg sm:text-xl">Transactions</h1>
      </header>

      <TransactionFiltersBar
        data={transactions.data}
        filters={filters}
        onChange={setFilters}
        onClear={clearFilters}
        onSubmit={submit}
      />

      <div className="mt-3 space-y-2">
        {transactions.data?.transactions.map((transaction) => (
          <TransactionRow
            categories={transactions.data.categories}
            disabled={update.isPending}
            key={transaction.id}
            onSave={(input) => update.mutate({ id: transaction.id, input })}
            transaction={transaction}
          />
        ))}
        {transactions.data?.transactions.length === 0 ? (
          <div className="rounded-md border border-treasuri-line bg-white p-2 text-sm sm:p-3">
            No transactions match these filters.
          </div>
        ) : null}
      </div>
    </section>
  );
}

function TransactionFiltersBar({
  data,
  filters,
  onChange,
  onClear,
  onSubmit,
}: {
  data: TransactionsResponse | undefined;
  filters: TransactionFilters;
  onChange: (filters: TransactionFilters) => void;
  onClear: () => void;
  onSubmit: (event: FormEvent) => void;
}) {
  const hasFilters = Object.values(filters).some((value) => value !== undefined && value !== "");
  const update = (patch: Partial<TransactionFilters>) => onChange({ ...filters, ...patch });

  return (
    <form
      className="rounded-md border border-treasuri-line bg-white p-2 sm:p-3"
      onSubmit={onSubmit}
    >
      <div className="grid gap-2 md:grid-cols-[minmax(180px,1.5fr)_repeat(4,minmax(120px,1fr))_auto]">
        <label className="relative block">
          <Search
            aria-hidden="true"
            className="-translate-y-1/2 absolute top-1/2 left-3 size-4 text-treasuri-muted"
          />
          <input
            aria-label="Search transactions"
            className="min-h-8 w-full rounded-md border border-treasuri-line bg-white pr-3 pl-9 text-xs sm:min-h-9 sm:text-sm"
            onChange={(event) => update({ query: event.target.value || undefined })}
            placeholder="Merchant or description"
            value={filters.query ?? ""}
          />
        </label>
        <input
          aria-label="Month"
          className="min-h-8 rounded-md border border-treasuri-line bg-white px-2 text-xs sm:min-h-9 sm:px-3 sm:text-sm"
          onChange={(event) => update({ month: event.target.value || undefined })}
          type="month"
          value={filters.month ?? ""}
        />
        <select
          aria-label="Category filter"
          className="min-h-8 rounded-md border border-treasuri-line bg-white px-2 text-xs sm:min-h-9 sm:px-3 sm:text-sm"
          onChange={(event) => update({ category: event.target.value || undefined })}
          value={filters.category ?? ""}
        >
          <option value="">All categories</option>
          {data?.categories.map((category) => (
            <option key={category.id} value={category.name}>
              {category.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Merchant filter"
          className="min-h-8 rounded-md border border-treasuri-line bg-white px-2 text-xs sm:min-h-9 sm:px-3 sm:text-sm"
          onChange={(event) => update({ merchant: event.target.value || undefined })}
          value={filters.merchant ?? ""}
        >
          <option value="">All merchants</option>
          {data?.merchants.map((merchant) => (
            <option key={merchant} value={merchant}>
              {merchant}
            </option>
          ))}
        </select>
        <select
          aria-label="Type filter"
          className="min-h-8 rounded-md border border-treasuri-line bg-white px-2 text-xs sm:min-h-9 sm:px-3 sm:text-sm"
          onChange={(event) => update({ kind: event.target.value || undefined })}
          value={filters.kind ?? ""}
        >
          {kindOptions.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <div className="flex gap-2">
          <button
            className="inline-flex min-h-8 items-center gap-2 rounded-md bg-treasuri-action px-3 font-semibold text-xs text-white sm:min-h-9 sm:text-sm"
            type="submit"
          >
            <Filter aria-hidden="true" className="size-4" />
            Filter
          </button>
          {hasFilters ? (
            <button
              className="inline-flex min-h-8 items-center rounded-md border border-treasuri-line px-3 sm:min-h-9"
              onClick={onClear}
              type="button"
            >
              <RotateCcw aria-label="Clear filters" className="size-4" />
            </button>
          ) : null}
        </div>
      </div>
      <details className="mt-2">
        <summary className="inline-flex cursor-pointer items-center gap-1 text-treasuri-muted text-xs sm:text-sm">
          <ChevronDown aria-hidden="true" className="size-4" />
          Amount and review filters
        </summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <input
            aria-label="Amount at least"
            className="min-h-8 rounded-md border border-treasuri-line bg-white px-2 text-xs sm:min-h-9 sm:px-3 sm:text-sm"
            min="0"
            onChange={(event) => update({ minAmount: event.target.value || undefined })}
            placeholder="Min amount"
            step="0.01"
            type="number"
            value={filters.minAmount ?? ""}
          />
          <input
            aria-label="Amount at most"
            className="min-h-8 rounded-md border border-treasuri-line bg-white px-2 text-xs sm:min-h-9 sm:px-3 sm:text-sm"
            min="0"
            onChange={(event) => update({ maxAmount: event.target.value || undefined })}
            placeholder="Max amount"
            step="0.01"
            type="number"
            value={filters.maxAmount ?? ""}
          />
          <label className="flex min-h-8 items-center gap-2 rounded-md border border-treasuri-line px-2 text-xs sm:min-h-9 sm:px-3 sm:text-sm">
            <input
              checked={filters.needsReview ?? false}
              onChange={(event) => update({ needsReview: event.target.checked || undefined })}
              type="checkbox"
            />
            Review only
          </label>
        </div>
      </details>
    </form>
  );
}

function TransactionRow({
  categories,
  disabled,
  onSave,
  transaction,
}: {
  categories: TransactionsResponse["categories"];
  disabled: boolean;
  onSave: (input: TransactionUpdateRequest) => void;
  transaction: TransactionsResponse["transactions"][number];
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [categoryId, setCategoryId] = useState(transaction.categoryId ?? categories[0]?.id ?? 0);
  const [merchantName, setMerchantName] = useState(transaction.merchant);
  const [createAlias, setCreateAlias] = useState(false);
  const [flags, setFlags] = useState(() => flagsFromLabels(transaction.flags));
  const rawDetails = useQuery({
    enabled: showRaw,
    queryFn: () => fetchTransactionRawDetails(transaction.id),
    queryKey: ["transaction-raw", transaction.id],
  });
  const amountClass = transaction.amount.startsWith("-") ? "text-stone-950" : "text-emerald-700";

  const flagLabels = useMemo(
    () => transaction.flags.concat(transaction.needsReview ? ["review"] : []),
    [transaction.flags, transaction.needsReview],
  );

  return (
    <article className="rounded-md border border-treasuri-line bg-white p-2 sm:p-3">
      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-treasuri-muted">
            <span>{transaction.bookingDate}</span>
            <span>{transaction.categoryName ?? "Uncategorized"}</span>
            <span>{transaction.classificationMethod ?? "none"}</span>
            {flagLabels.map((flag) => (
              <span className="rounded border border-treasuri-line px-1.5 py-0.5" key={flag}>
                {flag}
              </span>
            ))}
          </div>
          <h2 className="mt-1 truncate font-semibold text-sm sm:text-base">
            {transaction.merchant}
          </h2>
          <p className="mt-1 text-treasuri-muted text-xs sm:text-sm">{transaction.description}</p>
        </div>
        <div className="flex items-center justify-between gap-2 md:block md:text-right">
          <p className={`font-semibold text-sm sm:text-base ${amountClass}`}>
            EUR {transaction.amount}
          </p>
          <div className="mt-2 flex gap-2 md:justify-end">
            <button
              className="min-h-8 rounded-md border border-treasuri-line px-2 font-medium text-xs sm:text-sm"
              onClick={() => setIsEditing((current) => !current)}
              type="button"
            >
              Edit
            </button>
            <button
              className="inline-flex min-h-8 items-center rounded-md border border-treasuri-line px-2"
              onClick={() => setShowRaw((current) => !current)}
              type="button"
            >
              <Database aria-label="Raw data" className="size-4" />
            </button>
          </div>
        </div>
      </div>

      {isEditing ? (
        <form
          className="mt-3 grid gap-2 border-t border-treasuri-line pt-3 md:grid-cols-[180px_minmax(180px,1fr)_repeat(2,auto)]"
          onSubmit={(event) => {
            event.preventDefault();
            onSave({ categoryId, createAlias, flags, merchantName });
          }}
        >
          <select
            aria-label={`Category for ${transaction.description}`}
            className="min-h-8 rounded-md border border-treasuri-line bg-white px-2 text-xs sm:min-h-9 sm:px-3 sm:text-sm"
            onChange={(event) => setCategoryId(Number(event.target.value))}
            value={categoryId}
          >
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
          <input
            aria-label={`Merchant for ${transaction.description}`}
            className="min-h-8 rounded-md border border-treasuri-line px-2 text-xs sm:min-h-9 sm:px-3 sm:text-sm"
            onChange={(event) => setMerchantName(event.target.value)}
            value={merchantName}
          />
          <label className="flex min-h-8 items-center gap-2 text-xs sm:min-h-9 sm:text-sm">
            <input
              checked={createAlias}
              onChange={(event) => setCreateAlias(event.target.checked)}
              type="checkbox"
            />
            Remember merchant
          </label>
          <button
            className="inline-flex min-h-8 items-center justify-center gap-2 rounded-md bg-treasuri-action px-3 font-semibold text-xs text-white disabled:opacity-60 sm:min-h-9 sm:text-sm"
            disabled={disabled || categoryId === 0}
            type="submit"
          >
            <Save aria-hidden="true" className="size-4" />
            Save
          </button>
          <fieldset className="flex flex-wrap gap-x-4 gap-y-2 md:col-span-4">
            <legend className="sr-only">Budget flags</legend>
            <FlagCheckbox
              checked={flags.isTransfer}
              label="Transfer"
              onChange={(isTransfer) => setFlags((current) => ({ ...current, isTransfer }))}
            />
            <FlagCheckbox
              checked={flags.isSavings}
              label="Savings"
              onChange={(isSavings) => setFlags((current) => ({ ...current, isSavings }))}
            />
            <FlagCheckbox
              checked={flags.isOneOff}
              label="One-off"
              onChange={(isOneOff) => setFlags((current) => ({ ...current, isOneOff }))}
            />
            <FlagCheckbox
              checked={flags.isExcludedFromBudget}
              label="Exclude"
              onChange={(isExcludedFromBudget) =>
                setFlags((current) => ({ ...current, isExcludedFromBudget }))
              }
            />
          </fieldset>
        </form>
      ) : null}

      {showRaw ? (
        <div className="mt-3 border-t border-treasuri-line pt-3">
          {rawDetails.data ? (
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(260px,420px)]">
              <dl className="grid gap-2 sm:grid-cols-2">
                {rawDetails.data.details.map((detail) => (
                  <div key={detail.label}>
                    <dt className="text-xs text-treasuri-muted">{detail.label}</dt>
                    <dd className="break-words text-xs sm:text-sm">{detail.value}</dd>
                  </div>
                ))}
              </dl>
              <pre className="max-h-64 overflow-auto rounded-md bg-stone-950 p-3 text-xs text-white">
                {rawDetails.data.payloadJson}
              </pre>
            </div>
          ) : (
            <p className="text-treasuri-muted text-xs sm:text-sm">Loading raw details...</p>
          )}
        </div>
      ) : null}
    </article>
  );
}

function FlagCheckbox({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-h-8 items-center gap-2 text-xs sm:text-sm">
      <input
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      {label}
    </label>
  );
}

function flagsFromLabels(labels: string[]) {
  return {
    isExcludedFromBudget: labels.includes("excluded"),
    isOneOff: labels.includes("one-off"),
    isSavings: labels.includes("savings"),
    isTransfer: labels.includes("transfer"),
  };
}

function readFiltersFromUrl(): TransactionFilters {
  const params = new URLSearchParams(window.location.search);
  return {
    category: params.get("category") ?? undefined,
    kind: params.get("kind") ?? undefined,
    maxAmount: params.get("maxAmount") ?? undefined,
    merchant: params.get("merchant") ?? undefined,
    minAmount: params.get("minAmount") ?? undefined,
    month: params.get("month") ?? undefined,
    needsReview: params.get("needsReview") === "true" ? true : undefined,
    query: params.get("query") ?? undefined,
  };
}

function urlForFilters(filters: TransactionFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "" && value !== false) {
      params.set(key, String(value));
    }
  }
  const query = params.toString();
  return query ? `/transactions?${query}` : "/transactions";
}
