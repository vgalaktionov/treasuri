import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import type { CategoryBudgetResponse } from "../../shared/management.ts";
import { fetchCategoryBudgets } from "../lib/api.ts";
import { RecurringWorkspace } from "./RecurringWorkspace.tsx";
import { RulesWorkspace } from "./RulesWorkspace.tsx";
import { TransactionWorkspace } from "./TransactionWorkspace.tsx";

export function ManagementPage({
  section,
}: {
  section: "categories" | "recurring" | "rules" | "transactions";
}) {
  if (section === "rules") {
    return <RulesWorkspace />;
  }
  if (section === "transactions") {
    return <TransactionWorkspace />;
  }
  if (section === "categories") {
    return <CategoriesPage />;
  }
  if (section === "recurring") {
    return <RecurringWorkspace />;
  }
  return (
    <section>
      <p className="font-medium text-sm text-treasuri-muted">Management</p>
      <h1 className="mt-1 font-semibold text-xl">{title(section)}</h1>
      <p className="mt-2 text-sm text-treasuri-muted">
        This workspace is backed by the same API used by transactions and rules.
      </p>
    </section>
  );
}

function CategoriesPage() {
  const budgets = useQuery({ queryFn: fetchCategoryBudgets, queryKey: ["category-budgets"] });
  const [activeCategoryId, setActiveCategoryId] = useState<number | null>(null);
  const [filter, setFilter] = useState<"all" | "included" | "attention" | "excluded">(() =>
    readCategoryNameFromUrl() ? "all" : "included",
  );
  const [query, setQuery] = useState("");
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (budgets.data?.categories ?? []).filter((category) => {
      const matchesQuery = needle ? category.name.toLowerCase().includes(needle) : true;
      const matchesFilter =
        filter === "all" ||
        (filter === "included" && category.includedInForecast) ||
        (filter === "excluded" && !category.includedInForecast) ||
        (filter === "attention" && (category.status === "over" || category.status === "watch"));
      return matchesQuery && matchesFilter;
    });
  }, [budgets.data?.categories, filter, query]);
  const activeCategory =
    rows.find((category) => category.id === activeCategoryId) ?? rows[0] ?? null;

  useEffect(() => {
    if (rows.length === 0) {
      setActiveCategoryId(null);
      return;
    }
    const requestedCategory = readCategoryNameFromUrl();
    const deepLinked = requestedCategory
      ? rows.find((category) => category.name === requestedCategory)
      : null;
    if (deepLinked && deepLinked.id !== activeCategoryId) {
      setActiveCategoryId(deepLinked.id);
      return;
    }
    if (!activeCategoryId || !rows.some((category) => category.id === activeCategoryId)) {
      setActiveCategoryId(rows[0]?.id ?? null);
    }
  }, [activeCategoryId, rows]);

  function inspectCategory(category: CategoryBudgetResponse["categories"][number]) {
    setActiveCategoryId(category.id);
    window.history.replaceState(null, "", categoriesUrl(category.name));
  }

  if (budgets.isLoading) {
    return <p className="text-treasuri-muted">Loading category budgets...</p>;
  }
  if (budgets.isError || !budgets.data) {
    return <p className="text-red-700">Category budgets are unavailable.</p>;
  }

  const data = budgets.data;

  return (
    <section>
      <header className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-medium text-treasuri-muted text-xs sm:text-sm">
            {monthLabel(data.yearMonth)} budget averages
          </p>
          <h1 className="mt-1 font-semibold text-lg sm:text-xl">Categories</h1>
        </div>
        <p className="text-treasuri-muted text-xs sm:text-sm">
          {data.totals.includedCount} forecast categories
        </p>
      </header>

      <section aria-label="Category totals" className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        <MetricCard label="Current spend" value={`EUR ${data.totals.currentMonth}`} />
        <MetricCard label="Suggested budget" value={`EUR ${data.totals.suggestedBudget}`} />
        <MetricCard
          label="Watch / over"
          value={`${data.totals.watchCount} / ${data.totals.overCount}`}
        />
        <MetricCard label="Excluded" value={`EUR ${data.totals.excludedFromForecast}`} />
      </section>

      <div className="mt-3 flex flex-col gap-2 rounded-md border border-treasuri-line bg-white p-2 sm:flex-row sm:items-center sm:justify-between">
        <fieldset className="flex flex-wrap gap-1">
          <legend className="sr-only">Category budget filter</legend>
          {(["included", "attention", "excluded", "all"] as const).map((item) => (
            <button
              className={`min-h-8 rounded-md px-3 font-semibold text-xs ${
                filter === item
                  ? "bg-treasuri-action text-white"
                  : "border border-treasuri-line bg-white text-treasuri-ink"
              }`}
              key={item}
              onClick={() => setFilter(item)}
              type="button"
            >
              {filterLabel(item)}
            </button>
          ))}
        </fieldset>
        <input
          aria-label="Search categories"
          className="min-h-8 rounded-md border border-treasuri-line px-2 text-sm sm:w-56"
          name="categoryQuery"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search"
          value={query}
        />
      </div>

      <div className="mt-3 grid items-start gap-3 xl:grid-cols-[minmax(0,1fr)_20rem]">
        {rows.length === 0 ? (
          <article className="rounded-md border border-treasuri-line bg-white p-3">
            <p className="font-medium text-sm">No categories match this view.</p>
          </article>
        ) : (
          <div className="overflow-hidden rounded-md border border-treasuri-line bg-white">
            <div className="hidden grid-cols-[minmax(10rem,1fr)_repeat(5,minmax(5.5rem,0.55fr))_minmax(7rem,0.8fr)] gap-2 border-treasuri-line border-b bg-treasuri-panel px-3 py-2 font-semibold text-treasuri-muted text-xs lg:grid">
              <span>Category</span>
              <span className="text-right">Current</span>
              <span className="text-right">3M avg</span>
              <span className="text-right">6M avg</span>
              <span className="text-right">12M avg</span>
              <span className="text-right">Suggested</span>
              <span>Status</span>
            </div>
            <div className="divide-y divide-treasuri-line">
              {rows.map((category) => (
                <CategoryRow
                  category={category}
                  isActive={category.id === activeCategory?.id}
                  key={category.id}
                  onInspect={inspectCategory}
                />
              ))}
            </div>
          </div>
        )}
        <CategoryInspector category={activeCategory} yearMonth={data.yearMonth} />
      </div>
    </section>
  );
}

function CategoryRow({
  category,
  isActive,
  onInspect,
}: {
  category: CategoryBudgetResponse["categories"][number];
  isActive: boolean;
  onInspect: (category: CategoryBudgetResponse["categories"][number]) => void;
}) {
  const percent = budgetPercent(category.currentMonth, category.suggestedBudget);
  return (
    <article
      className={`grid gap-2 p-3 lg:grid-cols-[minmax(10rem,1fr)_repeat(5,minmax(5.5rem,0.55fr))_minmax(7rem,0.8fr)] lg:items-center ${
        isActive ? "bg-teal-50" : "bg-white"
      }`}
    >
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold text-sm">{category.name}</h2>
          <span
            className={`rounded-sm px-1.5 py-0.5 font-semibold text-[0.68rem] ${badgeClass(category)}`}
          >
            {category.includedInForecast ? "forecast" : "excluded"}
          </span>
          <button
            aria-label={`Inspect ${category.name}`}
            className="rounded-sm border border-treasuri-line bg-white px-1.5 py-0.5 font-semibold text-[0.68rem] text-treasuri-action"
            onClick={() => onInspect(category)}
            type="button"
          >
            Inspect
          </button>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-treasuri-panel">
          <div
            className={`h-full rounded-full ${barClass(category.status)}`}
            style={{ width: `${percent}%` }}
          />
        </div>
        {Number(category.excludedFromForecast) > 0 ? (
          <p className="mt-1 text-treasuri-muted text-xs">
            EUR {category.excludedFromForecast} excluded from forecast
          </p>
        ) : null}
      </div>
      <CategoryAmount label="Current" value={category.currentMonth} />
      <CategoryAmount label="3M avg" value={category.average3m} />
      <CategoryAmount label="6M avg" value={category.average6m} />
      <CategoryAmount label="12M avg" value={category.average12m} />
      <CategoryAmount label="Suggested" value={category.suggestedBudget} strong />
      <div>
        <p className={`font-semibold text-xs ${statusClass(category.status)}`}>
          {category.paceLabel}
        </p>
        <p className="mt-1 text-treasuri-muted text-xs">{statusLabel(category.status)}</p>
      </div>
    </article>
  );
}

function CategoryInspector({
  category,
  yearMonth,
}: {
  category: CategoryBudgetResponse["categories"][number] | null;
  yearMonth: string;
}) {
  if (!category) {
    return (
      <aside className="rounded-md border border-treasuri-line bg-white p-3">
        <h2 className="font-semibold text-sm">Category inspector</h2>
        <p className="mt-2 text-treasuri-muted text-xs">Select a category to inspect its pace.</p>
      </aside>
    );
  }

  const delta = Number(category.suggestedBudget) - Number(category.currentMonth);
  const trend = Number(category.average3m) - Number(category.average6m);
  const monthTransactionsUrl = transactionsUrl(category.name, yearMonth);
  const allTransactionsUrl = transactionsUrl(category.name);

  return (
    <aside className="rounded-md border border-treasuri-line bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-sm">Category inspector</p>
          <h2 className="mt-1 truncate font-semibold text-base">{category.name}</h2>
        </div>
        <span
          className={`rounded-sm px-1.5 py-0.5 font-semibold text-[0.68rem] ${badgeClass(category)}`}
        >
          {statusLabel(category.status)}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2">
        <InspectorMetric label="Current" value={`EUR ${category.currentMonth}`} />
        <InspectorMetric label="Suggested" value={`EUR ${category.suggestedBudget}`} />
        <InspectorMetric label="3M average" value={`EUR ${category.average3m}`} />
        <InspectorMetric label="6M average" value={`EUR ${category.average6m}`} />
        <InspectorMetric label="12M average" value={`EUR ${category.average12m}`} />
        <InspectorMetric
          label="Forecast"
          value={category.includedInForecast ? "Included" : "Excluded"}
        />
      </dl>

      <div className="mt-3 rounded-md border border-treasuri-line bg-treasuri-panel p-2">
        <p className={`font-semibold text-sm ${delta < 0 ? "text-red-700" : "text-treasuri-ink"}`}>
          {delta >= 0 ? `EUR ${delta.toFixed(2)} left` : `EUR ${Math.abs(delta).toFixed(2)} over`}
        </p>
        <p className="mt-1 text-treasuri-muted text-xs">
          3M baseline is {trend >= 0 ? "up" : "down"} EUR {Math.abs(trend).toFixed(2)} versus 6M.
          EUR {category.excludedFromForecast} is excluded from the forecast.
        </p>
      </div>

      <div className="mt-3 grid gap-2">
        <a
          className="inline-flex min-h-8 items-center justify-center rounded-md bg-treasuri-action px-3 font-semibold text-sm text-white"
          href={monthTransactionsUrl}
        >
          Open month transactions
        </a>
        <a
          className="inline-flex min-h-8 items-center justify-center rounded-md border border-treasuri-line px-3 font-semibold text-sm"
          href={allTransactionsUrl}
        >
          Open all history
        </a>
      </div>
    </aside>
  );
}

function InspectorMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-medium text-treasuri-muted text-xs">{label}</dt>
      <dd className="mt-0.5 font-semibold text-sm">{value}</dd>
    </div>
  );
}

function CategoryAmount({
  label,
  strong = false,
  value,
}: {
  label: string;
  strong?: boolean;
  value: string;
}) {
  return (
    <dl className="flex items-center justify-between gap-3 text-sm lg:block lg:text-right">
      <dt className="text-treasuri-muted text-xs lg:hidden">{label}</dt>
      <dd className={strong ? "font-semibold" : ""}>EUR {value}</dd>
    </dl>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-md border border-treasuri-line bg-white p-2 sm:p-3">
      <p className="font-medium text-treasuri-muted text-xs">{label}</p>
      <p className="mt-1 font-semibold text-sm sm:text-base">{value}</p>
    </article>
  );
}

function title(section: string): string {
  return `${section.slice(0, 1).toUpperCase()}${section.slice(1)}`;
}

function filterLabel(filter: "all" | "attention" | "excluded" | "included"): string {
  return {
    all: "All",
    attention: "Attention",
    excluded: "Excluded",
    included: "Forecast",
  }[filter];
}

function budgetPercent(currentMonth: string, suggestedBudget: string): number {
  const suggested = Number(suggestedBudget);
  if (suggested <= 0) {
    return 0;
  }
  return Math.max(4, Math.min(100, Math.round((Number(currentMonth) / suggested) * 100)));
}

function badgeClass(category: CategoryBudgetResponse["categories"][number]): string {
  if (!category.includedInForecast) {
    return "bg-treasuri-panel text-treasuri-muted";
  }
  if (category.status === "over") {
    return "bg-red-50 text-red-700";
  }
  if (category.status === "watch") {
    return "bg-amber-50 text-amber-700";
  }
  return "bg-emerald-50 text-emerald-700";
}

function barClass(status: CategoryBudgetResponse["categories"][number]["status"]): string {
  if (status === "over") {
    return "bg-red-600";
  }
  if (status === "watch") {
    return "bg-amber-500";
  }
  return "bg-treasuri-action";
}

function statusClass(status: CategoryBudgetResponse["categories"][number]["status"]): string {
  if (status === "over") {
    return "text-red-700";
  }
  if (status === "watch") {
    return "text-amber-700";
  }
  return "text-treasuri-ink";
}

function statusLabel(status: CategoryBudgetResponse["categories"][number]["status"]): string {
  if (status === "empty") {
    return "No current budget signal";
  }
  if (status === "over") {
    return "Above suggested monthly budget";
  }
  if (status === "watch") {
    return "Close to suggested monthly budget";
  }
  return "Within suggested monthly budget";
}

function transactionsUrl(category: string, yearMonth?: string): string {
  const params = new URLSearchParams({ category });
  if (yearMonth) {
    params.set("month", yearMonth);
  }
  return `/transactions?${params.toString()}`;
}

function categoriesUrl(category: string): string {
  return `/categories?${new URLSearchParams({ category }).toString()}`;
}

function readCategoryNameFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get("category");
}

function monthLabel(yearMonth: string): string {
  const [year, month] = yearMonth.split("-");
  return new Intl.DateTimeFormat("en", { month: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(Number(year), Number(month) - 1, 1)),
  );
}
