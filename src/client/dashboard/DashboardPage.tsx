import { useQuery } from "@tanstack/react-query";

import type { DashboardResponse } from "../../shared/dashboard.ts";
import { fetchDashboard } from "../lib/api.ts";

export function DashboardPage() {
  const dashboard = useQuery({ queryFn: fetchDashboard, queryKey: ["dashboard"] });

  if (dashboard.isLoading) {
    return <p className="text-treasuri-muted">Loading dashboard...</p>;
  }
  if (dashboard.isError || !dashboard.data) {
    return <p className="text-red-700">Dashboard is unavailable.</p>;
  }

  const data = dashboard.data;
  const safeToSpendClass = Number(data.safeToSpend) < 0 ? "text-red-700" : "text-treasuri-ink";

  return (
    <>
      <header className="mb-4">
        <p className="font-medium text-treasuri-muted text-xs sm:text-sm">
          {monthLabel(data.yearMonth)} status
        </p>
        <h1 className={`mt-1 font-semibold text-lg sm:text-2xl ${safeToSpendClass}`}>
          EUR {data.safeToSpend}
        </h1>
        <p className="mt-1 max-w-3xl text-treasuri-muted text-xs sm:text-sm">
          Safe to spend this month. {data.paceSummary}
        </p>
      </header>

      <section aria-label="Monthly summary" className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        {data.metrics.map((metric) => (
          <article
            className="rounded-md border border-treasuri-line bg-white p-2 sm:p-3"
            key={metric.label}
          >
            <p className="font-medium text-treasuri-muted text-xs sm:text-sm">{metric.label}</p>
            <p className="mt-1 font-semibold text-xs sm:text-base">{metric.value}</p>
          </article>
        ))}
      </section>

      <section className="mt-3 grid gap-2 sm:grid-cols-3">
        {data.monthFacts.map((fact) => (
          <article
            className="rounded-md border border-treasuri-line bg-white p-2 sm:p-3"
            key={fact.label}
          >
            <p className="font-medium text-treasuri-muted text-xs">{fact.label}</p>
            <p className="mt-1 font-semibold text-xs sm:text-base">{fact.value}</p>
            <p className="mt-1 text-treasuri-muted text-xs">{fact.detail}</p>
          </article>
        ))}
      </section>

      <section className="mt-3 grid gap-2 xl:grid-cols-[1.2fr_0.8fr]">
        <article className="rounded-md border border-treasuri-line bg-white p-2 sm:p-3">
          <h2 className="font-semibold text-sm sm:text-base">Current balance</h2>
          {data.currentBalance ? (
            <dl className="mt-2 grid gap-2 sm:grid-cols-2">
              <Metric label="Amount" value={`EUR ${data.currentBalance.amount}`} />
              <Metric label="Source" value={data.currentBalance.source} />
              <Metric label="As of" value={data.currentBalance.asOf} />
              <Metric label="Confidence" value={titleCase(data.confidence)} />
            </dl>
          ) : (
            <p className="mt-2 text-treasuri-muted text-sm">No synced balance snapshot yet.</p>
          )}
        </article>

        <article className="rounded-md border border-treasuri-line bg-white p-2 sm:p-3">
          <h2 className="font-semibold text-sm sm:text-base">Review impact</h2>
          <p className="mt-2 text-treasuri-muted text-xs sm:text-sm">
            {data.reviewCount} transactions need review, covering EUR {data.reviewImpact}.
          </p>
          <p className="mt-2 text-treasuri-muted text-xs">{data.confidenceNote}</p>
        </article>
      </section>

      <section className="mt-3 grid gap-2 xl:grid-cols-[1fr_1fr]">
        <CategoryPace rows={data.categoryPace} />
        <div className="grid gap-2 lg:grid-cols-2 xl:grid-cols-1">
          <Panel title="Top category spend" rows={data.topVariances} />
          <Panel title="Upcoming fixed costs" rows={data.upcomingFixedCosts} />
        </div>
      </section>

      <details className="mt-3 rounded-md border border-treasuri-line bg-white p-2 sm:p-3">
        <summary className="cursor-pointer font-semibold text-sm sm:text-base">
          Forecast explanation
        </summary>
        <dl className="mt-2 grid gap-2 sm:grid-cols-2">
          {Object.entries(data.explanation).map(([label, value]) => (
            <Metric key={label} label={label.replaceAll("_", " ")} value={value} />
          ))}
        </dl>
      </details>
    </>
  );
}

function CategoryPace({ rows }: { rows: DashboardResponse["categoryPace"] }) {
  return (
    <article className="rounded-md border border-treasuri-line bg-white p-2 sm:p-3">
      <h2 className="font-semibold text-sm sm:text-base">Category pace</h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-treasuri-muted text-sm">No category pace yet.</p>
      ) : (
        <div className="mt-2 space-y-2">
          {rows.map((row) => (
            <div
              className="grid gap-2 border-t border-treasuri-line pt-2 first:border-t-0 first:pt-0 sm:grid-cols-[minmax(0,1fr)_auto]"
              key={row.category}
            >
              <div>
                <p className="font-medium text-sm">{row.category}</p>
                <p className={`mt-0.5 text-xs ${paceClass(row.status)}`}>{row.paceLabel}</p>
              </div>
              <dl className="grid grid-cols-2 gap-2 text-xs sm:min-w-40">
                <Metric label="Spent" value={`EUR ${row.currentMonth}`} />
                <Metric label="Usual" value={`EUR ${row.suggestedBudget}`} />
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
    <article className="rounded-md border border-treasuri-line bg-white p-2 sm:p-3">
      <h2 className="font-semibold text-sm sm:text-base">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-treasuri-muted text-sm">Nothing to show yet.</p>
      ) : (
        <dl className="mt-2 space-y-2 text-xs sm:text-sm">
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-medium text-treasuri-muted text-xs">{label}</dt>
      <dd className="mt-1 font-semibold text-xs sm:text-base">{value}</dd>
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

function monthLabel(yearMonth: string): string {
  const [year, month] = yearMonth.split("-");
  return new Intl.DateTimeFormat("en", { month: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(Number(year), Number(month) - 1, 1)),
  );
}

function titleCase(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}
