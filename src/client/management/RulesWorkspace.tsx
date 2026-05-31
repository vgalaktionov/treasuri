import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Play, Save, ToggleLeft, ToggleRight } from "lucide-react";
import { useMemo, useState } from "react";

import type { RuleEditorRequest, RulesResponse } from "../../shared/management.ts";
import {
  applyRule,
  createRule,
  fetchRules,
  previewRule,
  setRuleActive,
  updateRule,
} from "../lib/api.ts";

type RuleItem = RulesResponse["rules"][number];

export function RulesWorkspace() {
  const queryClient = useQueryClient();
  const rules = useQuery({ queryFn: fetchRules, queryKey: ["rules"] });
  const [draft, setDraft] = useState<RuleEditorRequest>(() => emptyRule(1));
  const [preview, setPreview] = useState<{
    matchCount: number;
    wouldChangeCount: number;
    skippedManualCount: number;
  } | null>(null);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["rules"] });
  const previewMutation = useMutation({
    mutationFn: () => previewRule(draft),
    onSuccess: (result) =>
      setPreview({
        matchCount: result.matchCount,
        skippedManualCount: result.skippedManualCount,
        wouldChangeCount: result.wouldChangeCount,
      }),
  });
  const create = useMutation({
    mutationFn: () => createRule(draft),
    onSuccess: invalidate,
  });
  const toggle = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      setRuleActive(id, isActive),
    onSuccess: invalidate,
  });
  const apply = useMutation({
    mutationFn: (id: number) => applyRule(id),
    onSuccess: invalidate,
  });

  const data = rules.data;
  const categories = data?.categories ?? [];
  const firstCategoryId = categories[0]?.id ?? 1;
  const normalizedDraft = useMemo(
    () => ({ ...draft, categoryId: draft.categoryId || firstCategoryId }),
    [draft, firstCategoryId],
  );

  return (
    <section>
      <header className="mb-4">
        <p className="font-medium text-treasuri-muted text-xs sm:text-sm">
          Deterministic classification
        </p>
        <h1 className="mt-1 font-semibold text-lg sm:text-xl">Rules</h1>
      </header>

      {data ? (
        <RuleForm
          categories={categories}
          fields={data.fields}
          onChange={(next) => setDraft(next)}
          onPreview={() => previewMutation.mutate()}
          onSave={() => create.mutate()}
          operators={data.operators}
          preview={preview}
          rule={normalizedDraft}
        />
      ) : null}

      <div className="mt-3 space-y-2">
        {data?.rules.map((rule) => (
          <RuleCard
            categories={categories}
            disabled={toggle.isPending || apply.isPending}
            fields={data.fields}
            key={rule.id}
            onApply={() => apply.mutate(rule.id)}
            onToggle={() => toggle.mutate({ id: rule.id, isActive: !rule.isActive })}
            operators={data.operators}
            rule={rule}
          />
        ))}
      </div>
    </section>
  );
}

function RuleCard({
  categories,
  disabled,
  fields,
  onApply,
  onToggle,
  operators,
  rule,
}: {
  categories: RulesResponse["categories"];
  disabled: boolean;
  fields: RulesResponse["fields"];
  onApply: () => void;
  onToggle: () => void;
  operators: RulesResponse["operators"];
  rule: RuleItem;
}) {
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<RuleEditorRequest>(() => ruleToRequest(rule));
  const save = useMutation({
    mutationFn: () => updateRule(rule.id, draft),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["rules"] }),
  });

  return (
    <article
      className={`rounded-md border border-treasuri-line bg-white p-2 sm:p-3 ${rule.isActive ? "" : "opacity-70"}`}
    >
      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
        <div>
          <div className="flex flex-wrap gap-2 text-treasuri-muted text-xs">
            <span>
              {rule.field} {rule.operator}
            </span>
            <span>priority {rule.priority}</span>
            <span>{rule.isActive ? "active" : "inactive"}</span>
            {rule.flags.map((flag) => (
              <span className="rounded border border-treasuri-line px-1.5 py-0.5" key={flag}>
                {flag}
              </span>
            ))}
          </div>
          <h2 className="mt-1 font-semibold text-sm sm:text-base">{rule.name}</h2>
          <p className="mt-1 text-treasuri-muted text-xs sm:text-sm">
            "{rule.pattern}" to {rule.categoryName ?? "None"}
            {rule.merchantName ? ` / ${rule.merchantName}` : ""}
          </p>
        </div>
        <dl className="grid grid-cols-3 gap-2 text-center text-xs md:min-w-64">
          <Fact label="matches" value={rule.matchCount} />
          <Fact label="change" value={rule.wouldChangeCount} />
          <Fact label="manual" value={rule.manualOverridesSkippedCount} />
        </dl>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          className="min-h-8 rounded-md border border-treasuri-line px-2 font-medium text-xs sm:text-sm"
          onClick={() => setIsEditing((current) => !current)}
          type="button"
        >
          Edit
        </button>
        <button
          className="inline-flex min-h-8 items-center gap-2 rounded-md border border-treasuri-line px-2 font-medium text-xs sm:text-sm"
          disabled={disabled || !rule.isActive || rule.wouldChangeCount === 0}
          onClick={onApply}
          type="button"
        >
          <Play aria-hidden="true" className="size-4" />
          Apply history
        </button>
        <button
          className="inline-flex min-h-8 items-center gap-2 rounded-md border border-treasuri-line px-2 font-medium text-xs sm:text-sm"
          disabled={disabled}
          onClick={onToggle}
          type="button"
        >
          {rule.isActive ? (
            <ToggleRight aria-hidden="true" className="size-4" />
          ) : (
            <ToggleLeft aria-hidden="true" className="size-4" />
          )}
          {rule.isActive ? "Disable" : "Enable"}
        </button>
      </div>
      {isEditing ? (
        <RuleForm
          categories={categories}
          fields={fields}
          onChange={setDraft}
          onSave={() => save.mutate()}
          operators={operators}
          rule={draft}
        />
      ) : null}
    </article>
  );
}

function RuleForm({
  categories,
  fields,
  onChange,
  onPreview,
  onSave,
  operators,
  preview,
  rule,
}: {
  categories: RulesResponse["categories"];
  fields: RulesResponse["fields"];
  onChange: (rule: RuleEditorRequest) => void;
  onPreview?: () => void;
  onSave: () => void;
  operators: RulesResponse["operators"];
  preview?: { matchCount: number; skippedManualCount: number; wouldChangeCount: number } | null;
  rule: RuleEditorRequest;
}) {
  const patch = (next: Partial<RuleEditorRequest>) => onChange({ ...rule, ...next });
  const patchFlags = (next: Partial<RuleEditorRequest["flags"]>) =>
    patch({ flags: { ...rule.flags, ...next } });

  return (
    <form
      className="mt-3 rounded-md border border-treasuri-line bg-white p-2 sm:p-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <div className="grid gap-2 md:grid-cols-[minmax(160px,1fr)_90px_100px_120px_120px_minmax(140px,1fr)]">
        <input
          aria-label="Rule name"
          className="min-h-8 rounded-md border border-treasuri-line px-2 text-xs sm:text-sm"
          onChange={(event) => patch({ name: event.target.value })}
          placeholder="Rule name"
          value={rule.name}
        />
        <input
          aria-label="Priority"
          className="min-h-8 rounded-md border border-treasuri-line px-2 text-xs sm:text-sm"
          min="0"
          onChange={(event) => patch({ priority: Number(event.target.value) })}
          type="number"
          value={rule.priority}
        />
        <select
          aria-label="Rule field"
          className="min-h-8 rounded-md border border-treasuri-line px-2 text-xs sm:text-sm"
          onChange={(event) => patch({ field: event.target.value as RuleEditorRequest["field"] })}
          value={rule.field}
        >
          {fields.map((field) => (
            <option key={field} value={field}>
              {field}
            </option>
          ))}
        </select>
        <select
          aria-label="Rule operator"
          className="min-h-8 rounded-md border border-treasuri-line px-2 text-xs sm:text-sm"
          onChange={(event) =>
            patch({ operator: event.target.value as RuleEditorRequest["operator"] })
          }
          value={rule.operator}
        >
          {operators.map((operator) => (
            <option key={operator} value={operator}>
              {operator}
            </option>
          ))}
        </select>
        <select
          aria-label="Rule category"
          className="min-h-8 rounded-md border border-treasuri-line px-2 text-xs sm:text-sm"
          onChange={(event) => patch({ categoryId: Number(event.target.value) })}
          value={rule.categoryId}
        >
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        <input
          aria-label="Rule pattern"
          className="min-h-8 rounded-md border border-treasuri-line px-2 text-xs sm:text-sm"
          onChange={(event) => patch({ pattern: event.target.value })}
          placeholder="Pattern"
          value={rule.pattern}
        />
      </div>
      <div className="mt-2 grid gap-2 md:grid-cols-[minmax(160px,1fr)_auto]">
        <input
          aria-label="Rule merchant"
          className="min-h-8 rounded-md border border-treasuri-line px-2 text-xs sm:text-sm"
          onChange={(event) => patch({ merchantName: event.target.value || undefined })}
          placeholder="Merchant"
          value={rule.merchantName ?? ""}
        />
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          <Flag
            label="Income"
            checked={rule.flags.setIsIncome}
            onChange={(value) => patchFlags({ setIsIncome: value })}
          />
          <Flag
            label="Transfer"
            checked={rule.flags.setIsTransfer}
            onChange={(value) => patchFlags({ setIsTransfer: value })}
          />
          <Flag
            label="Savings"
            checked={rule.flags.setIsSavings}
            onChange={(value) => patchFlags({ setIsSavings: value })}
          />
          <Flag
            label="Fixed"
            checked={rule.flags.setIsFixedCost}
            onChange={(value) => patchFlags({ setIsFixedCost: value })}
          />
          <Flag
            label="Exclude"
            checked={rule.flags.setIsExcludedFromBudget}
            onChange={(value) => patchFlags({ setIsExcludedFromBudget: value })}
          />
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {onPreview ? (
          <button
            className="min-h-8 rounded-md border border-treasuri-line px-2 font-medium text-xs sm:text-sm"
            onClick={onPreview}
            type="button"
          >
            Preview
          </button>
        ) : null}
        <button
          className="inline-flex min-h-8 items-center gap-2 rounded-md bg-treasuri-action px-3 font-semibold text-xs text-white sm:text-sm"
          type="submit"
        >
          <Save aria-hidden="true" className="size-4" />
          Save rule
        </button>
        {preview ? (
          <span className="text-treasuri-muted text-xs">
            {preview.matchCount} matches, {preview.wouldChangeCount} changes,{" "}
            {preview.skippedManualCount} manual skipped
          </span>
        ) : null}
      </div>
    </form>
  );
}

function Flag({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-h-8 items-center gap-1 text-xs">
      <input
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      {label}
    </label>
  );
}

function Fact({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-treasuri-muted">{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}

function emptyRule(categoryId: number): RuleEditorRequest {
  return {
    categoryId,
    field: "description",
    flags: {
      setIsExcludedFromBudget: false,
      setIsFixedCost: false,
      setIsIncome: false,
      setIsSavings: false,
      setIsTransfer: false,
    },
    isActive: true,
    name: "New rule",
    operator: "contains",
    pattern: "",
    priority: 100,
  };
}

function ruleToRequest(rule: RuleItem): RuleEditorRequest {
  return {
    categoryId: rule.categoryId ?? 0,
    field: rule.field,
    flags: {
      setIsExcludedFromBudget: rule.flags.includes("excluded"),
      setIsFixedCost: rule.flags.includes("fixed"),
      setIsIncome: rule.flags.includes("income"),
      setIsSavings: rule.flags.includes("savings"),
      setIsTransfer: rule.flags.includes("transfer"),
    },
    isActive: rule.isActive,
    merchantName: rule.merchantName ?? undefined,
    name: rule.name,
    operator: rule.operator,
    pattern: rule.pattern,
    priority: rule.priority,
  };
}
