import { type DashboardResponse, dashboardResponseSchema } from "../../shared/dashboard.ts";
import {
  managementCategorySchema,
  type RuleEditorRequest,
  type RulePreviewRequest,
  recurringActionResponseSchema,
  recurringResponseSchema,
  ruleActiveUpdateRequestSchema,
  ruleApplyResponseSchema,
  ruleCreateResponseSchema,
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
  type StatusResponse,
  settingsResponseSchema,
  settingsUpdateSchema,
  statusResponseSchema,
} from "../../shared/operations.ts";
import {
  type ReviewActionRequest,
  type ReviewActionResponse,
  type ReviewInboxResponse,
  reviewActionResponseSchema,
  reviewInboxResponseSchema,
} from "../../shared/review.ts";

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
    headers: { "content-type": "application/json" },
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

export async function fetchCategories() {
  const response = await fetch("/api/categories");
  if (!response.ok) {
    throw new Error("Failed to load categories");
  }
  return managementCategorySchema.array().parse(await response.json());
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
    headers: { "content-type": "application/json" },
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
    headers: { "content-type": "application/json" },
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
    headers: { "content-type": "application/json" },
    method: "PUT",
  });
  if (!response.ok) {
    throw new Error("Failed to update rule");
  }
}

export async function setRuleActive(ruleId: number, isActive: boolean) {
  const response = await fetch(`/api/rules/${ruleId}/active`, {
    body: JSON.stringify(ruleActiveUpdateRequestSchema.parse({ isActive })),
    headers: { "content-type": "application/json" },
    method: "PATCH",
  });
  if (!response.ok) {
    throw new Error("Failed to update rule status");
  }
}

export async function applyRule(ruleId: number) {
  const response = await fetch(`/api/rules/${ruleId}/apply`, { method: "POST" });
  if (!response.ok) {
    throw new Error("Failed to apply rule");
  }
  return ruleApplyResponseSchema.parse(await response.json());
}

export async function confirmRecurring(seriesId: number) {
  const response = await fetch(`/api/recurring/${seriesId}/confirm`, { method: "POST" });
  if (!response.ok) {
    throw new Error("Failed to confirm recurring series");
  }
  return recurringActionResponseSchema.parse(await response.json());
}

export async function disableRecurring(seriesId: number) {
  const response = await fetch(`/api/recurring/${seriesId}/disable`, { method: "POST" });
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
    headers: { "content-type": "application/json" },
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

export async function saveSettings(input: SettingsResponse): Promise<SettingsResponse> {
  const response = await fetch("/api/settings", {
    body: JSON.stringify(settingsUpdateSchema.parse(input)),
    headers: { "content-type": "application/json" },
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
  const response = await fetch("/api/exports", { method: "POST" });
  if (!response.ok) {
    throw new Error("Failed to create export");
  }
  return exportCreateResponseSchema.parse(await response.json());
}
