import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FilePlus2, Play, Save, ToggleLeft, ToggleRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type {
  RuleEditorRequest,
  RulePreviewResponse,
  RulesResponse,
} from "../../shared/management.ts";
import {
  applyRule,
  createRule,
  fetchRules,
  previewRule,
  setRuleActive,
  updateRule,
} from "../lib/api.ts";

type RuleItem = RulesResponse["rules"][number];
type EditorMode = { kind: "new" } | { id: number; kind: "edit" };
export function RulesWorkspace() {
  const queryClient = useQueryClient();
  const rules = useQuery({ queryFn: fetchRules, queryKey: ["rules"] });
  const [mode, setMode] = useState<EditorMode>({ kind: "new" });
  const [draft, setDraft] = useState<RuleEditorRequest>(() => emptyRule(1));
  const [preview, setPreview] = useState<RulePreviewResponse | null>(null);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["rules"] });
  const data = rules.data;
  const categories = data?.categories ?? [];
  const firstCategoryId = categories[0]?.id ?? 1;
  const selectedRule =
    mode.kind === "edit" ? (data?.rules.find((rule) => rule.id === mode.id) ?? null) : null;
  const normalizedDraft = useMemo(
    () => ({ ...draft, categoryId: draft.categoryId || firstCategoryId }),
    [draft, firstCategoryId],
  );

  const previewMutation = useMutation({
    mutationFn: () => previewRule(normalizedDraft),
    onSuccess: setPreview,
  });
  const save = useMutation({
    mutationFn: async () => {
      if (mode.kind === "edit") {
        await updateRule(mode.id, normalizedDraft);
        return;
      }
      await createRule(normalizedDraft);
    },
    onSuccess: () => {
      setPreview(null);
      invalidate();
    },
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

  useEffect(() => {
    if (!data) {
      return;
    }
    if (mode.kind === "edit") {
      const rule = data.rules.find((item) => item.id === mode.id);
      if (rule) {
        setDraft(ruleToRequest(rule, firstCategoryId));
        setPreview(null);
        return;
      }
      setMode({ kind: "new" });
    }
    setDraft((current) =>
      current.categoryId
        ? current
        : { ...emptyRule(firstCategoryId), ...current, categoryId: firstCategoryId },
    );
  }, [data, firstCategoryId, mode]);

  function startNew() {
    setMode({ kind: "new" });
    setDraft(emptyRule(firstCategoryId));
    setPreview(null);
  }

  function selectRule(rule: RuleItem) {
    setMode({ id: rule.id, kind: "edit" });
    setDraft(ruleToRequest(rule, firstCategoryId));
    setPreview(null);
  }

  if (rules.isLoading) {
    return <p className="text-treasuri-muted">Loading rules...</p>;
  }
  if (rules.isError || !data) {
    return <p className="text-red-700">Rules are unavailable.</p>;
  }

  return (
    <section>
      <header className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-medium text-treasuri-muted text-xs sm:text-sm">
            Deterministic classification
          </p>
          <h1 className="mt-1 font-semibold text-lg sm:text-xl">Rules</h1>
        </div>
        <button
          className="inline-flex min-h-8 items-center gap-2 rounded-md border border-treasuri-line bg-white px-3 font-semibold text-xs sm:text-sm"
          onClick={startNew}
          type="button"
        >
          <FilePlus2 aria-hidden="true" className="size-4" />
          New rule
        </button>
      </header>

      <div className="grid gap-3 xl:grid-cols-[minmax(17rem,0.7fr)_minmax(0,1fr)]">
        <RuleList
          activeId={mode.kind === "edit" ? mode.id : null}
          className="order-2 xl:order-1"
          onSelect={selectRule}
          rules={data.rules}
        />
        <RuleEditorPanel
          categories={categories}
          className="order-1 xl:order-2"
          disabled={save.isPending || toggle.isPending || apply.isPending}
          fields={data.fields}
          mode={mode}
          onApply={selectedRule ? () => apply.mutate(selectedRule.id) : undefined}
          onChange={setDraft}
          onPreview={() => previewMutation.mutate()}
          onSave={() => save.mutate()}
          onToggle={
            selectedRule
              ? () => toggle.mutate({ id: selectedRule.id, isActive: !selectedRule.isActive })
              : undefined
          }
          operators={data.operators}
          preview={preview}
          rule={normalizedDraft}
          selectedRule={selectedRule}
        />
      </div>
    </section>
  );
}

function RuleList({
  activeId,
  className,
  onSelect,
  rules,
}: {
  activeId: number | null;
  className: string;
  onSelect: (rule: RuleItem) => void;
  rules: RuleItem[];
}) {
  if (rules.length === 0) {
    return (
      <aside className={`${className} rounded-md border border-treasuri-line bg-white p-3`}>
        <p className="font-semibold text-sm">No rules yet.</p>
        <p className="mt-1 text-treasuri-muted text-xs">
          Save a review correction or create the first deterministic classifier.
        </p>
      </aside>
    );
  }

  return (
    <aside
      className={`${className} overflow-hidden rounded-md border border-treasuri-line bg-white`}
    >
      <div className="flex items-center justify-between border-b border-treasuri-line bg-treasuri-panel px-3 py-2">
        <p className="font-semibold text-sm">Rule set</p>
        <p className="text-treasuri-muted text-xs">{rules.length} rules</p>
      </div>
      <div className="divide-y divide-treasuri-line">
        {rules.map((rule) => (
          <button
            aria-current={rule.id === activeId ? "true" : undefined}
            className={`grid w-full gap-2 px-3 py-2 text-left hover:bg-treasuri-panel ${
              rule.id === activeId ? "bg-teal-50" : "bg-white"
            } ${rule.isActive ? "" : "opacity-70"}`}
            key={rule.id}
            onClick={() => onSelect(rule)}
            type="button"
          >
            <span className="flex items-start justify-between gap-3">
              <span className="min-w-0">
                <span className="block truncate font-semibold text-sm">{rule.name}</span>
                <span className="block truncate text-treasuri-muted text-xs">
                  {rule.field} {rule.operator} "{rule.pattern}"
                </span>
              </span>
              <span className="font-semibold text-xs">{rule.isActive ? "active" : "inactive"}</span>
            </span>
            <span className="grid grid-cols-3 gap-2 text-xs">
              <Fact label="matches" value={rule.matchCount} />
              <Fact label="change" value={rule.wouldChangeCount} />
              <Fact label="manual" value={rule.manualOverridesSkippedCount} />
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}

function RuleEditorPanel({
  categories,
  className,
  disabled,
  fields,
  mode,
  onApply,
  onChange,
  onPreview,
  onSave,
  onToggle,
  operators,
  preview,
  rule,
  selectedRule,
}: {
  categories: RulesResponse["categories"];
  className: string;
  disabled: boolean;
  fields: RulesResponse["fields"];
  mode: EditorMode;
  onApply: (() => void) | undefined;
  onChange: (rule: RuleEditorRequest) => void;
  onPreview: () => void;
  onSave: () => void;
  onToggle: (() => void) | undefined;
  operators: RulesResponse["operators"];
  preview: RulePreviewResponse | null;
  rule: RuleEditorRequest;
  selectedRule: RuleItem | null;
}) {
  return (
    <article className={`${className} min-w-0 rounded-md border border-treasuri-line bg-white p-3`}>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div>
          <p className="font-semibold text-sm">
            {mode.kind === "new" ? "Create rule" : "Edit rule"}
          </p>
          <p className="mt-1 text-treasuri-muted text-xs">
            Preview before saving or applying changes to history.
          </p>
        </div>
        {selectedRule ? (
          <dl className="grid grid-cols-3 gap-2 text-center text-xs sm:min-w-56">
            <Fact label="matches" value={selectedRule.matchCount} />
            <Fact label="change" value={selectedRule.wouldChangeCount} />
            <Fact label="manual" value={selectedRule.manualOverridesSkippedCount} />
          </dl>
        ) : null}
      </div>

      <RuleForm
        categories={categories}
        fields={fields}
        onChange={onChange}
        onPreview={onPreview}
        onSave={onSave}
        operators={operators}
        preview={preview}
        rule={rule}
      />

      {preview ? <RulePreviewPanel preview={preview} /> : null}

      {selectedRule ? (
        <div className="mt-3 grid grid-cols-2 gap-2 border-t border-treasuri-line pt-3 sm:flex sm:flex-wrap">
          <button
            className="inline-flex min-h-8 items-center justify-center gap-2 rounded-md border border-treasuri-line px-2 font-medium text-xs disabled:opacity-60 sm:text-sm"
            disabled={disabled || !selectedRule.isActive || selectedRule.wouldChangeCount === 0}
            onClick={onApply}
            type="button"
          >
            <Play aria-hidden="true" className="size-4" />
            Apply history
          </button>
          <button
            className="inline-flex min-h-8 items-center justify-center gap-2 rounded-md border border-treasuri-line px-2 font-medium text-xs disabled:opacity-60 sm:text-sm"
            disabled={disabled}
            onClick={onToggle}
            type="button"
          >
            {selectedRule.isActive ? (
              <ToggleRight aria-hidden="true" className="size-4" />
            ) : (
              <ToggleLeft aria-hidden="true" className="size-4" />
            )}
            {selectedRule.isActive ? "Disable" : "Enable"}
          </button>
        </div>
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
  onPreview: () => void;
  onSave: () => void;
  operators: RulesResponse["operators"];
  preview: RulePreviewResponse | null;
  rule: RuleEditorRequest;
}) {
  const patch = (next: Partial<RuleEditorRequest>) => onChange({ ...rule, ...next });
  const patchFlags = (next: Partial<RuleEditorRequest["flags"]>) =>
    patch({ flags: { ...rule.flags, ...next } });

  return (
    <form
      className="mt-3 grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <div className="grid gap-2 md:grid-cols-[minmax(160px,1fr)_6rem]">
        <label className="grid min-w-0 gap-1 text-xs">
          <span className="font-medium text-treasuri-muted">Name</span>
          <input
            aria-label="Rule name"
            className="min-h-9 w-full min-w-0 rounded-md border border-treasuri-line px-2 text-sm"
            onChange={(event) => patch({ name: event.target.value })}
            placeholder="Rule name"
            value={rule.name}
          />
        </label>
        <label className="grid min-w-0 gap-1 text-xs">
          <span className="font-medium text-treasuri-muted">Priority</span>
          <input
            aria-label="Priority"
            className="min-h-9 w-full min-w-0 rounded-md border border-treasuri-line px-2 text-sm"
            min="0"
            onChange={(event) => patch({ priority: Number(event.target.value) })}
            type="number"
            value={rule.priority}
          />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-[minmax(8rem,0.7fr)_minmax(8rem,0.7fr)_minmax(10rem,0.9fr)_minmax(12rem,1.2fr)]">
        <label className="grid min-w-0 gap-1 text-xs">
          <span className="font-medium text-treasuri-muted">Field</span>
          <select
            aria-label="Rule field"
            className="min-h-9 w-full min-w-0 rounded-md border border-treasuri-line px-2 text-sm"
            onChange={(event) => patch({ field: event.target.value as RuleEditorRequest["field"] })}
            value={rule.field}
          >
            {fields.map((field) => (
              <option key={field} value={field}>
                {field}
              </option>
            ))}
          </select>
        </label>
        <label className="grid min-w-0 gap-1 text-xs">
          <span className="font-medium text-treasuri-muted">Operator</span>
          <select
            aria-label="Rule operator"
            className="min-h-9 w-full min-w-0 rounded-md border border-treasuri-line px-2 text-sm"
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
        </label>
        <label className="grid min-w-0 gap-1 text-xs">
          <span className="font-medium text-treasuri-muted">Category</span>
          <select
            aria-label="Rule category"
            className="min-h-9 w-full min-w-0 rounded-md border border-treasuri-line px-2 text-sm"
            onChange={(event) => patch({ categoryId: Number(event.target.value) })}
            value={rule.categoryId}
          >
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <label className="col-span-2 grid min-w-0 gap-1 text-xs lg:col-span-1">
          <span className="font-medium text-treasuri-muted">Pattern</span>
          <input
            aria-label="Rule pattern"
            className="min-h-9 w-full min-w-0 rounded-md border border-treasuri-line px-2 text-sm"
            onChange={(event) => patch({ pattern: event.target.value })}
            placeholder="Pattern"
            value={rule.pattern}
          />
        </label>
      </div>
      <label className="grid min-w-0 gap-1 text-xs">
        <span className="font-medium text-treasuri-muted">Merchant</span>
        <input
          aria-label="Rule merchant"
          className="min-h-9 w-full min-w-0 rounded-md border border-treasuri-line px-2 text-sm"
          onChange={(event) => patch({ merchantName: event.target.value || undefined })}
          placeholder="Merchant"
          value={rule.merchantName ?? ""}
        />
      </label>
      <fieldset className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <legend className="sr-only">Set flags</legend>
        <Flag
          checked={rule.flags.setIsIncome}
          label="Income"
          onChange={(value) => patchFlags({ setIsIncome: value })}
        />
        <Flag
          checked={rule.flags.setIsTransfer}
          label="Transfer"
          onChange={(value) => patchFlags({ setIsTransfer: value })}
        />
        <Flag
          checked={rule.flags.setIsSavings}
          label="Savings"
          onChange={(value) => patchFlags({ setIsSavings: value })}
        />
        <Flag
          checked={rule.flags.setIsFixedCost}
          label="Fixed"
          onChange={(value) => patchFlags({ setIsFixedCost: value })}
        />
        <Flag
          checked={rule.flags.setIsExcludedFromBudget}
          label="Exclude"
          onChange={(value) => patchFlags({ setIsExcludedFromBudget: value })}
        />
      </fieldset>
      <div className="grid grid-cols-2 items-center gap-2 border-t border-treasuri-line pt-3 sm:flex sm:flex-wrap">
        <button
          className="min-h-8 rounded-md border border-treasuri-line px-2 font-medium text-xs sm:text-sm"
          onClick={onPreview}
          type="button"
        >
          Preview
        </button>
        <button
          className="inline-flex min-h-8 items-center justify-center gap-2 rounded-md bg-treasuri-action px-3 font-semibold text-xs text-white sm:text-sm"
          type="submit"
        >
          <Save aria-hidden="true" className="size-4" />
          Save rule
        </button>
        {preview ? (
          <span className="col-span-2 text-treasuri-muted text-xs">
            {preview.matchCount} matches, {preview.wouldChangeCount} changes,{" "}
            {preview.skippedManualCount} manual skipped
          </span>
        ) : null}
      </div>
    </form>
  );
}

function RulePreviewPanel({ preview }: { preview: RulePreviewResponse }) {
  return (
    <section className="mt-3 rounded-md border border-treasuri-line bg-treasuri-panel p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-sm">Preview matches</p>
          <p className="mt-1 text-treasuri-muted text-xs">
            {preview.matchCount} matched, {preview.wouldChangeCount} would change,{" "}
            {preview.alreadyCorrectCount} already correct, {preview.skippedManualCount} manual
            skipped
          </p>
        </div>
      </div>
      {preview.matches.length > 0 ? (
        <div className="mt-3 divide-y divide-treasuri-line rounded-md border border-treasuri-line bg-white">
          {preview.matches.slice(0, 6).map((match) => (
            <div
              className="grid gap-2 px-2 py-2 text-xs sm:grid-cols-[5.5rem_minmax(0,1fr)_7rem_6rem]"
              key={match.id}
            >
              <span className="font-medium text-treasuri-muted">{match.bookingDate}</span>
              <span className="min-w-0">
                <span className="block truncate font-semibold text-sm">{match.merchant}</span>
                <span className="block truncate text-treasuri-muted">{match.description}</span>
              </span>
              <span>{match.categoryName ?? "Uncategorized"}</span>
              <span className="font-semibold sm:text-right">EUR {match.amount}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 rounded-md border border-treasuri-line bg-white p-2 text-treasuri-muted text-xs">
          No eligible transactions would change. Manual overrides and already-correct rows are
          intentionally left alone.
        </p>
      )}
    </section>
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

function Fact({ label, value }: { label: string; value: number }) {
  return (
    <span>
      <span className="block text-treasuri-muted">{label}</span>
      <span className="font-semibold">{value}</span>
    </span>
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

function ruleToRequest(rule: RuleItem, fallbackCategoryId: number): RuleEditorRequest {
  return {
    categoryId: rule.categoryId ?? fallbackCategoryId,
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
