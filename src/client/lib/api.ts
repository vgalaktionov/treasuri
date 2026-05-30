import { type DashboardResponse, dashboardResponseSchema } from "../../shared/dashboard.ts";
import {
  managementCategorySchema,
  type RulePreviewRequest,
  recurringResponseSchema,
  ruleApplyResponseSchema,
  ruleCreateResponseSchema,
  rulePreviewResponseSchema,
  rulesResponseSchema,
  type TransactionsResponse,
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

export async function fetchTransactions(query: string): Promise<TransactionsResponse> {
  const response = await fetch(`/api/transactions?query=${encodeURIComponent(query)}`);
  if (!response.ok) {
    throw new Error("Failed to load transactions");
  }
  return transactionsResponseSchema.parse(await response.json());
}

export async function updateTransactionCategory(transactionId: number, categoryId: number) {
  const response = await fetch(`/api/transactions/${transactionId}`, {
    body: JSON.stringify({ categoryId }),
    headers: { "content-type": "application/json" },
    method: "PATCH",
  });
  if (!response.ok) {
    throw new Error("Failed to update transaction");
  }
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

export async function createRule(input: RulePreviewRequest) {
  const response = await fetch("/api/rules", {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error("Failed to create rule");
  }
  return ruleCreateResponseSchema.parse(await response.json());
}

export async function applyRule(ruleId: number) {
  const response = await fetch(`/api/rules/${ruleId}/apply`, { method: "POST" });
  if (!response.ok) {
    throw new Error("Failed to apply rule");
  }
  return ruleApplyResponseSchema.parse(await response.json());
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
