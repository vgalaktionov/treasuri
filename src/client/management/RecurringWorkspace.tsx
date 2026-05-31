import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, EyeOff } from "lucide-react";

import type { RecurringResponse } from "../../shared/management.ts";
import { confirmRecurring, disableRecurring, fetchRecurring } from "../lib/api.ts";

export function RecurringWorkspace() {
  const queryClient = useQueryClient();
  const recurring = useQuery({ queryFn: fetchRecurring, queryKey: ["recurring"] });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["recurring"] });
  const confirm = useMutation({ mutationFn: confirmRecurring, onSuccess: invalidate });
  const disable = useMutation({ mutationFn: disableRecurring, onSuccess: invalidate });

  return (
    <section>
      <header className="mb-4">
        <p className="font-medium text-treasuri-muted text-xs sm:text-sm">
          Subscriptions and fixed commitments
        </p>
        <h1 className="mt-1 font-semibold text-lg sm:text-xl">Recurring</h1>
      </header>

      <div className="space-y-2">
        {recurring.data?.series.map((series) => (
          <RecurringCard
            disabled={confirm.isPending || disable.isPending}
            key={series.id}
            onConfirm={() => confirm.mutate(series.id)}
            onDisable={() => disable.mutate(series.id)}
            series={series}
          />
        ))}
        {recurring.data?.series.length === 0 ? (
          <div className="rounded-md border border-treasuri-line bg-white p-2 text-sm sm:p-3">
            No recurring payments detected.
          </div>
        ) : null}
      </div>
    </section>
  );
}

function RecurringCard({
  disabled,
  onConfirm,
  onDisable,
  series,
}: {
  disabled: boolean;
  onConfirm: () => void;
  onDisable: () => void;
  series: RecurringResponse["series"][number];
}) {
  return (
    <article className="rounded-md border border-treasuri-line bg-white p-2 sm:p-3">
      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
        <div>
          <div className="flex flex-wrap gap-2 text-treasuri-muted text-xs">
            <span>{series.categoryName ?? "Unknown"}</span>
            <span>{series.cadence}</span>
            <span>confidence {series.confidence ?? "0.00"}</span>
            <span>{series.isConfirmed ? "confirmed" : "detected"}</span>
            {series.warnings.map((warning) => (
              <span
                className="rounded border border-amber-300 px-1.5 py-0.5 text-amber-800"
                key={warning}
              >
                {warning}
              </span>
            ))}
          </div>
          <h2 className="mt-1 font-semibold text-sm sm:text-base">{series.name}</h2>
          <p className="mt-1 text-treasuri-muted text-xs sm:text-sm">
            Next expected {series.nextExpectedDate ?? "unknown"}
          </p>
        </div>
        <p className="font-semibold text-sm sm:text-base">EUR {series.amount ?? "0.00"}</p>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {!series.isConfirmed ? (
          <button
            className="inline-flex min-h-8 items-center gap-2 rounded-md bg-treasuri-action px-3 font-semibold text-xs text-white sm:text-sm"
            disabled={disabled}
            onClick={onConfirm}
            type="button"
          >
            <Check aria-hidden="true" className="size-4" />
            Confirm
          </button>
        ) : null}
        <button
          className="inline-flex min-h-8 items-center gap-2 rounded-md border border-treasuri-line px-2 font-medium text-xs sm:text-sm"
          disabled={disabled}
          onClick={onDisable}
          type="button"
        >
          <EyeOff aria-hidden="true" className="size-4" />
          Disable
        </button>
      </div>
    </article>
  );
}
