import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ListPlus, Save, Search } from "lucide-react";
import { useState } from "react";

import type { RuleEditorRequest } from "../../shared/management.ts";
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
      queryClient.invalidateQueries({ queryKey: ["review-inbox"] });
    },
  });
  const accept = useMutation({
    mutationFn: (id: number) => applyReviewAction(id, { action: "accept" }),
    onSuccess: (result) => {
      setMessage(`Accepted. ${result.reviewCount} left`);
      queryClient.invalidateQueries({ queryKey: ["review-inbox"] });
    },
  });

  if (inbox.isLoading) {
    return <p className="text-treasuri-muted">Loading review inbox...</p>;
  }
  if (inbox.isError || !inbox.data) {
    return <p className="text-red-700">Review inbox is unavailable.</p>;
  }

  const data = inbox.data;

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
      {ruleDraft ? <RuleDraftPanel draft={ruleDraft} onDone={() => setRuleDraft(null)} /> : null}

      {data.transactions.length === 0 ? (
        <div className="rounded-md border border-treasuri-line bg-white p-3">
          <p className="font-medium">Review inbox is clear.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {data.transactions.map((transaction) => (
            <ReviewCard
              categories={data.categories}
              disabled={action.isPending || accept.isPending}
              key={transaction.id}
              onAccept={() => accept.mutate(transaction.id)}
              onSave={(draft, next, applySimilar) =>
                action.mutate({ applySimilar, draft, id: transaction.id, next })
              }
              transaction={transaction}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ReviewCard({
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
    <article className="rounded-md border border-treasuri-line bg-white p-2 sm:p-3">
      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
        <div>
          <div className="flex flex-wrap gap-2 text-treasuri-muted text-xs">
            <span>{transaction.bookingDate}</span>
            <span>{transaction.categoryName ?? "Uncategorized"}</span>
            <span>{transaction.classificationMethod ?? "none"}</span>
            {transaction.similarCount > 0 ? <span>{transaction.similarCount} similar</span> : null}
          </div>
          <h2 className="mt-1 font-semibold text-sm sm:text-base">{transaction.merchantName}</h2>
          <p className="mt-1 text-treasuri-muted text-xs sm:text-sm">{transaction.description}</p>
        </div>
        <p className="font-semibold text-sm">
          {transaction.currency} {transaction.amount}
        </p>
      </div>

      <div className="mt-3 grid gap-2 lg:grid-cols-[minmax(9rem,0.8fr)_minmax(11rem,1fr)_auto]">
        <select
          aria-label={`Category for ${transaction.description}`}
          className="min-h-8 rounded-md border border-treasuri-line bg-white px-2 text-sm"
          onChange={(event) => setDraft({ ...draft, categoryId: Number(event.target.value) })}
          value={draft.categoryId}
        >
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        <input
          aria-label={`Merchant for ${transaction.description}`}
          className="min-h-8 rounded-md border border-treasuri-line px-2 text-sm"
          onChange={(event) => setDraft({ ...draft, merchantName: event.target.value })}
          value={draft.merchantName}
        />
        <label className="flex min-h-8 items-center gap-2 text-xs">
          <input
            checked={draft.createAlias}
            onChange={(event) => setDraft({ ...draft, createAlias: event.target.checked })}
            type="checkbox"
          />
          Remember merchant
        </label>
      </div>

      <fieldset className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        <legend className="sr-only">Review flags</legend>
        <Flag
          checked={draft.flags.isTransfer}
          label="Transfer"
          onChange={(checked) => patchFlags({ isTransfer: checked })}
        />
        <Flag
          checked={draft.flags.isSavings}
          label="Savings"
          onChange={(checked) => patchFlags({ isSavings: checked })}
        />
        <Flag
          checked={draft.flags.isOneOff}
          label="One-off"
          onChange={(checked) => patchFlags({ isOneOff: checked })}
        />
        <Flag
          checked={draft.flags.isExcludedFromBudget}
          label="Exclude"
          onChange={(checked) => patchFlags({ isExcludedFromBudget: checked })}
        />
      </fieldset>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          className="inline-flex min-h-8 items-center gap-2 rounded-md border border-treasuri-line px-2 font-medium text-xs sm:text-sm"
          disabled={disabled}
          onClick={onAccept}
          type="button"
        >
          <Check aria-hidden="true" className="size-4" />
          Accept
        </button>
        <button
          className="inline-flex min-h-8 items-center gap-2 rounded-md bg-treasuri-action px-3 font-semibold text-xs text-white disabled:opacity-60 sm:text-sm"
          disabled={disabled || draft.categoryId === 0}
          onClick={() => onSave(draft, "stay", false)}
          type="button"
        >
          <Save aria-hidden="true" className="size-4" />
          Save
        </button>
        <button
          className="inline-flex min-h-8 items-center gap-2 rounded-md border border-treasuri-line px-2 font-medium text-xs disabled:opacity-60 sm:text-sm"
          disabled={disabled || draft.categoryId === 0}
          onClick={() => onSave(draft, "stay", true)}
          type="button"
        >
          <ListPlus aria-hidden="true" className="size-4" />
          Apply similar
        </button>
        <button
          className="inline-flex min-h-8 items-center gap-2 rounded-md border border-treasuri-line px-2 font-medium text-xs disabled:opacity-60 sm:text-sm"
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

function RuleDraftPanel({ draft, onDone }: { draft: RuleEditorRequest; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState<string | null>(null);
  const previewMutation = useMutation({
    mutationFn: () => previewRule(draft),
    onSuccess: (result) =>
      setPreview(
        `${result.matchCount} matches, ${result.wouldChangeCount} changes, ${result.skippedManualCount} manual skipped`,
      ),
  });
  const create = useMutation({
    mutationFn: () => createRule(draft),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rules"] });
      setPreview("Rule created.");
      onDone();
    },
  });

  return (
    <aside className="mb-3 rounded-md border border-treasuri-line bg-white p-2 sm:p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-semibold text-sm">Rule preview</p>
          <p className="mt-1 text-treasuri-muted text-xs">
            {draft.field} {draft.operator} "{draft.pattern}" to category {draft.categoryId}
            {draft.merchantName ? ` / ${draft.merchantName}` : ""}
          </p>
          {preview ? <p className="mt-1 text-treasuri-muted text-xs">{preview}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="min-h-8 rounded-md border border-treasuri-line px-2 font-medium text-xs"
            onClick={() => previewMutation.mutate()}
            type="button"
          >
            Preview
          </button>
          <button
            className="min-h-8 rounded-md bg-treasuri-action px-3 font-semibold text-white text-xs"
            onClick={() => create.mutate()}
            type="button"
          >
            Create rule
          </button>
        </div>
      </div>
    </aside>
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
