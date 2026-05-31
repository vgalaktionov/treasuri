import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarDays, ChevronRight, Gauge, Wallet } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

import type { DashboardResponse } from "../../shared/dashboard.ts";
import { fetchDashboard } from "../lib/api.ts";

type DashboardMode = "explain" | "month" | "now";

export function DashboardPage() {
  const dashboard = useQuery({ queryFn: fetchDashboard, queryKey: ["dashboard"] });
  const [mode, setMode] = useState<DashboardMode>("now");

  if (dashboard.isLoading) {
    return <p className="text-treasuri-muted">Loading dashboard...</p>;
  }
  if (dashboard.isError || !dashboard.data) {
    return <p className="text-red-700">Dashboard is unavailable.</p>;
  }

  const data = dashboard.data;
  const safeToSpendClass = Number(data.safeToSpend) < 0 ? "text-red-700" : "text-treasuri-ink";
  const safeTodayClass = Number(data.safeToday) < 0 ? "text-red-700" : "text-treasuri-ink";
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
              EUR {data.safeToSpend}
            </h1>
            <p className="font-medium text-treasuri-muted text-sm">safe to spend this month</p>
          </div>
          <p className="mt-1 max-w-3xl text-treasuri-muted text-xs">{data.paceSummary}</p>
          <MonthProgressBar progress={data.monthProgress} />
        </div>

        <TodayLimit
          className="border-t border-treasuri-line pt-3 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-3"
          data={data}
          valueClassName={safeTodayClass}
        />
      </header>

      <div
        aria-label="Dashboard view"
        className="mb-3 inline-grid w-full grid-cols-3 rounded-md border border-treasuri-line bg-white p-1 text-xs sm:w-auto"
        role="tablist"
      >
        {dashboardModes.map(([value, label]) => (
          <button
            aria-selected={mode === value}
            className={`min-h-8 rounded px-3 font-semibold ${
              mode === value
                ? "bg-treasuri-action text-white"
                : "text-treasuri-muted hover:bg-treasuri-panel"
            }`}
            key={value}
            onClick={() => setMode(value)}
            role="tab"
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      <section className="grid items-start gap-2 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="grid gap-3">
          <div className="grid grid-cols-2 items-start gap-2 xl:grid-cols-4">
            <MetricCard
              icon={<Wallet className="size-4" />}
              label="Safe today"
              value={`EUR ${data.safeToday}`}
              valueClassName={safeTodayClass}
            />
            <MetricCard
              icon={<Gauge className="size-4" />}
              label="Projected savings"
              value={`EUR ${data.projectedSavings}`}
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

          {mode === "now" ? <NowWorkspace data={data} reviewClass={reviewClass} /> : null}
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

function TodayLimit({
  className,
  data,
  valueClassName,
}: {
  className: string;
  data: DashboardResponse;
  valueClassName: string;
}) {
  return (
    <aside className={className}>
      <p className="font-medium text-treasuri-muted text-xs">Today</p>
      <p className={`mt-1 font-semibold text-lg leading-tight ${valueClassName}`}>
        EUR {data.safeToday}
      </p>
      <p className="mt-1 text-treasuri-muted text-xs">safe to spend today</p>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <InlineMetric label="Safe/day" value={`EUR ${data.safePerDay}`} />
        <InlineMetric label="Days left" value={String(data.monthProgress.remainingDays)} />
      </dl>
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

function NowWorkspace({ data, reviewClass }: { data: DashboardResponse; reviewClass: string }) {
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
          <InlineMetric label="Today limit" value={`EUR ${data.safeToday}`} />
          <InlineMetric label="Safe per day" value={`EUR ${data.safePerDay}/day`} />
          <InlineMetric
            label="Synced balance"
            value={data.currentBalance ? `EUR ${data.currentBalance.amount}` : "Missing"}
          />
          <InlineMetric label="Income received" value={`EUR ${data.incomeReceived}`} />
          <InlineMetric label="Projected savings" value={`EUR ${data.projectedSavings}`} />
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
      </article>
    </div>
  );
}

function MonthWorkspace({ data }: { data: DashboardResponse }) {
  return (
    <div className="grid gap-2 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <CategoryPace rows={data.categoryPace} />
      <div className="grid gap-2">
        <Panel title="Top category spend" rows={data.topVariances} />
        <Panel title="Upcoming fixed costs" rows={data.upcomingFixedCosts} />
      </div>
    </div>
  );
}

function ExplainWorkspace({ data }: { data: DashboardResponse }) {
  return (
    <article className="rounded-md border border-treasuri-line bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-sm">Forecast explanation</p>
          <p className="mt-1 text-treasuri-muted text-xs">
            The safe-to-spend number is arithmetic, not a hidden score.
          </p>
        </div>
        <span className="rounded border border-treasuri-line px-2 py-1 font-semibold text-treasuri-muted text-xs">
          {titleCase(data.confidence)} confidence
        </span>
      </div>
      <dl className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {Object.entries(data.explanation).map(([label, value]) => (
          <ExplanationMetric key={label} label={label.replaceAll("_", " ")} value={value} />
        ))}
      </dl>
    </article>
  );
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
                  <p className="font-medium text-sm">{row.category}</p>
                  <p className={`text-xs ${paceClass(row.status)}`}>{row.paceLabel}</p>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded bg-treasuri-panel">
                  <div
                    className={`h-full rounded ${paceBarClass(row.status)}`}
                    style={{ width: paceWidth(row) }}
                  />
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

function monthLabel(yearMonth: string): string {
  const [year, month] = yearMonth.split("-");
  return new Intl.DateTimeFormat("en", { month: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(Number(year), Number(month) - 1, 1)),
  );
}

function titleCase(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}
