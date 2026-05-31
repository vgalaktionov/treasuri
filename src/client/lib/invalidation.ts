import type { QueryClient } from "@tanstack/react-query";

const financeWorkspaceQueryKeys = [
  ["category-budgets"],
  ["dashboard"],
  ["recurring"],
  ["review-inbox"],
  ["rules"],
  ["transactions"],
  ["status"],
] as const;

export function invalidateFinanceWorkspaces(queryClient: QueryClient) {
  for (const queryKey of financeWorkspaceQueryKeys) {
    queryClient.invalidateQueries({ queryKey });
  }
}
