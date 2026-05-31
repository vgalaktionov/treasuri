import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, RefreshCw, Save } from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import { useEffect, useState } from "react";

import type { SettingsResponse, SettingsUpdate } from "../../shared/operations.ts";
import {
  createExport,
  fetchExports,
  fetchSettings,
  fetchStatus,
  saveSettings,
  syncNow,
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
      <header className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-medium text-sm text-treasuri-muted">Files</p>
          <h1 className="mt-1 font-semibold text-xl">Export</h1>
        </div>
        <button
          className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-treasuri-action px-3 font-semibold text-sm text-white disabled:opacity-60"
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

      <div className="space-y-2">
        {exports.data?.exports.map((exportRun) => (
          <article
            className="rounded-md border border-treasuri-line bg-white p-3"
            key={exportRun.id}
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold">Export {exportRun.id}</p>
                <p className="text-sm text-treasuri-muted">
                  {exportRun.filename ?? "No file"} - {exportRun.exportType} - {exportRun.status} -{" "}
                  {exportRun.createdAt}
                </p>
                {exportRun.sizeBytes ? (
                  <p className="text-xs text-treasuri-muted">{exportRun.sizeBytes} bytes</p>
                ) : null}
                {exportRun.errorMessage ? (
                  <p className="mt-1 text-sm text-red-700">{exportRun.errorMessage}</p>
                ) : null}
              </div>
              {exportRun.fileId ? (
                <a
                  className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-treasuri-line px-3 font-semibold text-sm"
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
  const [form, setForm] = useState<SettingsUpdate>({
    baselineMonths: 6,
    fixedCostsUpcoming: "0.00",
    llmConfidenceThreshold: "0.70",
    llmEnabled: false,
    safetyBuffer: "1000.00",
    salaryDay: 24,
    syncLookbackDays: 90,
    targetMonthlySavings: "1000.00",
    variableBaseline3m: "0.00",
    variableBaseline6m: "0.00",
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
      setForm(settingsUpdateFromResponse(settings.data));
    }
  }, [settings.data]);

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <section>
      <header className="mb-4">
        <p className="font-medium text-sm text-treasuri-muted">Assumptions</p>
        <h1 className="mt-1 font-semibold text-xl">Settings</h1>
      </header>
      <form
        className="grid gap-2 rounded-md border border-treasuri-line bg-white p-2 sm:grid-cols-3 sm:p-3"
        onSubmit={submit}
      >
        <label className="grid gap-1 font-medium text-sm">
          Target monthly savings
          <input
            className="min-h-8 rounded-md border border-treasuri-line px-2 font-normal text-sm"
            inputMode="decimal"
            onChange={(event) => setForm({ ...form, targetMonthlySavings: event.target.value })}
            value={form.targetMonthlySavings}
          />
        </label>
        <label className="grid gap-1 font-medium text-sm">
          Safety buffer
          <input
            className="min-h-8 rounded-md border border-treasuri-line px-2 font-normal text-sm"
            inputMode="decimal"
            onChange={(event) => setForm({ ...form, safetyBuffer: event.target.value })}
            value={form.safetyBuffer}
          />
        </label>
        <label className="grid gap-1 font-medium text-sm">
          Baseline months
          <input
            className="min-h-8 rounded-md border border-treasuri-line px-2 font-normal text-sm"
            min="1"
            onChange={(event) => setForm({ ...form, baselineMonths: Number(event.target.value) })}
            type="number"
            value={form.baselineMonths}
          />
        </label>
        <label className="grid gap-1 font-medium text-sm">
          Salary day
          <input
            className="min-h-8 rounded-md border border-treasuri-line px-2 font-normal text-sm"
            max="31"
            min="1"
            onChange={(event) => setForm({ ...form, salaryDay: Number(event.target.value) })}
            type="number"
            value={form.salaryDay}
          />
        </label>
        <label className="grid gap-1 font-medium text-sm">
          Sync lookback days
          <input
            className="min-h-8 rounded-md border border-treasuri-line px-2 font-normal text-sm"
            min="1"
            onChange={(event) => setForm({ ...form, syncLookbackDays: Number(event.target.value) })}
            type="number"
            value={form.syncLookbackDays}
          />
        </label>
        <MoneyInput
          label="Fixed costs upcoming"
          onChange={(fixedCostsUpcoming) => setForm({ ...form, fixedCostsUpcoming })}
          value={form.fixedCostsUpcoming}
        />
        <MoneyInput
          label="3M variable baseline"
          onChange={(variableBaseline3m) => setForm({ ...form, variableBaseline3m })}
          value={form.variableBaseline3m}
        />
        <MoneyInput
          label="6M variable baseline"
          onChange={(variableBaseline6m) => setForm({ ...form, variableBaseline6m })}
          value={form.variableBaseline6m}
        />
        <MoneyInput
          label="LLM confidence threshold"
          onChange={(llmConfidenceThreshold) => setForm({ ...form, llmConfidenceThreshold })}
          value={form.llmConfidenceThreshold}
        />
        <label className="flex min-h-8 items-center gap-2 font-medium text-sm">
          <input
            checked={form.llmEnabled}
            onChange={(event) => setForm({ ...form, llmEnabled: event.target.checked })}
            type="checkbox"
          />
          LLM fallback
        </label>
        <button
          className="inline-flex min-h-8 items-center justify-center gap-2 rounded-md bg-treasuri-action px-3 font-semibold text-sm text-white disabled:opacity-60 sm:w-fit"
          disabled={save.isPending}
          type="submit"
        >
          <Save aria-hidden="true" className="size-4" />
          Save
        </button>
        <p aria-live="polite" className="min-h-5 text-sm text-treasuri-muted sm:col-span-3">
          {save.isSuccess ? "Settings saved." : null}
        </p>
      </form>
      {settings.data ? <SettingsOverview data={settings.data.overview} /> : null}
    </section>
  );
}

function StatusPage() {
  const queryClient = useQueryClient();
  const status = useQuery({ queryFn: fetchStatus, queryKey: ["status"], refetchInterval: 30_000 });
  const sync = useMutation({
    mutationFn: syncNow,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["status"] });
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  return (
    <section>
      <header className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-medium text-sm text-treasuri-muted">Runtime</p>
          <h1 className="mt-1 font-semibold text-xl">Status</h1>
        </div>
        <button
          className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-treasuri-action px-3 font-semibold text-sm text-white disabled:opacity-60"
          disabled={sync.isPending}
          onClick={() => sync.mutate()}
          type="button"
        >
          <RefreshCw aria-hidden="true" className="size-4" />
          Sync now
        </button>
      </header>
      {sync.data ? (
        <p className="mb-3 rounded-md border border-treasuri-line bg-white p-3 text-sm">
          Synced {sync.data.provider}: {sync.data.newTransactionCount} new,{" "}
          {sync.data.updatedTransactionCount} updated.
        </p>
      ) : null}
      {sync.isError ? (
        <p className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-red-700 text-sm">
          Sync failed. Check status for the latest error.
        </p>
      ) : null}
      <div className="grid gap-2 lg:grid-cols-2">
        {status.data?.sections.map((section) => (
          <section
            className="rounded-md border border-treasuri-line bg-white p-2 sm:p-3"
            key={section.title}
          >
            <h2 className="font-semibold text-sm sm:text-base">{section.title}</h2>
            <dl className="mt-2 grid gap-2">
              {section.rows.map((row) => (
                <div key={`${section.title}-${row.label}`}>
                  <dt className="text-treasuri-muted text-xs">{row.label}</dt>
                  <dd className="font-semibold text-sm">{row.value}</dd>
                  {row.detail ? (
                    <dd className="text-treasuri-muted text-xs">{row.detail}</dd>
                  ) : null}
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </section>
  );
}

function MoneyInput({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="grid gap-1 font-medium text-sm">
      {label}
      <input
        className="min-h-8 rounded-md border border-treasuri-line px-2 font-normal text-sm"
        inputMode="decimal"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
    </label>
  );
}

function SettingsOverview({ data }: { data: SettingsResponse["overview"] }) {
  return (
    <div className="mt-3 grid gap-2 lg:grid-cols-3">
      <OverviewCard title="Accounts">
        {data.accounts.length ? (
          data.accounts.map((account) => (
            <p className="text-xs" key={account.iban}>
              <strong>{account.name}</strong> - {account.provider} - {account.currency} -{" "}
              {account.status}
            </p>
          ))
        ) : (
          <p className="text-treasuri-muted text-xs">No accounts configured.</p>
        )}
      </OverviewCard>
      <OverviewCard title="Category taxonomy">
        <p className="text-xs">{data.taxonomy.categoryCount} categories</p>
        <p className="text-treasuri-muted text-xs">
          {data.taxonomy.sampleCategories.join(", ") || "No categories yet"}
        </p>
      </OverviewCard>
      <OverviewCard title="Sync schedule">
        <p className="text-xs">{data.sync.schedule}</p>
        <p className="text-treasuri-muted text-xs">{data.sync.lookbackDays} day lookback</p>
        <p className="text-treasuri-muted text-xs">{data.sync.lastSync}</p>
      </OverviewCard>
    </div>
  );
}

function OverviewCard({ children, title }: { children: ReactNode; title: string }) {
  return (
    <article className="rounded-md border border-treasuri-line bg-white p-2 sm:p-3">
      <h2 className="mb-2 font-semibold text-sm">{title}</h2>
      {children}
    </article>
  );
}

function settingsUpdateFromResponse(response: SettingsResponse): SettingsUpdate {
  const { overview: _overview, ...settings } = response;
  return settings;
}
