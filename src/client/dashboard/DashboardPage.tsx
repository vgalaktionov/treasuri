import { useQuery } from "@tanstack/react-query";

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
      <header className="mb-6">
        <p className="font-medium text-sm text-treasuri-muted">
          {monthLabel(data.yearMonth)} status
        </p>
        <h1 className={`mt-1 font-semibold text-4xl ${safeToSpendClass}`}>
          EUR {data.safeToSpend}
        </h1>
        <p className="mt-2 max-w-2xl text-treasuri-muted">
          Safe to spend this month, based on synced current balance and remaining forecast inputs.
        </p>
      </header>

      <section aria-label="Monthly summary" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {data.metrics.map((metric) => (
          <article
            className="rounded-lg border border-treasuri-line bg-white p-4"
            key={metric.label}
          >
            <p className="font-medium text-sm text-treasuri-muted">{metric.label}</p>
            <p className="mt-3 font-semibold text-2xl">{metric.value}</p>
          </article>
        ))}
      </section>

      <section className="mt-6 grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <article className="rounded-lg border border-treasuri-line bg-white p-4">
          <h2 className="font-semibold text-lg">Current balance</h2>
          {data.currentBalance ? (
            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
              <Metric label="Amount" value={`EUR ${data.currentBalance.amount}`} />
              <Metric label="Source" value={data.currentBalance.source} />
              <Metric label="As of" value={data.currentBalance.asOf} />
              <Metric label="Confidence" value={titleCase(data.confidence)} />
            </dl>
          ) : (
            <p className="mt-3 text-treasuri-muted">No synced balance snapshot yet.</p>
          )}
        </article>

        <article className="rounded-lg border border-treasuri-line bg-white p-4">
          <h2 className="font-semibold text-lg">Review impact</h2>
          <p className="mt-4 text-treasuri-muted">
            {data.reviewCount} transactions need review, covering EUR {data.reviewImpact}.
          </p>
        </article>
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-2">
        <Panel title="Top category spend" rows={data.topVariances} />
        <Panel title="Upcoming fixed costs" rows={data.upcomingFixedCosts} />
      </section>

      <details className="mt-6 rounded-lg border border-treasuri-line bg-white p-4">
        <summary className="cursor-pointer font-semibold">Forecast explanation</summary>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          {Object.entries(data.explanation).map(([label, value]) => (
            <Metric key={label} label={label.replaceAll("_", " ")} value={value} />
          ))}
        </dl>
      </details>
    </>
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
    <article className="rounded-lg border border-treasuri-line bg-white p-4">
      <h2 className="font-semibold text-lg">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-3 text-treasuri-muted">Nothing to show yet.</p>
      ) : (
        <dl className="mt-4 space-y-3">
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
      <dt className="font-medium text-sm text-treasuri-muted">{label}</dt>
      <dd className="mt-1 font-semibold">{value}</dd>
    </div>
  );
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
