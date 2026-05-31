import { type DashboardResponse, dashboardResponseSchema } from "../../shared/dashboard.ts";
import {
  type CategoryBudgetResponse,
  categoryBudgetResponseSchema,
  managementCategorySchema,
  type RuleDraftFromTransactionResponse,
  type RuleEditorRequest,
  type RulePreviewRequest,
  recurringActionResponseSchema,
  recurringResponseSchema,
  ruleActiveUpdateRequestSchema,
  ruleApplyResponseSchema,
  ruleCreateResponseSchema,
  ruleDraftFromTransactionResponseSchema,
  ruleEditorRequestSchema,
  rulePreviewResponseSchema,
  rulesResponseSchema,
  type TransactionFilters,
  type TransactionsResponse,
  type TransactionUpdateRequest,
  transactionRawDetailsSchema,
  transactionsResponseSchema,
} from "../../shared/management.ts";
import {
  type ExportCreateResponse,
  type ExportsResponse,
  exportCreateResponseSchema,
  exportsResponseSchema,
  type SettingsResponse,
  type SettingsUpdate,
  type StatusResponse,
  type SyncCreateResponse,
  settingsResponseSchema,
  settingsUpdateSchema,
  statusResponseSchema,
  syncCreateResponseSchema,
} from "../../shared/operations.ts";
import {
  type ReviewActionRequest,
  type ReviewActionResponse,
  type ReviewInboxResponse,
  reviewActionResponseSchema,
  reviewInboxResponseSchema,
} from "../../shared/review.ts";

const meResponseSchema = {
  parse(value: unknown): { csrfToken: string } {
    if (
      typeof value === "object" &&
      value !== null &&
      "csrfToken" in value &&
      typeof value.csrfToken === "string"
    ) {
      return { csrfToken: value.csrfToken };
    }
    throw new Error("Invalid session response");
  },
};

let csrfTokenPromise: Promise<string> | null = null;

export async function fetchDashboard(): Promise<DashboardResponse> {
  const response = await fetch("/api/dashboard");
  if (!response.ok) {
    throw new Error("Failed to load dashboard");
  }
  return dashboardResponseSchema.parse(await response.json());
}

export async function fetchReviewInbox(): Promise<ReviewInboxResponse> {
  const response = await fetch("/api/review");
  if (!response.ok) {
    throw new Error("Failed to load review inbox");
  }
  return reviewInboxResponseSchema.parse(await response.json());
}

export async function fetchTransactions(
  filters: TransactionFilters = {},
): Promise<TransactionsResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === "" || value === false) {
      continue;
    }
    params.set(key, String(value));
  }
  const query = params.toString();
  const response = await fetch(query ? `/api/transactions?${query}` : "/api/transactions");
  if (!response.ok) {
    throw new Error("Failed to load transactions");
  }
  return transactionsResponseSchema.parse(await response.json());
}

export async function updateTransaction(transactionId: number, input: TransactionUpdateRequest) {
  const response = await fetch(`/api/transactions/${transactionId}`, {
    body: JSON.stringify(input),
    headers: await jsonMutationHeaders(),
    method: "PATCH",
  });
  if (!response.ok) {
    throw new Error("Failed to update transaction");
  }
}

export async function fetchTransactionRawDetails(transactionId: number) {
  const response = await fetch(`/api/transactions/${transactionId}/raw`);
  if (!response.ok) {
    throw new Error("Failed to load transaction details");
  }
  return transactionRawDetailsSchema.parse(await response.json());
}

export async function fetchRules() {
  const response = await fetch("/api/rules");
  if (!response.ok) {
    throw new Error("Failed to load rules");
  }
  return rulesResponseSchema.parse(await response.json());
}

export async function draftRuleFromTransaction(
  transactionId: number,
): Promise<RuleDraftFromTransactionResponse> {
  const response = await fetch(`/api/rules/draft-from-transaction/${transactionId}`);
  if (!response.ok) {
    throw new Error("Failed to draft rule from transaction");
  }
  return ruleDraftFromTransactionResponseSchema.parse(await response.json());
}

export async function fetchCategories() {
  const response = await fetch("/api/categories");
  if (!response.ok) {
    throw new Error("Failed to load categories");
  }
  return managementCategorySchema.array().parse(await response.json());
}

export async function fetchCategoryBudgets(): Promise<CategoryBudgetResponse> {
  const response = await fetch("/api/category-budgets");
  if (!response.ok) {
    throw new Error("Failed to load category budgets");
  }
  return categoryBudgetResponseSchema.parse(await response.json());
}

export async function fetchRecurring() {
  const response = await fetch("/api/recurring");
  if (!response.ok) {
    throw new Error("Failed to load recurring series");
  }
  return recurringResponseSchema.parse(await response.json());
}

export async function previewRule(input: RulePreviewRequest) {
  const response = await fetch("/api/rules/preview", {
    body: JSON.stringify(input),
    headers: await jsonMutationHeaders(),
    method: "POST",
  });
  if (!response.ok) {
    throw new Error("Failed to preview rule");
  }
  return rulePreviewResponseSchema.parse(await response.json());
}

export async function createRule(input: RuleEditorRequest) {
  const response = await fetch("/api/rules", {
    body: JSON.stringify(ruleEditorRequestSchema.parse(input)),
    headers: await jsonMutationHeaders(),
    method: "POST",
  });
  if (!response.ok) {
    throw new Error("Failed to create rule");
  }
  return ruleCreateResponseSchema.parse(await response.json());
}

export async function updateRule(ruleId: number, input: RuleEditorRequest) {
  const response = await fetch(`/api/rules/${ruleId}`, {
    body: JSON.stringify(ruleEditorRequestSchema.parse(input)),
    headers: await jsonMutationHeaders(),
    method: "PUT",
  });
  if (!response.ok) {
    throw new Error("Failed to update rule");
  }
}

export async function setRuleActive(ruleId: number, isActive: boolean) {
  const response = await fetch(`/api/rules/${ruleId}/active`, {
    body: JSON.stringify(ruleActiveUpdateRequestSchema.parse({ isActive })),
    headers: await jsonMutationHeaders(),
    method: "PATCH",
  });
  if (!response.ok) {
    throw new Error("Failed to update rule status");
  }
}

export async function applyRule(ruleId: number) {
  const response = await fetch(`/api/rules/${ruleId}/apply`, {
    headers: await mutationHeaders(),
    method: "POST",
  });
  if (!response.ok) {
    throw new Error("Failed to apply rule");
  }
  return ruleApplyResponseSchema.parse(await response.json());
}

export async function confirmRecurring(seriesId: number) {
  const response = await fetch(`/api/recurring/${seriesId}/confirm`, {
    headers: await mutationHeaders(),
    method: "POST",
  });
  if (!response.ok) {
    throw new Error("Failed to confirm recurring series");
  }
  return recurringActionResponseSchema.parse(await response.json());
}

export async function disableRecurring(seriesId: number) {
  const response = await fetch(`/api/recurring/${seriesId}/disable`, {
    headers: await mutationHeaders(),
    method: "POST",
  });
  if (!response.ok) {
    throw new Error("Failed to disable recurring series");
  }
  return recurringActionResponseSchema.parse(await response.json());
}

export async function applyReviewAction(
  transactionId: number,
  action: ReviewActionRequest,
): Promise<ReviewActionResponse> {
  const response = await fetch(`/api/review/${transactionId}/action`, {
    body: JSON.stringify(action),
    headers: await jsonMutationHeaders(),
    method: "POST",
  });
  if (!response.ok) {
    throw new Error("Failed to apply review action");
  }
  return reviewActionResponseSchema.parse(await response.json());
}

export async function fetchSettings(): Promise<SettingsResponse> {
  const response = await fetch("/api/settings");
  if (!response.ok) {
    throw new Error("Failed to load settings");
  }
  return settingsResponseSchema.parse(await response.json());
}

export async function saveSettings(input: SettingsUpdate): Promise<SettingsResponse> {
  const response = await fetch("/api/settings", {
    body: JSON.stringify(settingsUpdateSchema.parse(input)),
    headers: await jsonMutationHeaders(),
    method: "PUT",
  });
  if (!response.ok) {
    throw new Error("Failed to save settings");
  }
  return settingsResponseSchema.parse(await response.json());
}

export async function fetchStatus(): Promise<StatusResponse> {
  const response = await fetch("/api/status");
  if (!response.ok) {
    throw new Error("Failed to load status");
  }
  return statusResponseSchema.parse(await response.json());
}

export async function fetchExports(): Promise<ExportsResponse> {
  const response = await fetch("/api/exports");
  if (!response.ok) {
    throw new Error("Failed to load exports");
  }
  return exportsResponseSchema.parse(await response.json());
}

export async function createExport(): Promise<ExportCreateResponse> {
  const response = await fetch("/api/exports", {
    headers: await mutationHeaders(),
    method: "POST",
  });
  if (!response.ok) {
    throw new Error("Failed to create export");
  }
  return exportCreateResponseSchema.parse(await response.json());
}

export async function syncNow(): Promise<SyncCreateResponse> {
  const response = await fetch("/api/sync-now", {
    headers: await mutationHeaders(),
    method: "POST",
  });
  if (!response.ok) {
    throw new Error("Failed to run sync");
  }
  return syncCreateResponseSchema.parse(await response.json());
}

async function jsonMutationHeaders(): Promise<HeadersInit> {
  return { "content-type": "application/json", ...(await mutationHeaders()) };
}

async function mutationHeaders(): Promise<HeadersInit> {
  return { "x-csrf-token": await csrfToken() };
}

async function csrfToken(): Promise<string> {
  csrfTokenPromise ??= fetch("/api/me")
    .then((response) => {
      if (!response.ok) {
        throw new Error("Failed to load session");
      }
      return response.json();
    })
    .then((json) => meResponseSchema.parse(json).csrfToken);
  return csrfTokenPromise;
}
