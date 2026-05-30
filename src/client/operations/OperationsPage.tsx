import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, RefreshCw, Save } from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";

import {
  createExport,
  fetchExports,
  fetchSettings,
  fetchStatus,
  saveSettings,
} from "../lib/api.ts";

export function OperationsPage({ section }: { section: "export" | "settings" | "status" }) {
  if (section === "settings") {
    return <SettingsPage />;
  }
  if (section === "status") {
    return <StatusPage />;
  }
  return <ExportPage />;
}

function ExportPage() {
  const queryClient = useQueryClient();
  const exports = useQuery({ queryFn: fetchExports, queryKey: ["exports"] });
  const create = useMutation({
    mutationFn: createExport,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["exports"] }),
  });
  const generatedFileId = create.data?.fileId ?? null;

  return (
    <section>
      <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-medium text-sm text-treasuri-muted">Files</p>
          <h1 className="mt-1 font-semibold text-3xl">Export</h1>
        </div>
        <button
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-treasuri-action px-4 font-semibold text-white disabled:opacity-60"
          disabled={create.isPending}
          onClick={() => create.mutate()}
          type="button"
        >
          <RefreshCw aria-hidden="true" className="size-4" />
          Generate
        </button>
      </header>

      {generatedFileId ? (
        <p className="mb-4 rounded-md border border-treasuri-line bg-white p-3 text-sm">
          Export {create.data?.exportRunId} generated.{" "}
          <a
            className="font-semibold text-treasuri-action"
            href={`/api/exports/${generatedFileId}/download`}
          >
            Download file
          </a>
        </p>
      ) : null}

      <div className="space-y-3">
        {exports.data?.exports.map((exportRun) => (
          <article
            className="rounded-md border border-treasuri-line bg-white p-4"
            key={exportRun.id}
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold">Export {exportRun.id}</p>
                <p className="text-sm text-treasuri-muted">
                  {exportRun.status} - {exportRun.createdAt}
                </p>
              </div>
              {exportRun.fileId ? (
                <a
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-treasuri-line px-3 font-semibold"
                  href={`/api/exports/${exportRun.fileId}/download`}
                >
                  <Download aria-hidden="true" className="size-4" />
                  Download
                </a>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function SettingsPage() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryFn: fetchSettings, queryKey: ["settings"] });
  const [form, setForm] = useState({
    baselineMonths: 6,
    safetyBuffer: "1000.00",
    targetMonthlySavings: "1000.00",
  });
  const save = useMutation({
    mutationFn: () => saveSettings(form),
    onSuccess: (saved) => {
      setForm(saved);
      queryClient.setQueryData(["settings"], saved);
    },
  });

  useEffect(() => {
    if (settings.data) {
      setForm(settings.data);
    }
  }, [settings.data]);

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <section>
      <header className="mb-5">
        <p className="font-medium text-sm text-treasuri-muted">Assumptions</p>
        <h1 className="mt-1 font-semibold text-3xl">Settings</h1>
      </header>
      <form
        className="grid gap-4 rounded-md border border-treasuri-line bg-white p-4"
        onSubmit={submit}
      >
        <label className="grid gap-2 font-medium text-sm">
          Target monthly savings
          <input
            className="min-h-11 rounded-md border border-treasuri-line px-3 font-normal"
            inputMode="decimal"
            onChange={(event) => setForm({ ...form, targetMonthlySavings: event.target.value })}
            value={form.targetMonthlySavings}
          />
        </label>
        <label className="grid gap-2 font-medium text-sm">
          Safety buffer
          <input
            className="min-h-11 rounded-md border border-treasuri-line px-3 font-normal"
            inputMode="decimal"
            onChange={(event) => setForm({ ...form, safetyBuffer: event.target.value })}
            value={form.safetyBuffer}
          />
        </label>
        <label className="grid gap-2 font-medium text-sm">
          Baseline months
          <input
            className="min-h-11 rounded-md border border-treasuri-line px-3 font-normal"
            min="1"
            onChange={(event) => setForm({ ...form, baselineMonths: Number(event.target.value) })}
            type="number"
            value={form.baselineMonths}
          />
        </label>
        <button
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-treasuri-action px-4 font-semibold text-white disabled:opacity-60 sm:w-fit"
          disabled={save.isPending}
          type="submit"
        >
          <Save aria-hidden="true" className="size-4" />
          Save
        </button>
        <p aria-live="polite" className="min-h-5 text-sm text-treasuri-muted">
          {save.isSuccess ? "Settings saved." : null}
        </p>
      </form>
    </section>
  );
}

function StatusPage() {
  const status = useQuery({ queryFn: fetchStatus, queryKey: ["status"], refetchInterval: 30_000 });

  return (
    <section>
      <header className="mb-5">
        <p className="font-medium text-sm text-treasuri-muted">Runtime</p>
        <h1 className="mt-1 font-semibold text-3xl">Status</h1>
      </header>
      <div className="grid gap-3 sm:grid-cols-3">
        <StatusTile label="Database" value={status.data?.database ?? "loading"} />
        <StatusTile label="Latest sync" value={status.data?.latestSync?.status ?? "none"} />
        <StatusTile label="Secrets" value={status.data?.secrets ?? "redacted"} />
      </div>
      <section className="mt-5">
        <h2 className="font-semibold text-xl">Failed jobs</h2>
        <div className="mt-3 space-y-2">
          {status.data?.failedJobs.length ? (
            status.data.failedJobs.map((job) => (
              <article
                className="rounded-md border border-treasuri-line bg-white p-3"
                key={`${job.name}-${job.startedAt}`}
              >
                <p className="font-semibold">{job.name}</p>
                <p className="text-sm text-treasuri-muted">{job.startedAt}</p>
                <p className="mt-1 text-sm">{job.error ?? "No error payload"}</p>
              </article>
            ))
          ) : (
            <p className="rounded-md border border-treasuri-line bg-white p-3 text-sm text-treasuri-muted">
              No failed jobs.
            </p>
          )}
        </div>
      </section>
    </section>
  );
}

function StatusTile({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-md border border-treasuri-line bg-white p-4">
      <p className="text-sm text-treasuri-muted">{label}</p>
      <p className="mt-1 font-semibold text-xl">{value}</p>
    </article>
  );
}
