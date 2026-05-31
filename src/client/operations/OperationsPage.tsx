import type { UseMutationResult } from "@tanstack/react-query";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  RefreshCw,
  Save,
  ServerCog,
  Settings2,
} from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

import type {
  ExportCreateResponse,
  ExportsResponse,
  SettingsResponse,
  SettingsUpdate,
  StatusResponse,
  SyncCreateResponse,
} from "../../shared/operations.ts";
import {
  createExport,
  fetchExports,
  fetchSettings,
  fetchStatus,
  saveSettings,
  syncNow,
} from "../lib/api.ts";
import { invalidateFinanceWorkspaces } from "../lib/invalidation.ts";

type OperationsSection = "export" | "settings" | "status";
type ExportRun = ExportsResponse["exports"][number];

const sectionTabs: { href: string; label: string; value: OperationsSection }[] = [
  { href: "/status", label: "Status", value: "status" },
  { href: "/settings", label: "Settings", value: "settings" },
  { href: "/export", label: "Export", value: "export" },
];
const sectionLabels: Record<OperationsSection, string> = {
  export: "Export",
  settings: "Settings",
  status: "Status",
};

export function OperationsPage({ section }: { section: OperationsSection }) {
  const queryClient = useQueryClient();
  const status = useQuery({ queryFn: fetchStatus, queryKey: ["status"], refetchInterval: 30_000 });
  const settings = useQuery({ queryFn: fetchSettings, queryKey: ["settings"] });
  const exports = useQuery({ queryFn: fetchExports, queryKey: ["exports"] });
  const sync = useMutation({
    mutationFn: syncNow,
    onSuccess: () => {
      invalidateFinanceWorkspaces(queryClient);
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });
  const create = useMutation({
    mutationFn: createExport,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["exports"] });
      queryClient.invalidateQueries({ queryKey: ["status"] });
    },
  });

  return (
    <section aria-labelledby="operations-heading">
      <header className="mb-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div>
          <p className="font-medium text-treasuri-muted text-xs">Operations</p>
          <h1 className="mt-1 font-semibold text-xl leading-tight" id="operations-heading">
            {sectionLabels[section]}
          </h1>
        </div>
        <nav
          aria-label="Operations sections"
          className="inline-grid grid-cols-3 rounded-md border border-treasuri-line bg-white p-1 text-xs"
        >
          {sectionTabs.map((tab) => (
            <a
              aria-current={tab.value === section ? "page" : undefined}
              className={`min-h-8 rounded px-3 py-2 text-center font-semibold ${
                tab.value === section
                  ? "bg-treasuri-action text-white"
                  : "text-treasuri-muted hover:bg-treasuri-panel"
              }`}
              href={tab.href}
              key={tab.value}
            >
              {tab.label}
            </a>
          ))}
        </nav>
      </header>

      <OperationsSnapshot
        exports={exports.data}
        settings={settings.data}
        status={status.data}
        syncResult={sync.data}
      />

      <div className="mt-3 grid items-start gap-3 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0">
          {section === "status" ? <StatusPanel status={status.data} sync={sync} /> : null}
          {section === "settings" ? <SettingsPanel settings={settings.data} /> : null}
          {section === "export" ? <ExportPanel create={create} exports={exports.data} /> : null}
        </div>
        <RuntimeContext settings={settings.data} status={status.data} />
      </div>
    </section>
  );
}

function OperationsSnapshot({
  exports,
  settings,
  status,
  syncResult,
}: {
  exports: ExportsResponse | undefined;
  settings: SettingsResponse | undefined;
  status: StatusResponse | undefined;
  syncResult: SyncCreateResponse | undefined;
}) {
  const lastSync = statusValue(status, "Sync", "Last sync") ?? "No sync";
  const needsReview = statusValue(status, "Transactions", "Needs review") ?? "0";
  const latestExport = exports?.exports[0];
  const lastSyncDetail = syncResult
    ? `${syncResult.provider}: ${syncResult.newTransactionCount} new, ${syncResult.updatedTransactionCount} updated`
    : statusDetail(status, "Sync", "Last sync");

  return (
    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
      <MetricCard
        detail={lastSyncDetail ?? "Manual bank sync"}
        icon={<RefreshCw className="size-4" />}
        label="Last sync"
        value={lastSync}
      />
      <MetricCard
        detail="Transactions waiting for correction"
        icon={<AlertCircle className="size-4" />}
        label="Review queue"
        value={needsReview}
        valueClassName={Number(needsReview) > 0 ? "text-amber-700" : "text-emerald-700"}
      />
      <MetricCard
        detail={latestExport?.filename ?? "Generate a workbook when needed"}
        icon={<FileSpreadsheet className="size-4" />}
        label="Latest export"
        value={latestExport?.status ?? "none"}
      />
      <MetricCard
        detail={`${settings?.baselineMonths ?? "-"} month baseline, day ${settings?.salaryDay ?? "-"}`}
        icon={<Settings2 className="size-4" />}
        label="Forecast setup"
        value={`EUR ${settings?.targetMonthlySavings ?? "-"}`}
      />
    </div>
  );
}

function StatusPanel({
  status,
  sync,
}: {
  status: StatusResponse | undefined;
  sync: UseMutationResult<SyncCreateResponse, Error, void, unknown>;
}) {
  return (
    <section className="grid gap-3">
      <article className="rounded-md border border-treasuri-line bg-white p-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="font-semibold text-sm">Health</h2>
            <p className="mt-1 text-treasuri-muted text-xs">
              Sensitive values are not displayed. This page is for confirming sync, worker, export,
              and classifier health.
            </p>
          </div>
          <button
            className="inline-flex min-h-8 items-center justify-center gap-2 rounded-md bg-treasuri-action px-3 font-semibold text-sm text-white disabled:opacity-60"
            disabled={sync.isPending}
            onClick={() => sync.mutate()}
            type="button"
          >
            <RefreshCw
              aria-hidden="true"
              className={`size-4 ${sync.isPending ? "animate-spin" : ""}`}
            />
            Sync now
          </button>
        </div>

        {sync.data ? (
          <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-2 text-emerald-800 text-sm">
            Synced {sync.data.provider}: {sync.data.newTransactionCount} new,{" "}
            {sync.data.updatedTransactionCount} updated. Classified {sync.data.classifiedCount},{" "}
            recurring {sync.data.recurringDetectedCount} detected /{" "}
            {sync.data.recurringLinkedTransactionCount} linked, forecast{" "}
            {sync.data.forecastYearMonth ?? "not updated"}.
          </p>
        ) : null}
        {sync.isError ? (
          <p className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-red-700 text-sm">
            Sync failed. Check status for the latest error.
          </p>
        ) : null}

        <div className="mt-3 grid gap-2 md:grid-cols-3">
          <HealthTile label="Secret handling" value="hidden" />
          <HealthTile label="OIDC" value={statusValue(status, "Runtime", "OIDC") ?? "unknown"} />
          <HealthTile
            label="Failed jobs"
            value={statusValue(status, "Worker", "Failed jobs") ?? "0"}
            warning={Number(statusValue(status, "Worker", "Failed jobs") ?? 0) > 0}
          />
        </div>
      </article>

      <FailedJobLog failedJobs={status?.failedJobs ?? []} />

      <div className="grid gap-2 lg:grid-cols-2">
        {status?.sections.map((section) => (
          <section
            className="rounded-md border border-treasuri-line bg-white p-3"
            key={section.title}
          >
            <div className="flex items-center gap-2">
              <ServerCog aria-hidden="true" className="size-4 text-treasuri-muted" />
              <h2 className="font-semibold text-sm">{section.title}</h2>
            </div>
            <dl className="mt-2 divide-y divide-treasuri-line">
              {section.rows.map((row) => (
                <div
                  className="grid gap-1 py-2 first:pt-0 last:pb-0 sm:grid-cols-[9rem_minmax(0,1fr)]"
                  key={`${section.title}-${row.label}`}
                >
                  <dt className="text-treasuri-muted text-xs">{row.label}</dt>
                  <dd className="min-w-0">
                    <p className="truncate font-semibold text-sm">{row.value}</p>
                    {row.detail ? (
                      <p className="mt-0.5 break-words text-treasuri-muted text-xs">{row.detail}</p>
                    ) : null}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </section>
  );
}

function FailedJobLog({ failedJobs }: { failedJobs: StatusResponse["failedJobs"] }) {
  return (
    <article className="rounded-md border border-treasuri-line bg-white p-3">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="font-semibold text-sm">Failed job log</h2>
          <p className="mt-1 text-treasuri-muted text-xs">
            Latest pg-boss failures with redacted output for worker debugging.
          </p>
        </div>
        <span
          className={`font-semibold text-xs ${
            failedJobs.length > 0 ? "text-amber-700" : "text-emerald-700"
          }`}
        >
          {failedJobs.length} failed
        </span>
      </div>

      {failedJobs.length > 0 ? (
        <div className="mt-3 divide-y divide-treasuri-line overflow-hidden rounded-md border border-treasuri-line">
          {failedJobs.map((job) => (
            <div
              className="grid gap-1 px-2 py-2 text-xs sm:grid-cols-[minmax(10rem,0.55fr)_minmax(0,1fr)] sm:gap-3"
              key={`${job.name}-${job.startedAt}`}
            >
              <div className="min-w-0">
                <p className="truncate font-semibold text-sm">{job.name}</p>
                <p className="text-treasuri-muted">{job.startedAt}</p>
              </div>
              <p className="min-w-0 break-words text-red-700">{job.error ?? "No error output"}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 rounded-md border border-treasuri-line bg-treasuri-panel p-2 text-treasuri-muted text-xs">
          No failed jobs in the latest worker history.
        </p>
      )}
    </article>
  );
}

function SettingsPanel({ settings }: { settings: SettingsResponse | undefined }) {
  const queryClient = useQueryClient();
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
      setForm(settingsUpdateFromResponse(saved));
      queryClient.setQueryData(["settings"], saved);
      invalidateFinanceWorkspaces(queryClient);
    },
  });
  const monthlyGuardrail =
    parseMoney(form.targetMonthlySavings) +
    parseMoney(form.safetyBuffer) +
    parseMoney(form.fixedCostsUpcoming);
  const baselineGap = parseMoney(form.variableBaseline3m) - parseMoney(form.variableBaseline6m);
  const savedForm = settings ? settingsUpdateFromResponse(settings) : null;
  const savedGuardrail = savedForm
    ? parseMoney(savedForm.targetMonthlySavings) +
      parseMoney(savedForm.safetyBuffer) +
      parseMoney(savedForm.fixedCostsUpcoming)
    : monthlyGuardrail;
  const savedBaselineGap = savedForm
    ? parseMoney(savedForm.variableBaseline3m) - parseMoney(savedForm.variableBaseline6m)
    : baselineGap;
  const availableSpendDelta = savedGuardrail - monthlyGuardrail;
  const baselineGapDelta = baselineGap - savedBaselineGap;
  const hasUnsavedChanges = savedForm ? settingsChanged(form, savedForm) : false;

  useEffect(() => {
    if (settings) {
      setForm(settingsUpdateFromResponse(settings));
    }
  }, [settings]);

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <section className="grid gap-3">
      <form className="rounded-md border border-treasuri-line bg-white p-3" onSubmit={submit}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="font-semibold text-sm">Forecast assumptions</h2>
            <p className="mt-1 text-treasuri-muted text-xs">
              Balance is derived from bank sync; only user-controlled assumptions live here.
            </p>
          </div>
          <button
            className="inline-flex min-h-8 items-center justify-center gap-2 rounded-md bg-treasuri-action px-3 font-semibold text-sm text-white disabled:opacity-60"
            disabled={save.isPending}
            type="submit"
          >
            <Save aria-hidden="true" className="size-4" />
            Save
          </button>
        </div>

        <div className="mt-3 grid gap-3 xl:grid-cols-3">
          <Fieldset title="Targets">
            <MoneyInput
              label="Target monthly savings"
              name="targetMonthlySavings"
              onChange={(targetMonthlySavings) => setForm({ ...form, targetMonthlySavings })}
              value={form.targetMonthlySavings}
            />
            <MoneyInput
              label="Safety buffer"
              name="safetyBuffer"
              onChange={(safetyBuffer) => setForm({ ...form, safetyBuffer })}
              value={form.safetyBuffer}
            />
            <MoneyInput
              label="Fixed costs upcoming"
              name="fixedCostsUpcoming"
              onChange={(fixedCostsUpcoming) => setForm({ ...form, fixedCostsUpcoming })}
              value={form.fixedCostsUpcoming}
            />
          </Fieldset>

          <Fieldset title="Baseline">
            <NumberInput
              label="Baseline months"
              max={24}
              min={1}
              name="baselineMonths"
              onChange={(baselineMonths) => setForm({ ...form, baselineMonths })}
              value={form.baselineMonths}
            />
            <MoneyInput
              label="3M variable baseline"
              name="variableBaseline3m"
              onChange={(variableBaseline3m) => setForm({ ...form, variableBaseline3m })}
              value={form.variableBaseline3m}
            />
            <MoneyInput
              label="6M variable baseline"
              name="variableBaseline6m"
              onChange={(variableBaseline6m) => setForm({ ...form, variableBaseline6m })}
              value={form.variableBaseline6m}
            />
          </Fieldset>

          <Fieldset title="Sync and classifier">
            <NumberInput
              label="Salary day"
              max={31}
              min={1}
              name="salaryDay"
              onChange={(salaryDay) => setForm({ ...form, salaryDay })}
              value={form.salaryDay}
            />
            <NumberInput
              label="Sync lookback days"
              max={3650}
              min={1}
              name="syncLookbackDays"
              onChange={(syncLookbackDays) => setForm({ ...form, syncLookbackDays })}
              value={form.syncLookbackDays}
            />
            <MoneyInput
              label="LLM confidence threshold"
              name="llmConfidenceThreshold"
              onChange={(llmConfidenceThreshold) => setForm({ ...form, llmConfidenceThreshold })}
              value={form.llmConfidenceThreshold}
            />
            <label className="flex min-h-8 items-center gap-2 font-medium text-sm">
              <input
                checked={form.llmEnabled}
                name="llmEnabled"
                onChange={(event) => setForm({ ...form, llmEnabled: event.target.checked })}
                type="checkbox"
              />
              LLM fallback
            </label>
          </Fieldset>
        </div>

        <ForecastImpactPreview
          availableSpendDelta={availableSpendDelta}
          baselineGapDelta={baselineGapDelta}
          currentGuardrail={monthlyGuardrail}
          hasUnsavedChanges={hasUnsavedChanges}
          savedGuardrail={savedGuardrail}
        />

        <p aria-live="polite" className="mt-2 min-h-5 text-sm text-treasuri-muted">
          {save.isSuccess ? "Settings saved." : null}
          {save.isError ? "Settings could not be saved." : null}
        </p>
      </form>

      <div className="grid gap-2 lg:grid-cols-3">
        <ReadoutCard
          label="Monthly guardrail"
          value={`EUR ${monthlyGuardrail.toFixed(2)}`}
          detail="Target savings + safety buffer + fixed upcoming."
        />
        <ReadoutCard
          label="Variable trend"
          value={`${baselineGap >= 0 ? "+" : ""}EUR ${baselineGap.toFixed(2)}`}
          detail="3M baseline compared with 6M baseline."
        />
        <ReadoutCard
          label="Sync horizon"
          value={`${form.syncLookbackDays} days`}
          detail={`Salary day ${form.salaryDay}; classifier threshold ${form.llmConfidenceThreshold}.`}
        />
      </div>
    </section>
  );
}

function ExportPanel({
  create,
  exports,
}: {
  create: UseMutationResult<ExportCreateResponse, Error, void, unknown>;
  exports: ExportsResponse | undefined;
}) {
  const latest = exports?.exports[0] ?? null;
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selected = useMemo(() => {
    if (!exports?.exports.length) {
      return null;
    }
    return exports.exports.find((run) => run.id === selectedId) ?? latest;
  }, [exports, latest, selectedId]);

  useEffect(() => {
    if (!selectedId && latest) {
      setSelectedId(latest.id);
    }
  }, [latest, selectedId]);

  useEffect(() => {
    if (create.data) {
      setSelectedId(create.data.exportRunId);
    }
  }, [create.data]);

  return (
    <section className="grid gap-3">
      <article className="rounded-md border border-treasuri-line bg-white p-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="font-semibold text-sm">Budget averages workbook</h2>
            <p className="mt-1 text-treasuri-muted text-xs">
              XLSX exports are generated on demand, stored in Postgres, and streamed back from the
              export blob.
            </p>
          </div>
          <button
            className="inline-flex min-h-8 items-center justify-center gap-2 rounded-md bg-treasuri-action px-3 font-semibold text-sm text-white disabled:opacity-60"
            disabled={create.isPending}
            onClick={() => create.mutate()}
            type="button"
          >
            <RefreshCw
              aria-hidden="true"
              className={`size-4 ${create.isPending ? "animate-spin" : ""}`}
            />
            Generate XLSX
          </button>
        </div>

        {create.data ? (
          <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-2 text-emerald-800 text-sm">
            {create.data.queued
              ? `Export ${create.data.exportRunId} queued. Worker will generate the workbook.`
              : `Export ${create.data.exportRunId} generated.`}{" "}
            {create.data.fileId ? (
              <a
                className="font-semibold text-treasuri-action"
                href={`/api/exports/${create.data.fileId}/download`}
              >
                Download file
              </a>
            ) : null}
          </p>
        ) : null}
        {create.isError ? (
          <p className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-red-700 text-sm">
            Export generation failed. Check status for the latest error.
          </p>
        ) : null}
      </article>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <ExportHistory
          exports={exports?.exports ?? []}
          onSelect={setSelectedId}
          selected={selected}
        />
        <ExportInspector exportRun={selected} />
      </div>
    </section>
  );
}

function RuntimeContext({
  settings,
  status,
}: {
  settings: SettingsResponse | undefined;
  status: StatusResponse | undefined;
}) {
  return (
    <aside className="grid gap-2">
      <OverviewCard title="Accounts">
        {settings?.overview.accounts.length ? (
          <div className="divide-y divide-treasuri-line">
            {settings.overview.accounts.map((account) => (
              <div className="py-2 first:pt-0 last:pb-0" key={account.iban}>
                <p className="font-semibold text-sm">{account.name}</p>
                <p className="break-all text-treasuri-muted text-xs">
                  {account.provider} - {account.iban}
                </p>
                <p className="text-treasuri-muted text-xs">
                  {account.currency} - {account.status}
                </p>
                {account.syncedBalance ? (
                  <dl className="mt-2 rounded-md border border-treasuri-line bg-treasuri-panel p-2">
                    <InlineMetric
                      detail={`${account.syncedBalance.source}, ${account.syncedBalance.asOf}`}
                      label="Synced balance"
                      value={`${account.syncedBalance.currency} ${account.syncedBalance.amount}`}
                    />
                  </dl>
                ) : (
                  <p className="mt-2 text-treasuri-muted text-xs">No synced balance yet.</p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-treasuri-muted text-xs">No accounts configured.</p>
        )}
      </OverviewCard>
      <OverviewCard title="Category taxonomy">
        <p className="font-semibold text-sm">
          {settings?.overview.taxonomy.categoryCount ?? 0} categories
        </p>
        <p className="mt-1 text-treasuri-muted text-xs">
          {settings?.overview.taxonomy.sampleCategories.join(", ") || "No categories yet"}
        </p>
      </OverviewCard>
      <OverviewCard title="Sync schedule">
        <dl className="grid gap-2">
          <InlineMetric
            label="Schedule"
            value={settings?.overview.sync.schedule ?? "Manual sync"}
          />
          <InlineMetric
            label="Lookback"
            value={`${settings?.overview.sync.lookbackDays ?? "-"} days`}
          />
          <InlineMetric label="Last sync" value={settings?.overview.sync.lastSync ?? "No sync"} />
          <InlineMetric
            label="Bank provider"
            value={statusValue(status, "Runtime", "Bank provider") ?? "unknown"}
          />
        </dl>
      </OverviewCard>
    </aside>
  );
}

function ExportHistory({
  exports,
  onSelect,
  selected,
}: {
  exports: ExportRun[];
  onSelect: (id: number) => void;
  selected: ExportRun | null;
}) {
  if (exports.length === 0) {
    return (
      <article className="rounded-md border border-treasuri-line bg-white p-3">
        <h2 className="font-semibold text-sm">Export history</h2>
        <p className="mt-2 text-treasuri-muted text-sm">
          No exports yet. Generate a workbook to store it as a Postgres blob.
        </p>
      </article>
    );
  }

  return (
    <article className="rounded-md border border-treasuri-line bg-white p-3">
      <h2 className="font-semibold text-sm">Export history</h2>
      <div className="mt-2 divide-y divide-treasuri-line">
        {exports.map((exportRun) => (
          <button
            className={`grid w-full gap-1 py-2 text-left first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto] ${
              selected?.id === exportRun.id ? "text-treasuri-action" : "text-treasuri-ink"
            }`}
            key={exportRun.id}
            onClick={() => onSelect(exportRun.id)}
            type="button"
          >
            <span className="min-w-0">
              <span className="block truncate font-semibold text-sm">
                {exportRun.filename ?? exportRun.exportType}
              </span>
              <span className="block text-treasuri-muted text-xs">
                {exportRun.createdAt} - {exportRun.status}
              </span>
              {exportRun.errorMessage ? (
                <span className="block text-red-700 text-xs">{exportRun.errorMessage}</span>
              ) : null}
            </span>
            <span className="font-semibold text-xs">{formatBytes(exportRun.sizeBytes)}</span>
          </button>
        ))}
      </div>
    </article>
  );
}

function ExportInspector({ exportRun }: { exportRun: ExportRun | null }) {
  return (
    <article className="rounded-md border border-treasuri-line bg-white p-3">
      <h2 className="font-semibold text-sm">Selected export</h2>
      {exportRun ? (
        <>
          <dl className="mt-2 grid gap-2">
            <InlineMetric label="Run" value={`#${exportRun.id}`} />
            <InlineMetric label="Type" value={exportRun.exportType} />
            <InlineMetric label="Status" value={exportRun.status} />
            <InlineMetric label="Period" value={exportPeriod(exportRun)} />
            <InlineMetric label="Created" value={exportRun.createdAt} />
            <InlineMetric label="Finished" value={exportRun.finishedAt ?? "not finished"} />
            <InlineMetric label="Size" value={formatBytes(exportRun.sizeBytes)} />
            <InlineMetric label="Sheets" value={String(exportRun.sheetNames.length)} />
            <InlineMetric label="SHA-256" value={shortHash(exportRun.sha256)} />
          </dl>
          {exportRun.sheetNames.length > 0 ? (
            <div className="mt-3 border-t border-treasuri-line pt-3">
              <p className="font-semibold text-sm">Workbook sheets</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {exportRun.sheetNames.map((sheetName) => (
                  <span
                    className="rounded border border-treasuri-line px-1.5 py-0.5 font-medium text-treasuri-muted text-[0.68rem]"
                    key={sheetName}
                  >
                    {sheetName}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          {exportRun.fileId ? (
            <a
              className="mt-3 inline-flex min-h-8 w-full items-center justify-center gap-2 rounded-md border border-treasuri-line px-3 font-semibold text-sm"
              href={`/api/exports/${exportRun.fileId}/download`}
            >
              <Download aria-hidden="true" className="size-4" />
              Download
            </a>
          ) : null}
        </>
      ) : (
        <p className="mt-2 text-treasuri-muted text-sm">No export selected.</p>
      )}
    </article>
  );
}

function ForecastImpactPreview({
  availableSpendDelta,
  baselineGapDelta,
  currentGuardrail,
  hasUnsavedChanges,
  savedGuardrail,
}: {
  availableSpendDelta: number;
  baselineGapDelta: number;
  currentGuardrail: number;
  hasUnsavedChanges: boolean;
  savedGuardrail: number;
}) {
  return (
    <section className="mt-3 rounded-md border border-treasuri-line bg-treasuri-panel p-3">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="font-semibold text-sm">Forecast impact</h3>
          <p className="mt-1 text-treasuri-muted text-xs">
            Preview only; the forecast recalculates from bank-derived balance after saving or sync.
          </p>
        </div>
        <span
          className={`font-semibold text-xs ${
            hasUnsavedChanges ? "text-amber-700" : "text-emerald-700"
          }`}
        >
          {hasUnsavedChanges ? "Unsaved changes" : "Matches saved settings"}
        </span>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-3">
        <ImpactMetric
          label="Safe-to-spend preview"
          tone={availableSpendDelta >= 0 ? "positive" : "negative"}
          value={signedEuro(availableSpendDelta)}
        />
        <ImpactMetric
          label="Guardrail total"
          tone={currentGuardrail <= savedGuardrail ? "positive" : "negative"}
          value={`EUR ${currentGuardrail.toFixed(2)}`}
        />
        <ImpactMetric
          label="Variable pace delta"
          tone={baselineGapDelta <= 0 ? "positive" : "negative"}
          value={signedEuro(baselineGapDelta)}
        />
      </div>
    </section>
  );
}

function ImpactMetric({
  label,
  tone,
  value,
}: {
  label: string;
  tone: "negative" | "positive";
  value: string;
}) {
  return (
    <div className="rounded-md border border-treasuri-line bg-white p-2">
      <p className="font-medium text-treasuri-muted text-xs">{label}</p>
      <p
        className={`mt-1 font-semibold text-sm ${
          tone === "positive" ? "text-emerald-700" : "text-amber-700"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function Fieldset({ children, title }: { children: ReactNode; title: string }) {
  return (
    <fieldset className="grid gap-2 rounded-md border border-treasuri-line p-2">
      <legend className="px-1 font-semibold text-treasuri-muted text-xs">{title}</legend>
      {children}
    </fieldset>
  );
}

function MoneyInput({
  label,
  name,
  onChange,
  value,
}: {
  label: string;
  name: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="grid gap-1 font-medium text-sm">
      {label}
      <input
        className="min-h-8 rounded-md border border-treasuri-line px-2 font-normal text-sm"
        inputMode="decimal"
        name={name}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
    </label>
  );
}

function NumberInput({
  label,
  max,
  min,
  name,
  onChange,
  value,
}: {
  label: string;
  max?: number;
  min?: number;
  name: string;
  onChange: (value: number) => void;
  value: number;
}) {
  return (
    <label className="grid gap-1 font-medium text-sm">
      {label}
      <input
        className="min-h-8 rounded-md border border-treasuri-line px-2 font-normal text-sm"
        max={max}
        min={min}
        name={name}
        onChange={(event) => onChange(Number(event.target.value))}
        type="number"
        value={value}
      />
    </label>
  );
}

function MetricCard({
  detail,
  icon,
  label,
  value,
  valueClassName = "text-treasuri-ink",
}: {
  detail: string;
  icon: ReactNode;
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <article className="rounded-md border border-treasuri-line bg-white p-3">
      <div className="flex items-center gap-2 text-treasuri-muted">
        {icon}
        <p className="font-medium text-xs">{label}</p>
      </div>
      <p className={`mt-2 truncate font-semibold text-base ${valueClassName}`}>{value}</p>
      <p className="mt-1 line-clamp-2 text-treasuri-muted text-xs">{detail}</p>
    </article>
  );
}

function HealthTile({
  label,
  value,
  warning = false,
}: {
  label: string;
  value: string;
  warning?: boolean;
}) {
  const Icon = warning ? AlertCircle : CheckCircle2;
  return (
    <div className="rounded-md border border-treasuri-line p-2">
      <div className="flex items-center gap-2">
        <Icon
          aria-hidden="true"
          className={`size-4 ${warning ? "text-amber-700" : "text-emerald-700"}`}
        />
        <p className="font-medium text-treasuri-muted text-xs">{label}</p>
      </div>
      <p className="mt-1 font-semibold text-sm">{value}</p>
    </div>
  );
}

function ReadoutCard({ detail, label, value }: { detail: string; label: string; value: string }) {
  return (
    <article className="rounded-md border border-treasuri-line bg-white p-3">
      <p className="font-medium text-treasuri-muted text-xs">{label}</p>
      <p className="mt-1 font-semibold text-base">{value}</p>
      <p className="mt-1 text-treasuri-muted text-xs">{detail}</p>
    </article>
  );
}

function OverviewCard({ children, title }: { children: ReactNode; title: string }) {
  return (
    <article className="rounded-md border border-treasuri-line bg-white p-3">
      <p className="mb-2 font-semibold text-sm">{title}</p>
      {children}
    </article>
  );
}

function InlineMetric({
  detail,
  label,
  value,
}: {
  detail?: string | undefined;
  label: string;
  value: string;
}) {
  return (
    <div>
      <dt className="text-treasuri-muted text-xs">{label}</dt>
      <dd className="break-words font-semibold text-sm">{value}</dd>
      {detail ? <dd className="mt-0.5 break-words text-treasuri-muted text-xs">{detail}</dd> : null}
    </div>
  );
}

function statusValue(status: StatusResponse | undefined, sectionTitle: string, rowLabel: string) {
  return status?.sections
    .find((section) => section.title === sectionTitle)
    ?.rows.find((row) => row.label === rowLabel)?.value;
}

function statusDetail(status: StatusResponse | undefined, sectionTitle: string, rowLabel: string) {
  return status?.sections
    .find((section) => section.title === sectionTitle)
    ?.rows.find((row) => row.label === rowLabel)?.detail;
}

function parseMoney(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function signedEuro(value: number): string {
  const prefix = value >= 0 ? "+" : "-";
  return `${prefix}EUR ${Math.abs(value).toFixed(2)}`;
}

function formatBytes(value: number | null): string {
  if (!value) {
    return "-";
  }
  if (value < 1024) {
    return `${value} B`;
  }
  return `${(value / 1024).toFixed(1)} KB`;
}

function exportPeriod(exportRun: ExportRun): string {
  if (exportRun.periodStart && exportRun.periodEnd) {
    return `${exportRun.periodStart} to ${exportRun.periodEnd}`;
  }
  return "unknown";
}

function shortHash(value: string | null): string {
  return value ? value.slice(0, 12) : "-";
}

function settingsUpdateFromResponse(response: SettingsResponse): SettingsUpdate {
  const { overview: _overview, ...settings } = response;
  return settings;
}

function settingsChanged(left: SettingsUpdate, right: SettingsUpdate): boolean {
  return (
    left.baselineMonths !== right.baselineMonths ||
    left.fixedCostsUpcoming !== right.fixedCostsUpcoming ||
    left.llmConfidenceThreshold !== right.llmConfidenceThreshold ||
    left.llmEnabled !== right.llmEnabled ||
    left.safetyBuffer !== right.safetyBuffer ||
    left.salaryDay !== right.salaryDay ||
    left.syncLookbackDays !== right.syncLookbackDays ||
    left.targetMonthlySavings !== right.targetMonthlySavings ||
    left.variableBaseline3m !== right.variableBaseline3m ||
    left.variableBaseline6m !== right.variableBaseline6m
  );
}
