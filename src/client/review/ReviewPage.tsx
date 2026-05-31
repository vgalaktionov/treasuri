import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, EyeOff, Pencil } from "lucide-react";
import { useState } from "react";
import type { ReviewInboxResponse } from "../../shared/review.ts";
import { applyReviewAction, fetchReviewInbox } from "../lib/api.ts";

export function ReviewPage() {
  const queryClient = useQueryClient();
  const inbox = useQuery({ queryFn: fetchReviewInbox, queryKey: ["review-inbox"] });
  const action = useMutation({
    mutationFn: ({
      action,
      categoryId,
      id,
    }: {
      action: "accept" | "change" | "exclude";
      categoryId?: number;
      id: number;
    }) =>
      action === "change"
        ? applyReviewAction(id, { action, categoryId: categoryId ?? 0 })
        : applyReviewAction(id, { action }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["review-inbox"] }),
  });

  if (inbox.isLoading) {
    return <p className="text-treasuri-muted">Loading review inbox...</p>;
  }
  if (inbox.isError) {
    return <p className="text-red-700">Review inbox is unavailable.</p>;
  }
  if (!inbox.data) {
    return null;
  }

  const data = inbox.data;

  return (
    <section aria-labelledby="review-heading">
      <header className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-medium text-sm text-treasuri-muted">Transactions needing attention</p>
          <h1 className="mt-1 font-semibold text-xl" id="review-heading">
            Review inbox
          </h1>
        </div>
        <p aria-live="polite" className="font-semibold text-treasuri-action">
          {data.reviewCount} to review
        </p>
      </header>

      {data.transactions.length === 0 ? (
        <div className="rounded-md border border-treasuri-line bg-white p-3">
          <p className="font-medium">Review inbox is clear.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {data.transactions.map((transaction) => (
            <article
              className="rounded-md border border-treasuri-line bg-white p-3"
              key={transaction.id}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="font-semibold">
                    {transaction.counterpartyName ?? "Unknown merchant"}
                  </p>
                  <p className="mt-1 text-sm text-treasuri-muted">{transaction.description}</p>
                  <p className="mt-2 text-sm">
                    {transaction.bookingDate} - {transaction.categoryName ?? "Uncategorized"}
                  </p>
                </div>
                <p className="font-semibold">
                  {transaction.currency} {transaction.amount}
                </p>
              </div>
              <ReviewActions
                categories={data.categories}
                disabled={action.isPending}
                onAction={(nextAction, categoryId) => {
                  const mutation = { action: nextAction, id: transaction.id };
                  action.mutate(categoryId === undefined ? mutation : { ...mutation, categoryId });
                }}
                selectedCategoryId={transaction.categoryId}
              />
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function ReviewActions({
  categories,
  disabled,
  onAction,
  selectedCategoryId,
}: {
  categories: ReviewInboxResponse["categories"];
  disabled: boolean;
  onAction: (action: "accept" | "change" | "exclude", categoryId?: number) => void;
  selectedCategoryId: number | null;
}) {
  const [categoryId, setCategoryId] = useState(selectedCategoryId ?? categories[0]?.id ?? 0);

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <button
        className="inline-flex min-h-9 items-center gap-2 rounded-md bg-treasuri-action px-3 font-semibold text-sm text-white disabled:opacity-60"
        disabled={disabled}
        onClick={() => onAction("accept")}
        type="button"
      >
        <Check aria-hidden="true" className="size-4" />
        Accept
      </button>
      <select
        aria-label="Review category"
        className="min-h-9 rounded-md border border-treasuri-line bg-white px-3 text-sm"
        onChange={(event) => setCategoryId(Number(event.target.value))}
        value={categoryId}
      >
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
      </select>
      <button
        className="inline-flex min-h-9 items-center gap-2 rounded-md border border-treasuri-line bg-white px-3 font-semibold text-sm disabled:opacity-60"
        disabled={disabled || categoryId === 0}
        onClick={() => onAction("change", categoryId)}
        type="button"
      >
        <Pencil aria-hidden="true" className="size-4" />
        Change
      </button>
      <button
        className="inline-flex min-h-9 items-center gap-2 rounded-md border border-treasuri-line bg-white px-3 font-semibold text-sm disabled:opacity-60"
        disabled={disabled}
        onClick={() => onAction("exclude")}
        type="button"
      >
        <EyeOff aria-hidden="true" className="size-4" />
        Exclude
      </button>
    </div>
  );
}
