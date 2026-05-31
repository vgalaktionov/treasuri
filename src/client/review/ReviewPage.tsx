import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ListPlus, Save, Search } from "lucide-react";
import { useEffect, useState } from "react";

import type { RuleEditorRequest, RulePreviewResponse } from "../../shared/management.ts";
import type { ReviewInboxResponse } from "../../shared/review.ts";
import { applyReviewAction, createRule, fetchReviewInbox, previewRule } from "../lib/api.ts";

type ReviewTransaction = ReviewInboxResponse["transactions"][number];

type ReviewDraft = {
  categoryId: number;
  createAlias: boolean;
  flags: {
    isExcludedFromBudget: boolean;
    isOneOff: boolean;
    isSavings: boolean;
    isTransfer: boolean;
  };
  merchantName: string;
};

export function ReviewPage() {
  const queryClient = useQueryClient();
  const inbox = useQuery({ queryFn: fetchReviewInbox, queryKey: ["review-inbox"] });
  const [activeId, setActiveId] = useState<number | null>(null);
  const [ruleDraft, setRuleDraft] = useState<RuleEditorRequest | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const action = useMutation({
    mutationFn: ({
      applySimilar = false,
      draft,
      id,
      next = "stay",
    }: {
      applySimilar?: boolean;
      draft: ReviewDraft;
      id: number;
      next?: "rule-preview" | "stay";
    }) =>
      applyReviewAction(id, {
        action: "change",
        applySimilar,
        categoryId: draft.categoryId,
        createAlias: draft.createAlias,
        flags: draft.flags,
        merchantName: draft.merchantName,
        next,
      }),
    onSuccess: (result) => {
      setMessage(`${result.correctedCount} corrected, ${result.reviewCount} left`);
      setRuleDraft(result.ruleDraft);
      setActiveId(nextReviewId(inbox.data?.transactions ?? [], result.transactionId));
      invalidateFinanceWorkspaces(queryClient);
    },
  });
  const accept = useMutation({
    mutationFn: (id: number) => applyReviewAction(id, { action: "accept" }),
    onSuccess: (result) => {
      setMessage(`Accepted. ${result.reviewCount} left`);
      setActiveId(nextReviewId(inbox.data?.transactions ?? [], result.transactionId));
      invalidateFinanceWorkspaces(queryClient);
    },
  });
  const transactions = inbox.data?.transactions ?? [];

  useEffect(() => {
    if (transactions.length === 0) {
      setActiveId(null);
      return;
    }
    if (!activeId || !transactions.some((transaction) => transaction.id === activeId)) {
      setActiveId(transactions[0]?.id ?? null);
    }
  }, [activeId, transactions]);

  if (inbox.isLoading) {
    return <p className="text-treasuri-muted">Loading review inbox...</p>;
  }
  if (inbox.isError || !inbox.data) {
    return <p className="text-red-700">Review inbox is unavailable.</p>;
  }

  const data = inbox.data;
  const activeTransaction =
    data.transactions.find((transaction) => transaction.id === activeId) ?? data.transactions[0];

  return (
    <section aria-labelledby="review-heading">
      <header className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-medium text-treasuri-muted text-xs sm:text-sm">
            Transactions that can change the forecast
          </p>
          <h1 className="mt-1 font-semibold text-lg sm:text-xl" id="review-heading">
            Review inbox
          </h1>
        </div>
        <p aria-live="polite" className="font-semibold text-treasuri-action text-sm">
          {data.reviewCount} to review
        </p>
      </header>

      {message ? (
        <p className="mb-3 rounded-md border border-treasuri-line bg-white p-2 text-sm">
          {message}
        </p>
      ) : null}
      {ruleDraft ? (
        <RuleDraftPanel
          categories={data.categories}
          draft={ruleDraft}
          key={`${ruleDraft.field}-${ruleDraft.pattern}-${ruleDraft.categoryId}`}
          onDismiss={() => setRuleDraft(null)}
        />
      ) : null}

      {data.transactions.length === 0 || !activeTransaction ? (
        <div className="rounded-md border border-treasuri-line bg-white p-3">
          <p className="font-medium">Review inbox is clear.</p>
        </div>
      ) : (
        <div className="grid gap-3 xl:grid-cols-[minmax(16rem,0.65fr)_minmax(0,1fr)]">
          <ReviewQueue
            activeId={activeTransaction.id}
            onSelect={setActiveId}
            transactions={data.transactions}
          />
          <ActiveReviewPanel
            categories={data.categories}
            disabled={action.isPending || accept.isPending}
            key={activeTransaction.id}
            onAccept={() => accept.mutate(activeTransaction.id)}
            onSave={(draft, next, applySimilar) =>
              action.mutate({ applySimilar, draft, id: activeTransaction.id, next })
            }
            transaction={activeTransaction}
          />
        </div>
      )}
    </section>
  );
}

function invalidateFinanceWorkspaces(queryClient: ReturnType<typeof useQueryClient>) {
  for (const queryKey of [
    ["category-budgets"],
    ["dashboard"],
    ["recurring"],
    ["review-inbox"],
    ["rules"],
    ["transactions"],
  ]) {
    queryClient.invalidateQueries({ queryKey });
  }
}

function ReviewQueue({
  activeId,
  onSelect,
  transactions,
}: {
  activeId: number;
  onSelect: (id: number) => void;
  transactions: ReviewTransaction[];
}) {
  return (
    <aside className="rounded-md border border-treasuri-line bg-white p-2">
      <div className="flex items-center justify-between gap-3">
        <p className="font-semibold text-sm">Queue</p>
        <p className="text-treasuri-muted text-xs">{transactions.length} open</p>
      </div>
      <div className="mt-2 grid gap-1">
        {transactions.map((transaction, index) => (
          <button
            aria-current={transaction.id === activeId ? "true" : undefined}
            className={`grid w-full grid-cols-[2rem_minmax(0,1fr)_auto] items-start gap-2 rounded-md border px-2 py-2 text-left ${
              transaction.id === activeId
                ? "border-treasuri-action bg-teal-50"
                : "border-transparent hover:bg-treasuri-panel"
            }`}
            key={transaction.id}
            onClick={() => onSelect(transaction.id)}
            type="button"
          >
            <span className="font-semibold text-treasuri-muted text-xs">#{index + 1}</span>
            <span className="min-w-0">
              <span className="block truncate font-semibold text-sm">
                {transaction.merchantName}
              </span>
              <span className="block truncate text-treasuri-muted text-xs">
                {transaction.description}
              </span>
              <span className="mt-1 flex flex-wrap gap-1 text-treasuri-muted text-[0.68rem]">
                <span>{transaction.categoryName ?? "Uncategorized"}</span>
                {transaction.similarCount > 0 ? (
                  <span>{transaction.similarCount} similar</span>
                ) : null}
              </span>
            </span>
            <span className="font-semibold text-xs">
              {transaction.currency} {transaction.amount}
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}

function ActiveReviewPanel({
  categories,
  disabled,
  onAccept,
  onSave,
  transaction,
}: {
  categories: ReviewInboxResponse["categories"];
  disabled: boolean;
  onAccept: () => void;
  onSave: (draft: ReviewDraft, next: "rule-preview" | "stay", applySimilar: boolean) => void;
  transaction: ReviewTransaction;
}) {
  const [draft, setDraft] = useState<ReviewDraft>(() => ({
    categoryId: transaction.categoryId ?? categories[0]?.id ?? 0,
    createAlias: true,
    flags: {
      isExcludedFromBudget: transaction.flags.includes("excluded"),
      isOneOff: transaction.flags.includes("one-off"),
      isSavings: transaction.flags.includes("savings"),
      isTransfer: transaction.flags.includes("transfer"),
    },
    merchantName: transaction.merchantName,
  }));
  const patchFlags = (next: Partial<ReviewDraft["flags"]>) =>
    setDraft((current) => ({ ...current, flags: { ...current.flags, ...next } }));

  return (
    <article className="rounded-md border border-treasuri-line bg-white p-3">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <div className="flex flex-wrap gap-2 text-treasuri-muted text-xs">
            <span>{transaction.bookingDate}</span>
            <span>{transaction.categoryName ?? "Uncategorized"}</span>
            <span>{transaction.classificationMethod ?? "none"}</span>
            {transaction.similarCount > 0 ? <span>{transaction.similarCount} similar</span> : null}
          </div>
          <h2 className="mt-1 font-semibold text-base">{transaction.merchantName}</h2>
          <p className="mt-1 text-treasuri-muted text-sm">{transaction.description}</p>
          {transaction.counterpartyName ? (
            <p className="mt-1 text-treasuri-muted text-xs">{transaction.counterpartyName}</p>
          ) : null}
        </div>
        <p className="font-semibold text-base">
          {transaction.currency} {transaction.amount}
        </p>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(10rem,0.8fr)_minmax(12rem,1fr)_auto]">
        <label className="grid gap-1 text-xs">
          <span className="font-medium text-treasuri-muted">Category</span>
          <select
            aria-label={`Category for ${transaction.description}`}
            className="min-h-9 rounded-md border border-treasuri-line bg-white px-2 text-sm"
            name="categoryId"
            onChange={(event) => setDraft({ ...draft, categoryId: Number(event.target.value) })}
            value={draft.categoryId}
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
            name="merchantName"
            onChange={(event) => setDraft({ ...draft, merchantName: event.target.value })}
            value={draft.merchantName}
          />
        </label>
        <label className="flex min-h-9 items-end gap-2 pb-2 text-xs">
          <input
            checked={draft.createAlias}
            name="createAlias"
            onChange={(event) => setDraft({ ...draft, createAlias: event.target.checked })}
            type="checkbox"
          />
          Remember merchant
        </label>
      </div>

      <fieldset className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <legend className="sr-only">Review flags</legend>
        <Flag
          checked={draft.flags.isTransfer}
          label="Transfer"
          name="isTransfer"
          onChange={(checked) => patchFlags({ isTransfer: checked })}
        />
        <Flag
          checked={draft.flags.isSavings}
          label="Savings"
          name="isSavings"
          onChange={(checked) => patchFlags({ isSavings: checked })}
        />
        <Flag
          checked={draft.flags.isOneOff}
          label="One-off"
          name="isOneOff"
          onChange={(checked) => patchFlags({ isOneOff: checked })}
        />
        <Flag
          checked={draft.flags.isExcludedFromBudget}
          label="Exclude"
          name="isExcludedFromBudget"
          onChange={(checked) => patchFlags({ isExcludedFromBudget: checked })}
        />
      </fieldset>

      <div className="mt-4 grid grid-cols-2 gap-2 border-t border-treasuri-line pt-3 sm:flex sm:flex-wrap">
        <button
          className="inline-flex min-h-8 items-center justify-center gap-2 rounded-md border border-treasuri-line px-2 font-medium text-xs sm:text-sm"
          disabled={disabled}
          onClick={onAccept}
          type="button"
        >
          <Check aria-hidden="true" className="size-4" />
          Accept
        </button>
        <button
          className="inline-flex min-h-8 items-center justify-center gap-2 rounded-md bg-treasuri-action px-3 font-semibold text-xs text-white disabled:opacity-60 sm:text-sm"
          disabled={disabled || draft.categoryId === 0}
          onClick={() => onSave(draft, "stay", false)}
          type="button"
        >
          <Save aria-hidden="true" className="size-4" />
          Save
        </button>
        <button
          className="inline-flex min-h-8 items-center justify-center gap-2 rounded-md border border-treasuri-line px-2 font-medium text-xs disabled:opacity-60 sm:text-sm"
          disabled={disabled || draft.categoryId === 0}
          onClick={() => onSave(draft, "stay", true)}
          type="button"
        >
          <ListPlus aria-hidden="true" className="size-4" />
          Apply similar
        </button>
        <button
          className="inline-flex min-h-8 items-center justify-center gap-2 rounded-md border border-treasuri-line px-2 font-medium text-xs disabled:opacity-60 sm:text-sm"
          disabled={disabled || draft.categoryId === 0}
          onClick={() => onSave(draft, "rule-preview", false)}
          type="button"
        >
          <Search aria-hidden="true" className="size-4" />
          Preview rule
        </button>
      </div>
    </article>
  );
}

function nextReviewId(transactions: ReviewTransaction[], transactionId: number): number | null {
  const index = transactions.findIndex((transaction) => transaction.id === transactionId);
  if (index < 0) {
    return transactions[0]?.id ?? null;
  }
  return transactions[index + 1]?.id ?? transactions[index - 1]?.id ?? null;
}

function RuleDraftPanel({
  categories,
  draft,
  onDismiss,
}: {
  categories: ReviewInboxResponse["categories"];
  draft: RuleEditorRequest;
  onDismiss: () => void;
}) {
  const queryClient = useQueryClient();
  const [createdRuleId, setCreatedRuleId] = useState<number | null>(null);
  const previewMutation = useMutation({
    mutationFn: () => previewRule(draft),
  });
  const create = useMutation({
    mutationFn: () => createRule(draft),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["rules"] });
      setCreatedRuleId(result.ruleId);
    },
  });
  const category = categories.find((item) => item.id === draft.categoryId);

  useEffect(() => {
    previewMutation.mutate();
  }, [previewMutation.mutate]);

  return (
    <aside className="mb-3 rounded-md border border-treasuri-line bg-white p-2 sm:p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-semibold text-sm">Rule preview</p>
          <p className="mt-1 text-treasuri-muted text-xs">
            {draft.field} {draft.operator} "{draft.pattern}" to {category?.name ?? "category"}
            {draft.merchantName ? ` / ${draft.merchantName}` : ""}
          </p>
          {createdRuleId ? (
            <p className="mt-1 font-semibold text-emerald-700 text-xs">
              Rule {createdRuleId} created.
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="min-h-8 rounded-md border border-treasuri-line px-2 font-medium text-xs"
            onClick={onDismiss}
            type="button"
          >
            Dismiss
          </button>
          <button
            className="min-h-8 rounded-md bg-treasuri-action px-3 font-semibold text-white text-xs disabled:opacity-60"
            disabled={create.isPending || createdRuleId !== null}
            onClick={() => create.mutate()}
            type="button"
          >
            Create rule
          </button>
        </div>
      </div>
      {previewMutation.data ? (
        <>
          <dl className="mt-3 grid grid-cols-4 gap-2 border-t border-treasuri-line pt-3 text-xs">
            <RulePreviewFact label="matches" value={previewMutation.data.matchCount} />
            <RulePreviewFact label="changes" value={previewMutation.data.wouldChangeCount} />
            <RulePreviewFact label="correct" value={previewMutation.data.alreadyCorrectCount} />
            <RulePreviewFact label="manual" value={previewMutation.data.skippedManualCount} />
          </dl>
          <PreviewMatches matches={previewMutation.data.matches} />
        </>
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

function PreviewMatches({ matches }: { matches: RulePreviewResponse["matches"] }) {
  if (matches.length === 0) {
    return (
      <p className="mt-3 rounded-md border border-treasuri-line bg-treasuri-panel p-2 text-treasuri-muted text-xs">
        No current transactions match this rule.
      </p>
    );
  }

  return (
    <section className="mt-3 border-t border-treasuri-line pt-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold text-sm">Preview matches</h3>
        <span className="text-treasuri-muted text-xs">{matches.length}</span>
      </div>
      <div className="mt-2 divide-y divide-treasuri-line overflow-hidden rounded-md border border-treasuri-line bg-white">
        {matches.slice(0, 5).map((match) => (
          <div
            className="grid gap-1 px-2 py-2 text-xs sm:grid-cols-[5.5rem_minmax(0,1fr)_7rem_6rem] sm:gap-2"
            key={match.id}
          >
            <time className="font-medium text-treasuri-muted" dateTime={match.bookingDate}>
              {match.bookingDate}
            </time>
            <p className="min-w-0">
              <span className="block truncate font-semibold text-sm">{match.merchant}</span>
              <span className="block truncate text-treasuri-muted">{match.description}</span>
            </p>
            <span className="truncate text-treasuri-muted">
              {match.categoryName ?? "Uncategorized"}
            </span>
            <span className="font-semibold sm:text-right">EUR {match.amount}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Flag({
  checked,
  label,
  name,
  onChange,
}: {
  checked: boolean;
  label: string;
  name: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-h-8 items-center gap-1 text-xs">
      <input
        checked={checked}
        name={name}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      {label}
    </label>
  );
}
