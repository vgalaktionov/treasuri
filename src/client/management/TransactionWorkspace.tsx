import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Database, FilePlus2, Filter, RotateCcw, Save, Search } from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";

import type {
  TransactionFilters,
  TransactionsResponse,
  TransactionUpdateRequest,
} from "../../shared/management.ts";
import {
  createRule,
  draftRuleFromTransaction,
  fetchTransactionRawDetails,
  fetchTransactions,
  updateTransaction,
} from "../lib/api.ts";

type TransactionItem = TransactionsResponse["transactions"][number];

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
  const [activeId, setActiveId] = useState<number | null>(null);
  const transactions = useQuery({
    queryFn: () => fetchTransactions(filters),
    queryKey: ["transactions", filters],
  });
  const update = useMutation({
    mutationFn: ({ id, input }: { id: number; input: TransactionUpdateRequest }) =>
      updateTransaction(id, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["transactions"] }),
  });
  const items = transactions.data?.transactions ?? [];
  const activeTransaction =
    items.find((transaction) => transaction.id === activeId) ?? items[0] ?? null;

  useEffect(() => {
    if (items.length === 0) {
      setActiveId(null);
      return;
    }
    if (!activeId || !items.some((transaction) => transaction.id === activeId)) {
      setActiveId(items[0]?.id ?? null);
    }
  }, [activeId, items]);

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
      <header className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-medium text-treasuri-muted text-xs sm:text-sm">History</p>
          <h1 className="mt-1 font-semibold text-lg sm:text-xl">Transactions</h1>
        </div>
        {transactions.data ? (
          <p className="font-semibold text-treasuri-muted text-sm">
            {items.length} shown / {transactions.data.summary.totalCount} matched
          </p>
        ) : null}
      </header>

      <TransactionFiltersBar
        data={transactions.data}
        filters={filters}
        onChange={setFilters}
        onClear={clearFilters}
        onSubmit={submit}
      />
      {transactions.data ? <TransactionSummary summary={transactions.data.summary} /> : null}

      <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.72fr)]">
        <TransactionLedger
          activeId={activeTransaction?.id ?? null}
          className="order-2 xl:order-1"
          isLoading={transactions.isLoading}
          onSelect={setActiveId}
          transactions={items}
        />
        <TransactionInspector
          categories={transactions.data?.categories ?? []}
          className="order-1 xl:order-2"
          disabled={update.isPending}
          key={activeTransaction?.id ?? "empty"}
          onSave={(transaction, input) => update.mutate({ id: transaction.id, input })}
          transaction={activeTransaction}
        />
      </div>
    </section>
  );
}

function TransactionSummary({ summary }: { summary: TransactionsResponse["summary"] }) {
  const period =
    summary.firstDate && summary.lastDate
      ? `${summary.firstDate} to ${summary.lastDate}`
      : "No transaction dates";

  return (
    <div className="mt-2 grid grid-cols-2 gap-2 xl:grid-cols-4">
      <SummaryCard detail={period} label="Filtered net" value={`EUR ${summary.netTotal}`} />
      <SummaryCard label="Outflow" value={`EUR ${summary.outflowTotal}`} />
      <SummaryCard label="Income" tone="positive" value={`EUR ${summary.incomeTotal}`} />
      <SummaryCard
        detail={`EUR ${summary.excludedTotal} excluded`}
        label="Needs review"
        tone={summary.reviewCount > 0 ? "warn" : "default"}
        value={String(summary.reviewCount)}
      />
    </div>
  );
}

function SummaryCard({
  detail,
  label,
  tone = "default",
  value,
}: {
  detail?: string;
  label: string;
  tone?: "default" | "positive" | "warn";
  value: string;
}) {
  const valueClass =
    tone === "positive" ? "text-emerald-700" : tone === "warn" ? "text-amber-700" : "";

  return (
    <article className="rounded-md border border-treasuri-line bg-white p-2">
      <p className="font-medium text-treasuri-muted text-xs">{label}</p>
      <p className={`mt-1 font-semibold text-sm ${valueClass}`}>{value}</p>
      {detail ? <p className="mt-1 truncate text-treasuri-muted text-xs">{detail}</p> : null}
    </article>
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
    <form className="rounded-md border border-treasuri-line bg-white p-2" onSubmit={onSubmit}>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-[minmax(180px,1.5fr)_repeat(4,minmax(120px,1fr))_auto]">
        <label className="relative col-span-2 block md:col-span-1">
          <Search
            aria-hidden="true"
            className="-translate-y-1/2 absolute top-1/2 left-3 size-4 text-treasuri-muted"
          />
          <input
            aria-label="Search transactions"
            className="min-h-8 w-full rounded-md border border-treasuri-line bg-white pr-3 pl-9 text-xs sm:text-sm"
            onChange={(event) => update({ query: event.target.value || undefined })}
            placeholder="Merchant or description"
            value={filters.query ?? ""}
          />
        </label>
        <input
          aria-label="Month"
          className="min-h-8 min-w-0 rounded-md border border-treasuri-line bg-white px-2 text-xs sm:text-sm"
          onChange={(event) => update({ month: event.target.value || undefined })}
          type="month"
          value={filters.month ?? ""}
        />
        <select
          aria-label="Category filter"
          className="min-h-8 min-w-0 rounded-md border border-treasuri-line bg-white px-2 text-xs sm:text-sm"
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
          className="min-h-8 min-w-0 rounded-md border border-treasuri-line bg-white px-2 text-xs sm:text-sm"
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
          className="min-h-8 min-w-0 rounded-md border border-treasuri-line bg-white px-2 text-xs sm:text-sm"
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
            className="inline-flex min-h-8 items-center gap-2 rounded-md bg-treasuri-action px-3 font-semibold text-xs text-white sm:text-sm"
            type="submit"
          >
            <Filter aria-hidden="true" className="size-4" />
            Filter
          </button>
          {hasFilters ? (
            <button
              className="inline-flex min-h-8 items-center rounded-md border border-treasuri-line px-3"
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
            className="min-h-8 rounded-md border border-treasuri-line bg-white px-2 text-xs sm:text-sm"
            min="0"
            onChange={(event) => update({ minAmount: event.target.value || undefined })}
            placeholder="Min amount"
            step="0.01"
            type="number"
            value={filters.minAmount ?? ""}
          />
          <input
            aria-label="Amount at most"
            className="min-h-8 rounded-md border border-treasuri-line bg-white px-2 text-xs sm:text-sm"
            min="0"
            onChange={(event) => update({ maxAmount: event.target.value || undefined })}
            placeholder="Max amount"
            step="0.01"
            type="number"
            value={filters.maxAmount ?? ""}
          />
          <label className="flex min-h-8 items-center gap-2 rounded-md border border-treasuri-line px-2 text-xs sm:text-sm">
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

function TransactionLedger({
  activeId,
  className,
  isLoading,
  onSelect,
  transactions,
}: {
  activeId: number | null;
  className: string;
  isLoading: boolean;
  onSelect: (id: number) => void;
  transactions: TransactionItem[];
}) {
  if (isLoading) {
    return (
      <div
        className={`${className} rounded-md border border-treasuri-line bg-white p-3 text-treasuri-muted text-sm`}
      >
        Loading transactions...
      </div>
    );
  }

  if (transactions.length === 0) {
    return (
      <div className={`${className} rounded-md border border-treasuri-line bg-white p-3 text-sm`}>
        No transactions match these filters.
      </div>
    );
  }

  return (
    <div className={`${className} overflow-hidden rounded-md border border-treasuri-line bg-white`}>
      <div className="hidden grid-cols-[5.5rem_minmax(0,1fr)_7.5rem_6.5rem_7rem] gap-2 border-b border-treasuri-line bg-treasuri-panel px-3 py-2 font-semibold text-treasuri-muted text-xs lg:grid">
        <span>Date</span>
        <span>Merchant</span>
        <span>Category</span>
        <span>Method</span>
        <span className="text-right">Amount</span>
      </div>
      <div className="divide-y divide-treasuri-line">
        {transactions.map((transaction) => (
          <button
            aria-current={transaction.id === activeId ? "true" : undefined}
            className={`grid w-full gap-2 px-3 py-2 text-left text-sm hover:bg-treasuri-panel lg:grid-cols-[5.5rem_minmax(0,1fr)_7.5rem_6.5rem_7rem] lg:items-center ${
              transaction.id === activeId ? "bg-teal-50" : "bg-white"
            }`}
            key={transaction.id}
            onClick={() => onSelect(transaction.id)}
            type="button"
          >
            <span className="font-medium text-treasuri-muted text-xs">
              {transaction.bookingDate}
            </span>
            <span className="min-w-0">
              <span className="block truncate font-semibold">{transaction.merchant}</span>
              <span className="block truncate text-treasuri-muted text-xs">
                {transaction.description}
              </span>
              <span className="mt-1 flex flex-wrap gap-1 lg:hidden">
                <Badge label={transaction.categoryName ?? "Uncategorized"} />
                {transaction.needsReview ? <Badge label="review" tone="warn" /> : null}
              </span>
            </span>
            <span className="hidden truncate text-xs lg:block">
              {transaction.categoryName ?? "Uncategorized"}
            </span>
            <span className="hidden truncate text-treasuri-muted text-xs lg:block">
              {transaction.classificationMethod ?? "none"}
            </span>
            <span className={`font-semibold text-sm lg:text-right ${amountClass(transaction)}`}>
              EUR {transaction.amount}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function TransactionInspector({
  categories,
  className,
  disabled,
  onSave,
  transaction,
}: {
  categories: TransactionsResponse["categories"];
  className: string;
  disabled: boolean;
  onSave: (transaction: TransactionItem, input: TransactionUpdateRequest) => void;
  transaction: TransactionItem | null;
}) {
  const queryClient = useQueryClient();
  const [showRaw, setShowRaw] = useState(false);
  const [categoryId, setCategoryId] = useState(0);
  const [merchantName, setMerchantName] = useState("");
  const [createAlias, setCreateAlias] = useState(false);
  const [flags, setFlags] = useState(flagsFromLabels([]));
  const rawDetails = useQuery({
    enabled: showRaw && transaction !== null,
    queryFn: () => fetchTransactionRawDetails(transaction?.id ?? 0),
    queryKey: ["transaction-raw", transaction?.id],
  });
  const ruleDraft = useMutation({
    mutationFn: () => draftRuleFromTransaction(transaction?.id ?? 0),
  });
  const createDraftRule = useMutation({
    mutationFn: () => {
      if (!ruleDraft.data) {
        throw new Error("No drafted rule to create");
      }
      return createRule(ruleDraft.data.rule);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rules"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
    },
  });

  useEffect(() => {
    setShowRaw(false);
    setCategoryId(transaction?.categoryId ?? categories[0]?.id ?? 0);
    setMerchantName(transaction?.merchant ?? "");
    setCreateAlias(false);
    setFlags(flagsFromLabels(transaction?.flags ?? []));
  }, [categories, transaction]);

  if (!transaction) {
    return (
      <aside
        className={`${className} rounded-md border border-treasuri-line bg-white p-3 text-treasuri-muted text-sm`}
      >
        Select a transaction to inspect or edit it.
      </aside>
    );
  }

  return (
    <aside className={`${className} rounded-md border border-treasuri-line bg-white p-3`}>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <div className="flex flex-wrap gap-1">
            <Badge label={transaction.bookingDate} />
            <Badge label={transaction.categoryName ?? "Uncategorized"} />
            {transaction.needsReview ? <Badge label="review" tone="warn" /> : null}
            {transaction.flags.map((flag) => (
              <Badge key={flag} label={flag} />
            ))}
          </div>
          <h2 className="mt-2 font-semibold text-base">{transaction.merchant}</h2>
          <p className="mt-1 text-treasuri-muted text-sm">{transaction.description}</p>
        </div>
        <p className={`font-semibold text-base ${amountClass(transaction)}`}>
          EUR {transaction.amount}
        </p>
      </div>

      <form
        className="mt-4 grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(transaction, { categoryId, createAlias, flags, merchantName });
        }}
      >
        <label className="grid gap-1 text-xs">
          <span className="font-medium text-treasuri-muted">Category</span>
          <select
            aria-label={`Category for ${transaction.description}`}
            className="min-h-9 rounded-md border border-treasuri-line bg-white px-2 text-sm"
            onChange={(event) => setCategoryId(Number(event.target.value))}
            value={categoryId}
          >
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs">
          <span className="font-medium text-treasuri-muted">Merchant</span>
          <input
            aria-label={`Merchant for ${transaction.description}`}
            className="min-h-9 rounded-md border border-treasuri-line px-2 text-sm"
            onChange={(event) => setMerchantName(event.target.value)}
            value={merchantName}
          />
        </label>
        <label className="flex min-h-8 items-center gap-2 text-xs">
          <input
            checked={createAlias}
            onChange={(event) => setCreateAlias(event.target.checked)}
            type="checkbox"
          />
          Remember merchant
        </label>
        <fieldset className="grid grid-cols-2 gap-2">
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
        <div className="grid grid-cols-2 gap-2 border-t border-treasuri-line pt-3">
          <button
            className="inline-flex min-h-8 items-center justify-center gap-2 rounded-md bg-treasuri-action px-3 font-semibold text-xs text-white disabled:opacity-60 sm:text-sm"
            disabled={disabled || categoryId === 0}
            type="submit"
          >
            <Save aria-hidden="true" className="size-4" />
            Save
          </button>
          <button
            className="inline-flex min-h-8 items-center justify-center gap-2 rounded-md border border-treasuri-line px-2 font-medium text-xs sm:text-sm"
            onClick={() => setShowRaw((current) => !current)}
            type="button"
          >
            <Database aria-hidden="true" className="size-4" />
            Raw data
          </button>
          <button
            className="col-span-2 inline-flex min-h-8 items-center justify-center gap-2 rounded-md border border-treasuri-line px-2 font-medium text-xs disabled:opacity-60 sm:text-sm"
            disabled={ruleDraft.isPending}
            onClick={() => ruleDraft.mutate()}
            type="button"
          >
            <FilePlus2 aria-hidden="true" className="size-4" />
            Preview rule
          </button>
        </div>
      </form>

      {ruleDraft.data ? (
        <div className="mt-3 rounded-md border border-treasuri-line bg-treasuri-panel p-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="font-semibold text-sm">{ruleDraft.data.rule.name}</p>
              <p className="mt-1 text-treasuri-muted text-xs">
                {ruleDraft.data.rule.field} {ruleDraft.data.rule.operator} "
                {ruleDraft.data.rule.pattern}"
              </p>
            </div>
            <button
              className="inline-flex min-h-8 items-center justify-center gap-2 rounded-md bg-treasuri-action px-3 font-semibold text-xs text-white disabled:opacity-60 sm:text-sm"
              disabled={createDraftRule.isPending}
              onClick={() => createDraftRule.mutate()}
              type="button"
            >
              <FilePlus2 aria-hidden="true" className="size-4" />
              Create rule
            </button>
          </div>
          <dl className="mt-2 grid grid-cols-4 gap-2 text-xs">
            <RulePreviewFact label="matches" value={ruleDraft.data.preview.matchCount} />
            <RulePreviewFact label="changes" value={ruleDraft.data.preview.wouldChangeCount} />
            <RulePreviewFact label="correct" value={ruleDraft.data.preview.alreadyCorrectCount} />
            <RulePreviewFact label="manual" value={ruleDraft.data.preview.skippedManualCount} />
          </dl>
          {createDraftRule.data ? (
            <p className="mt-2 text-emerald-700 text-xs">
              Rule {createDraftRule.data.ruleId} created.
            </p>
          ) : null}
        </div>
      ) : null}
      {ruleDraft.isError ? (
        <p className="mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-red-700 text-xs">
          Rule preview failed.
        </p>
      ) : null}

      {showRaw ? (
        <div className="mt-3 border-t border-treasuri-line pt-3">
          {rawDetails.data ? (
            <div className="grid gap-3">
              <dl className="grid gap-2 sm:grid-cols-2">
                {rawDetails.data.details.map((detail) => (
                  <div key={detail.label}>
                    <dt className="text-treasuri-muted text-xs">{detail.label}</dt>
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
    </aside>
  );
}

function RulePreviewFact({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-treasuri-muted">{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}

function Badge({ label, tone = "default" }: { label: string; tone?: "default" | "warn" }) {
  return (
    <span
      className={`rounded border px-1.5 py-0.5 font-medium text-[0.68rem] ${
        tone === "warn"
          ? "border-amber-200 bg-amber-50 text-amber-800"
          : "border-treasuri-line text-treasuri-muted"
      }`}
    >
      {label}
    </span>
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

function amountClass(transaction: TransactionItem): string {
  return transaction.amount.startsWith("-") ? "text-stone-950" : "text-emerald-700";
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
