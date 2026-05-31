import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, EyeOff } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { RecurringResponse } from "../../shared/management.ts";
import { confirmRecurring, disableRecurring, fetchRecurring } from "../lib/api.ts";
import { invalidateFinanceWorkspaces } from "../lib/invalidation.ts";

type RecurringSeries = RecurringResponse["series"][number];

export function RecurringWorkspace() {
  const queryClient = useQueryClient();
  const recurring = useQuery({ queryFn: fetchRecurring, queryKey: ["recurring"] });
  const [activeId, setActiveId] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const confirm = useMutation({
    mutationFn: confirmRecurring,
    onSuccess: () => {
      setMessage("Recurring series confirmed.");
      invalidateFinanceWorkspaces(queryClient);
    },
  });
  const disable = useMutation({
    mutationFn: disableRecurring,
    onSuccess: () => {
      setMessage("Recurring series disabled.");
      invalidateFinanceWorkspaces(queryClient);
    },
  });
  const series = recurring.data?.series ?? [];
  const activeSeries = series.find((item) => item.id === activeId) ?? preferredSeries(series);
  const summary = useMemo(() => recurringSummary(series), [series]);

  useEffect(() => {
    if (series.length === 0) {
      setActiveId(null);
      return;
    }
    if (!activeId || !series.some((item) => item.id === activeId)) {
      setActiveId(preferredSeries(series)?.id ?? null);
    }
  }, [activeId, series]);

  if (recurring.isLoading) {
    return <p className="text-treasuri-muted">Loading recurring payments...</p>;
  }
  if (recurring.isError || !recurring.data) {
    return <p className="text-red-700">Recurring payments are unavailable.</p>;
  }

  return (
    <section>
      <header className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-medium text-treasuri-muted text-xs sm:text-sm">
            Subscriptions and fixed commitments
          </p>
          <h1 className="mt-1 font-semibold text-lg sm:text-xl">Recurring</h1>
        </div>
        <dl className="grid grid-cols-3 gap-2 text-center text-xs sm:min-w-72">
          <Fact label="monthly" value={`EUR ${summary.monthlyTotal}`} />
          <Fact label="confirmed" value={String(summary.confirmedCount)} />
          <Fact label="detected" value={String(summary.detectedCount)} />
        </dl>
      </header>

      {message ? (
        <p
          aria-live="polite"
          className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 p-2 text-emerald-800 text-sm"
        >
          {message}
        </p>
      ) : null}

      <div className="grid gap-3 xl:grid-cols-[minmax(17rem,0.65fr)_minmax(0,1fr)]">
        <RecurringList
          activeId={activeSeries?.id ?? null}
          className="order-2 xl:order-1"
          onSelect={setActiveId}
          series={series}
        />
        <RecurringInspector
          className="order-1 xl:order-2"
          disabled={confirm.isPending || disable.isPending}
          onConfirm={(item) => confirm.mutate(item.id)}
          onDisable={(item) => disable.mutate(item.id)}
          series={activeSeries}
        />
      </div>
    </section>
  );
}

function RecurringList({
  activeId,
  className,
  onSelect,
  series,
}: {
  activeId: number | null;
  className: string;
  onSelect: (id: number) => void;
  series: RecurringSeries[];
}) {
  if (series.length === 0) {
    return (
      <aside className={`${className} rounded-md border border-treasuri-line bg-white p-3`}>
        <p className="font-semibold text-sm">No recurring payments detected.</p>
        <p className="mt-1 text-treasuri-muted text-xs">
          Confirmed subscriptions and fixed commitments will appear here after sync.
        </p>
      </aside>
    );
  }

  return (
    <aside
      className={`${className} overflow-hidden rounded-md border border-treasuri-line bg-white`}
    >
      <div className="flex items-center justify-between border-b border-treasuri-line bg-treasuri-panel px-3 py-2">
        <p className="font-semibold text-sm">Series</p>
        <p className="text-treasuri-muted text-xs">{series.length} active</p>
      </div>
      <div className="divide-y divide-treasuri-line">
        {series.map((item) => (
          <button
            aria-current={item.id === activeId ? "true" : undefined}
            className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-2 px-3 py-2 text-left hover:bg-treasuri-panel ${
              item.id === activeId ? "bg-teal-50" : "bg-white"
            }`}
            key={item.id}
            onClick={() => onSelect(item.id)}
            type="button"
          >
            <span className="min-w-0">
              <span className="block truncate font-semibold text-sm">{item.name}</span>
              <span className="block truncate text-treasuri-muted text-xs">
                {item.categoryName ?? "Unknown"} / {item.cadence}
              </span>
              <span className="mt-1 flex flex-wrap gap-1">
                <Badge
                  label={item.isConfirmed ? "confirmed" : "detected"}
                  tone={item.isConfirmed ? "default" : "warn"}
                />
                {item.warnings.slice(0, 1).map((warning) => (
                  <Badge key={warning} label={warning} tone="warn" />
                ))}
              </span>
            </span>
            <span className="font-semibold text-sm">EUR {item.amount ?? "0.00"}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}

function RecurringInspector({
  className,
  disabled,
  onConfirm,
  onDisable,
  series,
}: {
  className: string;
  disabled: boolean;
  onConfirm: (series: RecurringSeries) => void;
  onDisable: (series: RecurringSeries) => void;
  series: RecurringSeries | null;
}) {
  if (!series) {
    return (
      <aside
        className={`${className} rounded-md border border-treasuri-line bg-white p-3 text-treasuri-muted text-sm`}
      >
        Select a recurring payment to inspect it.
      </aside>
    );
  }

  return (
    <article className={`${className} rounded-md border border-treasuri-line bg-white p-3`}>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <div className="flex flex-wrap gap-1">
            <Badge label={series.categoryName ?? "Unknown"} />
            <Badge label={series.cadence} />
            <Badge
              label={series.isConfirmed ? "confirmed" : "detected"}
              tone={series.isConfirmed ? "default" : "warn"}
            />
          </div>
          <h2 className="mt-2 font-semibold text-base">{series.name}</h2>
          <p className="mt-1 text-treasuri-muted text-sm">
            Next expected {series.nextExpectedDate ?? "unknown"}
          </p>
        </div>
        <p className="font-semibold text-base">EUR {series.amount ?? "0.00"}</p>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm lg:grid-cols-3">
        <Fact label="confidence" value={series.confidence ?? "0.00"} />
        <Fact label="last seen" value={series.lastBookingDate ?? "unknown"} />
        <Fact label="evidence" value={`${series.linkedTransactions.length} tx`} />
        <Fact
          label="day"
          value={series.expectedDayOfMonth ? String(series.expectedDayOfMonth) : "unknown"}
        />
        <Fact label="min" value={`EUR ${series.minAmount ?? "0.00"}`} />
        <Fact label="max" value={`EUR ${series.maxAmount ?? "0.00"}`} />
        <Fact label="tolerance" value={`EUR ${series.amountTolerance ?? "0.00"}`} />
      </dl>

      {series.warnings.length > 0 ? (
        <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-2">
          <p className="font-semibold text-amber-900 text-xs">Needs attention</p>
          <ul className="mt-1 space-y-1 text-amber-900 text-xs">
            {series.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <section className="mt-4 border-t border-treasuri-line pt-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-semibold text-sm">Linked transactions</h3>
          <span className="text-treasuri-muted text-xs">{series.linkedTransactions.length}</span>
        </div>
        {series.linkedTransactions.length > 0 ? (
          <div className="mt-2 overflow-hidden rounded-md border border-treasuri-line">
            <div className="hidden grid-cols-[5.5rem_minmax(0,1fr)_7rem_7rem] gap-2 bg-treasuri-panel px-2 py-1.5 font-semibold text-treasuri-muted text-xs lg:grid">
              <span>Date</span>
              <span>Merchant</span>
              <span>Category</span>
              <span className="text-right">Amount</span>
            </div>
            <div className="divide-y divide-treasuri-line">
              {series.linkedTransactions.map((transaction) => (
                <div
                  className="grid gap-1 px-2 py-2 text-xs lg:grid-cols-[5.5rem_minmax(0,1fr)_7rem_7rem] lg:gap-2"
                  key={transaction.id}
                >
                  <time
                    className="font-medium text-treasuri-muted"
                    dateTime={transaction.bookingDate}
                  >
                    {transaction.bookingDate}
                  </time>
                  <p className="min-w-0">
                    <span className="block truncate font-semibold text-sm">
                      {transaction.merchant}
                    </span>
                    <span className="block truncate text-treasuri-muted">
                      {transaction.description}
                    </span>
                  </p>
                  <span className="truncate text-treasuri-muted">
                    {transaction.categoryName ?? "Unknown"}
                  </span>
                  <span
                    className={`font-semibold lg:text-right ${amountClass(transaction.amount)}`}
                  >
                    EUR {transaction.amount}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="mt-2 rounded-md border border-treasuri-line bg-treasuri-panel p-2 text-treasuri-muted text-xs">
            No linked transaction evidence yet. Run sync and recurring detection to attach history.
          </p>
        )}
      </section>

      <div className="mt-4 grid grid-cols-2 gap-2 border-t border-treasuri-line pt-3 sm:flex sm:flex-wrap">
        {!series.isConfirmed ? (
          <button
            className="inline-flex min-h-8 items-center justify-center gap-2 rounded-md bg-treasuri-action px-3 font-semibold text-xs text-white disabled:opacity-60 sm:text-sm"
            disabled={disabled}
            onClick={() => onConfirm(series)}
            type="button"
          >
            <Check aria-hidden="true" className="size-4" />
            Confirm
          </button>
        ) : null}
        <button
          className="inline-flex min-h-8 items-center justify-center gap-2 rounded-md border border-treasuri-line px-2 font-medium text-xs disabled:opacity-60 sm:text-sm"
          disabled={disabled}
          onClick={() => onDisable(series)}
          type="button"
        >
          <EyeOff aria-hidden="true" className="size-4" />
          Disable
        </button>
      </div>
    </article>
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

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <dt className="font-medium text-treasuri-muted text-xs">{label}</dt>
      <dd className="mt-0.5 font-semibold text-sm">{value}</dd>
    </span>
  );
}

function recurringSummary(series: RecurringSeries[]) {
  const monthlyTotal = series
    .filter((item) => item.cadence === "monthly")
    .reduce((total, item) => total + Number(item.amount ?? 0), 0)
    .toFixed(2);
  return {
    confirmedCount: series.filter((item) => item.isConfirmed).length,
    detectedCount: series.filter((item) => !item.isConfirmed).length,
    monthlyTotal,
  };
}

function preferredSeries(series: RecurringSeries[]): RecurringSeries | null {
  return series.find((item) => item.warnings.length > 0 || !item.isConfirmed) ?? series[0] ?? null;
}

function amountClass(amount: string): string {
  return Number(amount) < 0 ? "text-red-700" : "text-emerald-700";
}
