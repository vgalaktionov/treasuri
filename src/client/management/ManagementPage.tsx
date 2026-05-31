import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import {
  applyRule,
  createRule,
  fetchCategories,
  fetchRecurring,
  fetchRules,
  previewRule,
} from "../lib/api.ts";
import { TransactionWorkspace } from "./TransactionWorkspace.tsx";

export function ManagementPage({
  section,
}: {
  section: "categories" | "recurring" | "rules" | "transactions";
}) {
  if (section === "rules") {
    return <RulesPage />;
  }
  if (section === "transactions") {
    return <TransactionWorkspace />;
  }
  if (section === "categories") {
    return <CategoriesPage />;
  }
  if (section === "recurring") {
    return <RecurringPage />;
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
  const categories = useQuery({ queryFn: fetchCategories, queryKey: ["categories"] });
  return (
    <section>
      <p className="font-medium text-sm text-treasuri-muted">Taxonomy</p>
      <h1 className="mt-1 font-semibold text-xl">Categories</h1>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {categories.data?.map((category) => (
          <article
            className="rounded-md border border-treasuri-line bg-white p-3"
            key={category.id}
          >
            {category.name}
          </article>
        ))}
      </div>
    </section>
  );
}

function RecurringPage() {
  const recurring = useQuery({ queryFn: fetchRecurring, queryKey: ["recurring"] });
  return (
    <section>
      <p className="font-medium text-sm text-treasuri-muted">Commitments</p>
      <h1 className="mt-1 font-semibold text-xl">Recurring</h1>
      <div className="mt-4 space-y-2">
        {recurring.data?.series.map((series) => (
          <article className="rounded-md border border-treasuri-line bg-white p-3" key={series.id}>
            <p className="font-semibold">{series.name}</p>
            <p className="text-sm text-treasuri-muted">
              {series.cadence} - {series.amount ?? "0.00"} -{" "}
              {series.nextExpectedDate ?? "not scheduled"}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}

function RulesPage() {
  const queryClient = useQueryClient();
  const rules = useQuery({ queryFn: fetchRules, queryKey: ["rules"] });
  const [pattern, setPattern] = useState("sample");
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const firstCategory = rules.data?.categories[0]?.id ?? 1;
  const ruleInput = useMemo(
    () => ({
      categoryId: firstCategory,
      field: "description" as const,
      name: `Match ${pattern}`,
      pattern,
    }),
    [firstCategory, pattern],
  );
  const preview = useMutation({
    mutationFn: () => previewRule(ruleInput),
    onSuccess: (data) => setPreviewCount(data.matches.length),
  });
  const create = useMutation({
    mutationFn: async () => {
      await preview.mutateAsync();
      const result = await createRule(ruleInput);
      await applyRule(result.ruleId);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["rules"] }),
  });

  return (
    <section>
      <header className="mb-4">
        <p className="font-medium text-sm text-treasuri-muted">Deterministic classification</p>
        <h1 className="mt-1 font-semibold text-xl">Rules</h1>
      </header>
      <div className="rounded-md border border-treasuri-line bg-white p-3">
        <label className="block font-medium text-sm" htmlFor="rule-pattern">
          Description contains
        </label>
        <input
          className="mt-2 min-h-9 w-full rounded-md border border-treasuri-line px-3 text-sm"
          id="rule-pattern"
          onChange={(event) => setPattern(event.target.value)}
          value={pattern}
        />
        <div className="mt-3 flex gap-2">
          <button
            className="min-h-9 rounded-md border border-treasuri-line px-3 font-semibold text-sm"
            onClick={() => preview.mutate()}
            type="button"
          >
            Preview
          </button>
          <button
            className="min-h-9 rounded-md bg-treasuri-action px-3 font-semibold text-sm text-white"
            onClick={() => create.mutate()}
            type="button"
          >
            Create and apply
          </button>
        </div>
        <p className="mt-3 text-sm text-treasuri-muted" aria-live="polite">
          {previewCount === null
            ? "Preview before applying historical changes."
            : `${previewCount} matches in preview.`}
        </p>
      </div>
      <div className="mt-4 space-y-2">
        {rules.data?.rules.map((rule) => (
          <article className="rounded-md border border-treasuri-line bg-white p-3" key={rule.id}>
            <p className="font-semibold">{rule.name}</p>
            <p className="text-sm text-treasuri-muted">
              {rule.field} contains {rule.pattern}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}

function title(section: string): string {
  return `${section.slice(0, 1).toUpperCase()}${section.slice(1)}`;
}
