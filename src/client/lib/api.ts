import { type DashboardResponse, dashboardResponseSchema } from "../../shared/dashboard.ts";
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
