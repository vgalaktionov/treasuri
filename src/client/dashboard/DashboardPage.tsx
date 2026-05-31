import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarDays,
  ChevronRight,
  Gauge,
  PiggyBank,
  ReceiptText,
  Wallet,
} from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

import type { DashboardResponse } from "../../shared/dashboard.ts";
import { fetchDashboard } from "../lib/api.ts";

type DashboardMode = "explain" | "month" | "now";
type GuardrailMode = "base" | "review";

export function DashboardPage() {
  const dashboard = useQuery({ queryFn: fetchDashboard, queryKey: ["dashboard"] });
  const [mode, setMode] = useState<DashboardMode>("now");
  const [guardrailMode, setGuardrailMode] = useState<GuardrailMode>("base");

  if (dashboard.isLoading) {
    return <p className="text-treasuri-muted">Loading dashboard...</p>;
  }
  if (dashboard.isError || !dashboard.data) {
    return <p className="text-red-700">Dashboard is unavailable.</p>;
  }

  const data = dashboard.data;
  const activeGuardrail = guardrailFor(data, guardrailMode);
  const safeToSpendClass =
    Number(activeGuardrail.safeToSpend) < 0 ? "text-red-700" : "text-treasuri-ink";
  const safeTodayClass =
    Number(activeGuardrail.safeToday) < 0 ? "text-red-700" : "text-treasuri-ink";
  const reviewClass = data.reviewCount > 0 ? "text-amber-700" : "text-emerald-700";

  return (
    <section aria-labelledby="dashboard-heading">
      <header className="mb-3 grid gap-3 rounded-md border border-treasuri-line bg-white p-3 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-stretch">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-treasuri-muted text-xs">{monthLabel(data.yearMonth)}</p>
            <span className="rounded border border-treasuri-line px-1.5 py-0.5 font-semibold text-treasuri-muted text-[0.68rem]">
              {data.monthProgress.label}
            </span>
            <span className={`font-semibold text-xs ${reviewClass}`}>{data.confidenceNote}</span>
          </div>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1
              className={`font-semibold text-xl leading-tight ${safeToSpendClass}`}
              id="dashboard-heading"
            >
              EUR {activeGuardrail.safeToSpend}
            </h1>
            <p className="font-medium text-treasuri-muted text-sm">safe to spend this month</p>
          </div>
          <p className="mt-1 max-w-3xl text-treasuri-muted text-xs">{activeGuardrail.summary}</p>
          <MonthProgressBar progress={data.monthProgress} />
        </div>

        <TodayLimit
          className="border-t border-treasuri-line pt-3 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-3"
          guardrail={activeGuardrail}
          data={data}
          valueClassName={safeTodayClass}
        />
      </header>

      <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <SegmentedControl
          label="Dashboard view"
          onChange={setMode}
          options={dashboardModes}
          value={mode}
        />
        <SegmentedControl
          label="Guardrail basis"
          onChange={setGuardrailMode}
          options={guardrailModes}
          value={guardrailMode}
        />
      </div>

      <section className="grid items-start gap-2 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="grid gap-3">
          <div className="grid grid-cols-2 items-start gap-2 xl:grid-cols-5">
            <MetricCard
              icon={<Wallet className="size-4" />}
              label="Safe today"
              value={`EUR ${activeGuardrail.safeToday}`}
              valueClassName={safeTodayClass}
            />
            <MetricCard
              icon={<Gauge className="size-4" />}
              label="Projected savings"
              value={`EUR ${data.projectedSavings}`}
            />
            <MetricCard
              icon={<PiggyBank className="size-4" />}
              label="Target savings"
              value={`EUR ${explanationValue(data, "target_savings_remaining")}`}
            />
            <MetricCard
              icon={<CalendarDays className="size-4" />}
              label="Fixed upcoming"
              value={`EUR ${data.fixedCostsUpcoming}`}
            />
            <MetricCard
              icon={<AlertTriangle className="size-4" />}
              label="Review impact"
              value={`EUR ${data.reviewImpact}`}
              valueClassName={reviewClass}
            />
          </div>

          <NextActions className="lg:hidden" data={data} />

          {mode === "now" ? (
            <NowWorkspace data={data} guardrail={activeGuardrail} reviewClass={reviewClass} />
          ) : null}
          {mode === "month" ? <MonthWorkspace data={data} /> : null}
          {mode === "explain" ? <ExplainWorkspace data={data} /> : null}
        </div>

        <NextActions className="hidden lg:block" data={data} />
      </section>
    </section>
  );
}

const dashboardModes: readonly [DashboardMode, string][] = [
  ["now", "Now"],
  ["month", "Month"],
  ["explain", "Explain"],
];

const guardrailModes: readonly [GuardrailMode, string][] = [
  ["base", "Synced forecast"],
  ["review", "After review"],
];

function SegmentedControl<TValue extends string>({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: TValue) => void;
  options: readonly [TValue, string][];
  value: TValue;
}) {
  return (
    <div
      aria-label={label}
      className="inline-grid w-full rounded-md border border-treasuri-line bg-white p-1 text-xs sm:w-auto"
      role="tablist"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map(([optionValue, optionLabel]) => (
        <button
          aria-selected={value === optionValue}
          className={`min-h-8 rounded px-3 font-semibold ${
            value === optionValue
              ? "bg-treasuri-action text-white"
              : "text-treasuri-muted hover:bg-treasuri-panel"
          }`}
          key={optionValue}
          onClick={() => onChange(optionValue)}
          role="tab"
          type="button"
        >
          {optionLabel}
        </button>
      ))}
    </div>
  );
}

function TodayLimit({
  className,
  data,
  guardrail,
  valueClassName,
}: {
  className: string;
  data: DashboardResponse;
  guardrail: ActiveGuardrail;
  valueClassName: string;
}) {
  return (
    <aside className={className}>
      <p className="font-medium text-treasuri-muted text-xs">Today</p>
      <p className={`mt-1 font-semibold text-lg leading-tight ${valueClassName}`}>
        EUR {guardrail.safeToday}
      </p>
      <p className="mt-1 text-treasuri-muted text-xs">safe to spend today</p>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <InlineMetric label="Safe/day" value={`EUR ${guardrail.safeToday}`} />
        <InlineMetric label="Days left" value={String(data.monthProgress.remainingDays)} />
      </dl>
      <p className="mt-2 text-treasuri-muted text-[0.68rem]">{guardrail.label}</p>
    </aside>
  );
}

function MonthProgressBar({ progress }: { progress: DashboardResponse["monthProgress"] }) {
  const width = `${Math.min(100, Math.max(0, Math.round((progress.elapsedDays / progress.totalDays) * 100)))}%`;

  return (
    <div className="mt-3 max-w-3xl">
      <div className="h-1.5 overflow-hidden rounded bg-treasuri-panel">
        <div className="h-full rounded bg-treasuri-action" style={{ width }} />
      </div>
      <div className="mt-1 flex items-center justify-between gap-3 text-treasuri-muted text-[0.68rem]">
        <span>{progress.elapsedDays} elapsed</span>
        <span>{progress.remainingDays} left including today</span>
      </div>
    </div>
  );
}

function NowWorkspace({
  data,
  guardrail,
  reviewClass,
}: {
  data: DashboardResponse;
  guardrail: ActiveGuardrail;
  reviewClass: string;
}) {
  return (
    <div className="grid gap-2 xl:grid-cols-[minmax(0,1.1fr)_minmax(20rem,0.9fr)]">
      <article className="rounded-md border border-treasuri-line bg-white p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-semibold text-sm">Current answer</p>
            <p className="mt-1 text-treasuri-muted text-xs">
              Derived from the latest balance snapshot and current-month forecast.
            </p>
          </div>
          <p className={`font-semibold text-sm ${reviewClass}`}>{data.confidenceNote}</p>
        </div>

        <dl className="mt-3 grid gap-2 sm:grid-cols-2">
          <InlineMetric label="Today limit" value={`EUR ${guardrail.safeToday}`} />
          <InlineMetric label="Safe per day" value={`EUR ${guardrail.safeToday}/day`} />
          <InlineMetric
            label="Synced balance"
            value={data.currentBalance ? `EUR ${data.currentBalance.amount}` : "Missing"}
          />
          <InlineMetric label="Income received" value={`EUR ${data.incomeReceived}`} />
          <InlineMetric label="Projected savings" value={`EUR ${data.projectedSavings}`} />
          <InlineMetric label={guardrail.metricLabel} value={`EUR ${guardrail.safeToSpend}`} />
        </dl>

        {data.currentBalance ? (
          <p className="mt-3 border-t border-treasuri-line pt-2 text-treasuri-muted text-xs">
            Balance source: {data.currentBalance.source}, as of {data.currentBalance.asOf}.
          </p>
        ) : null}
      </article>

      <article className="rounded-md border border-treasuri-line bg-white p-3">
        <p className="font-semibold text-sm">Forecast blockers</p>
        <dl className="mt-2 grid gap-2">
          <InlineMetric
            label="Transactions needing review"
            value={`${data.reviewCount} / EUR ${data.reviewImpact}`}
          />
          {data.monthFacts.map((fact) => (
            <InlineMetric
              detail={fact.detail}
              key={fact.label}
              label={fact.label}
              value={fact.value}
            />
          ))}
        </dl>
        <TransactionMiniList
          emptyText="No open review blockers in this forecast."
          items={data.reviewBlockers}
          linkPrefix="/review"
          title="Review blockers"
        />
      </article>
    </div>
  );
}

type ActiveGuardrail = {
  label: string;
  metricLabel: string;
  safeToday: string;
  safeToSpend: string;
  summary: string;
};

function guardrailFor(data: DashboardResponse, mode: GuardrailMode): ActiveGuardrail {
  if (mode === "review") {
    const safeToSpend = formatClientMoney(
      moneyNumber(data.safeToSpend) - moneyNumber(data.reviewImpact),
    );
    const safeToday = formatClientMoney(
      moneyNumber(safeToSpend) / Math.max(1, data.monthProgress.remainingDays),
    );
    return {
      label: "Review impact reserved",
      metricLabel: "After review impact",
      safeToday,
      safeToSpend,
      summary: `${data.paceSummary} Reserving EUR ${data.reviewImpact} for ${data.reviewCount} review ${data.reviewCount === 1 ? "item" : "items"}.`,
    };
  }

  return {
    label: "Synced forecast",
    metricLabel: "Month allowance",
    safeToday: data.safeToday,
    safeToSpend: data.safeToSpend,
    summary: data.paceSummary,
  };
}

function moneyNumber(value: string): number {
  const parsed = Number(value.replace(",", ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatClientMoney(value: number): string {
  return value.toFixed(2);
}

function MonthWorkspace({ data }: { data: DashboardResponse }) {
  return (
    <div className="grid gap-2 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <CategoryPace rows={data.categoryPace} />
      <div className="grid gap-2">
        <RecentTransactionsPanel data={data} />
        <Panel title="Top category spend" rows={data.topVariances} />
        <Panel title="Upcoming fixed costs" rows={data.upcomingFixedCosts} />
      </div>
    </div>
  );
}

function RecentTransactionsPanel({ data }: { data: DashboardResponse }) {
  return (
    <article className="rounded-md border border-treasuri-line bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-sm">Month movement</h2>
          <p className="mt-1 text-treasuri-muted text-xs">
            Latest transactions in {data.yearMonth}.
          </p>
        </div>
        <a
          className="inline-flex min-h-7 items-center gap-1 rounded-md border border-treasuri-line px-2 font-semibold text-treasuri-muted text-xs hover:bg-treasuri-panel"
          href={`/transactions?month=${data.yearMonth}`}
        >
          <ReceiptText aria-hidden="true" className="size-3.5" />
          Open
        </a>
      </div>
      <TransactionMiniList
        emptyText="No transactions imported for this month yet."
        items={data.recentTransactions}
        linkPrefix={`/transactions?month=${data.yearMonth}`}
      />
    </article>
  );
}

function TransactionMiniList({
  emptyText,
  items,
  linkPrefix,
  title,
}: {
  emptyText: string;
  items: DashboardResponse["recentTransactions"];
  linkPrefix: string;
  title?: string;
}) {
  return (
    <div className={title ? "mt-3 border-t border-treasuri-line pt-3" : "mt-2"}>
      {title ? <p className="font-semibold text-sm">{title}</p> : null}
      {items.length === 0 ? (
        <p className="mt-2 rounded-md border border-treasuri-line bg-treasuri-panel p-2 text-treasuri-muted text-xs">
          {emptyText}
        </p>
      ) : (
        <div className="mt-2 divide-y divide-treasuri-line">
          {items.map((transaction) => (
            <a
              className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 py-2 first:pt-0 last:pb-0 hover:text-treasuri-action"
              href={
                transaction.needsReview && linkPrefix !== "/review"
                  ? reviewFilterHref(linkPrefix)
                  : transactionHref(linkPrefix, transaction)
              }
              key={transaction.id}
            >
              <span className="min-w-0">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-medium text-sm">{transaction.merchant}</span>
                  {transaction.needsReview ? <Badge label="review" /> : null}
                </span>
                <span className="mt-0.5 block truncate text-treasuri-muted text-xs">
                  {transaction.bookingDate} - {transaction.categoryName ?? "Uncategorized"}
                  {transaction.flags.length > 0 ? ` - ${transaction.flags.join(", ")}` : ""}
                </span>
              </span>
              <span className={`font-semibold text-sm ${amountClass(transaction.amount)}`}>
                EUR {transaction.amount}
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function Badge({ label }: { label: string }) {
  return (
    <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 font-semibold text-[0.62rem] text-amber-800">
      {label}
    </span>
  );
}

function transactionHref(
  linkPrefix: string,
  transaction: DashboardResponse["recentTransactions"][number],
): string {
  const separator = linkPrefix.includes("?") ? "&" : "?";
  return `${linkPrefix}${separator}transactionId=${transaction.id}`;
}

function reviewFilterHref(linkPrefix: string): string {
  return linkPrefix.includes("?") ? `${linkPrefix}&needsReview=true` : linkPrefix;
}

function amountClass(amount: string): string {
  return amount.startsWith("-") ? "text-treasuri-ink" : "text-emerald-700";
}

function ExplainWorkspace({ data }: { data: DashboardResponse }) {
  return (
    <div className="grid gap-3">
      <article className="rounded-md border border-treasuri-line bg-white p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-semibold text-sm">Forecast equation</p>
            <p className="mt-1 text-treasuri-muted text-xs">
              The safe-to-spend number is arithmetic, not a hidden score.
            </p>
          </div>
          <span className="rounded border border-treasuri-line px-2 py-1 font-semibold text-treasuri-muted text-xs">
            {titleCase(data.confidence)} confidence
          </span>
        </div>

        <div className="mt-3 grid gap-2 lg:grid-cols-[minmax(0,1fr)_12rem]">
          <div className="grid gap-1 text-sm">
            {forecastEquationRows(data).map((row) => (
              <div
                className="grid grid-cols-[1.5rem_minmax(0,1fr)_8rem] items-center gap-2 rounded border border-treasuri-line bg-treasuri-panel px-2 py-1.5"
                key={row.label}
              >
                <span className="font-semibold text-treasuri-muted text-xs">{row.operator}</span>
                <span className="min-w-0 truncate font-medium">{row.label}</span>
                <span className="text-right font-semibold">EUR {row.value}</span>
              </div>
            ))}
          </div>
          <div className="rounded-md border border-treasuri-line p-3">
            <p className="font-medium text-treasuri-muted text-xs">Equals</p>
            <p className="mt-1 font-semibold text-lg">EUR {data.safeToSpend}</p>
            <p className="mt-1 text-treasuri-muted text-xs">
              EUR {data.safePerDay}/day over {data.monthProgress.remainingDays} remaining days.
            </p>
          </div>
        </div>
      </article>

      <article className="rounded-md border border-treasuri-line bg-white p-3">
        <p className="font-semibold text-sm">Forecast inputs</p>
        <dl className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {Object.entries(data.explanation).map(([label, value]) => (
            <ExplanationMetric key={label} label={label.replaceAll("_", " ")} value={value} />
          ))}
        </dl>
      </article>
    </div>
  );
}

function forecastEquationRows(data: DashboardResponse) {
  return [
    {
      label: "Synced current balance",
      operator: "+",
      value: explanationValue(data, "synced_current_liquid_balance"),
    },
    {
      label: "Expected income remaining",
      operator: "+",
      value: explanationValue(data, "expected_income_remaining"),
    },
    {
      label: "Upcoming fixed costs",
      operator: "-",
      value: explanationValue(data, "fixed_costs_upcoming"),
    },
    {
      label: "Predicted variable remaining",
      operator: "-",
      value: explanationValue(data, "predicted_variable_remaining"),
    },
    {
      label: "Target savings",
      operator: "-",
      value: explanationValue(data, "target_savings_remaining"),
    },
    {
      label: "Safety buffer",
      operator: "-",
      value: explanationValue(data, "safety_buffer"),
    },
  ];
}

function explanationValue(data: DashboardResponse, key: string): string {
  return data.explanation[key] ?? "0.00";
}

function CategoryPace({ rows }: { rows: DashboardResponse["categoryPace"] }) {
  return (
    <article className="rounded-md border border-treasuri-line bg-white p-3">
      <h2 className="font-semibold text-sm">Category pace</h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-treasuri-muted text-sm">No category pace yet.</p>
      ) : (
        <div className="mt-2 divide-y divide-treasuri-line">
          {rows.map((row) => (
            <div
              className="grid gap-2 py-2 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_13rem]"
              key={row.category}
            >
              <div>
                <div className="flex items-center justify-between gap-3">
                  <a
                    className="font-medium text-sm hover:text-treasuri-action"
                    href={categoryHref(row.category)}
                  >
                    {row.category}
                  </a>
                  <p className={`text-xs ${paceClass(row.status)}`}>{row.paceLabel}</p>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded bg-treasuri-panel">
                  <div
                    className={`h-full rounded ${paceBarClass(row.status)}`}
                    style={{ width: paceWidth(row) }}
                  />
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  <a
                    className="font-semibold text-treasuri-action"
                    href={categoryHref(row.category)}
                  >
                    Inspect
                  </a>
                  <a
                    className="font-semibold text-treasuri-muted hover:text-treasuri-action"
                    href={categoryTransactionsHref(row.category)}
                  >
                    Transactions
                  </a>
                </div>
              </div>
              <dl className="grid grid-cols-2 gap-2 text-right text-xs">
                <InlineMetric label="Spent" value={`EUR ${row.currentMonth}`} />
                <InlineMetric label="Usual" value={`EUR ${row.suggestedBudget}`} />
              </dl>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

function Panel({
  rows,
  title,
}: {
  rows: readonly { label: string; value: string }[];
  title: string;
}) {
  return (
    <article className="rounded-md border border-treasuri-line bg-white p-3">
      <h2 className="font-semibold text-sm">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-treasuri-muted text-xs">Nothing to show yet.</p>
      ) : (
        <dl className="mt-2 space-y-2 text-xs">
          {rows.map((row) => (
            <div className="flex items-center justify-between gap-4" key={row.label}>
              <dt className="text-treasuri-muted">{row.label}</dt>
              <dd className="font-semibold">{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </article>
  );
}

function MetricCard({
  icon,
  label,
  value,
  valueClassName = "text-treasuri-ink",
}: {
  icon: ReactNode;
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <article className="rounded-md border border-treasuri-line bg-white p-2">
      <div className="flex items-center gap-2 text-treasuri-muted">
        {icon}
        <p className="font-medium text-xs">{label}</p>
      </div>
      <p className={`mt-1 font-semibold text-sm ${valueClassName}`}>{value}</p>
    </article>
  );
}

function ActionLink({ detail, href, label }: { detail: string; href: string; label: string }) {
  return (
    <a
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-1.5 hover:bg-treasuri-panel"
      href={href}
    >
      <span>
        <span className="block font-medium text-sm">{label}</span>
        <span className="block text-treasuri-muted text-xs">{detail}</span>
      </span>
      <ChevronRight aria-hidden="true" className="size-4 text-treasuri-muted" />
    </a>
  );
}

function NextActions({ className, data }: { className: string; data: DashboardResponse }) {
  return (
    <aside className={`${className} rounded-md border border-treasuri-line bg-white p-2`}>
      <p className="font-semibold text-sm">Next actions</p>
      <div className="mt-2 grid gap-1">
        <ActionLink
          detail={`${data.reviewCount} open / EUR ${data.reviewImpact}`}
          href="/review"
          label="Review forecast blockers"
        />
        <ActionLink
          detail="Search, edit, raw payloads"
          href="/transactions"
          label="Inspect transactions"
        />
        <ActionLink detail="Budgets and pace" href="/categories" label="Tune categories" />
      </div>
    </aside>
  );
}

function InlineMetric({ detail, label, value }: { detail?: string; label: string; value: string }) {
  return (
    <div>
      <dt className="font-medium text-treasuri-muted text-xs">{label}</dt>
      <dd className="mt-0.5 font-semibold text-sm">{value}</dd>
      {detail ? <dd className="mt-0.5 text-treasuri-muted text-xs">{detail}</dd> : null}
    </div>
  );
}

function ExplanationMetric({ label, value }: { label: string; value: string }) {
  const isFormula = label === "formula";

  return (
    <div className={isFormula ? "sm:col-span-2" : undefined}>
      <dt className="font-medium text-treasuri-muted text-xs">{label}</dt>
      <dd
        className={`mt-0.5 ${
          isFormula
            ? "max-w-2xl whitespace-pre-wrap break-words font-mono text-treasuri-ink text-xs leading-snug"
            : "font-semibold text-sm"
        }`}
      >
        {isFormula ? value.replaceAll(" - ", "\n- ").replaceAll(" + ", "\n+ ") : value}
      </dd>
    </div>
  );
}

function paceClass(status: DashboardResponse["categoryPace"][number]["status"]): string {
  if (status === "over") {
    return "text-red-700";
  }
  if (status === "watch") {
    return "text-amber-700";
  }
  return "text-treasuri-muted";
}

function paceBarClass(status: DashboardResponse["categoryPace"][number]["status"]): string {
  if (status === "over") {
    return "bg-red-700";
  }
  if (status === "watch") {
    return "bg-amber-600";
  }
  return "bg-treasuri-action";
}

function paceWidth(row: DashboardResponse["categoryPace"][number]): string {
  const current = Number(row.currentMonth);
  const suggested = Number(row.suggestedBudget);
  if (!Number.isFinite(current) || !Number.isFinite(suggested) || suggested <= 0) {
    return "0%";
  }
  return `${Math.min(100, Math.round((current / suggested) * 100))}%`;
}

function categoryHref(category: string): string {
  return `/categories?${new URLSearchParams({ category }).toString()}`;
}

function categoryTransactionsHref(category: string): string {
  return `/transactions?${new URLSearchParams({ category }).toString()}`;
}

function monthLabel(yearMonth: string): string {
  const [year, month] = yearMonth.split("-");
  return new Intl.DateTimeFormat("en", { month: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(Number(year), Number(month) - 1, 1)),
  );
}

function titleCase(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}
