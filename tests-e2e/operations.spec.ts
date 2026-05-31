import { expect, test } from "@playwright/test";

test("operations workspace covers settings, status, and exports", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByText(/current balance/i)).toHaveCount(0);
  await page.getByLabel("Target monthly savings").fill("1250.00");
  await page.getByLabel("Safety buffer").fill("900.00");
  await page.getByLabel("Baseline months").fill("8");
  await page.getByLabel("Salary day").fill("24");
  await page.getByLabel("Sync lookback days").fill("120");
  await page.getByLabel("Fixed costs upcoming").fill("640.00");
  await page.getByLabel("3M variable baseline").fill("700.00");
  await page.getByLabel("6M variable baseline").fill("650.00");
  await page.getByLabel("LLM confidence threshold").fill("0.82");
  await page.getByLabel("LLM fallback").check();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Settings saved.")).toBeVisible();
  await expect(page.getByText("Accounts")).toBeVisible();
  await expect(page.getByText("Category taxonomy")).toBeVisible();
  await expect(page.getByText("Sync schedule")).toBeVisible();

  await page.goto("/status");
  await expect(page.getByRole("heading", { name: "Status" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Database" })).toBeVisible();
  await expect(page.getByRole("heading", { exact: true, name: "Sync" })).toBeVisible();
  await expect(page.getByRole("heading", { exact: true, name: "Transactions" })).toBeVisible();
  await expect(page.getByRole("heading", { exact: true, name: "Forecast" })).toBeVisible();
  await expect(page.getByRole("heading", { exact: true, name: "Worker" })).toBeVisible();
  await expect(page.getByRole("heading", { exact: true, name: "Exports" })).toBeVisible();
  await expect(page.getByRole("heading", { exact: true, name: "Runtime" })).toBeVisible();
  await expect(page.getByText("Secrets")).toBeVisible();
  await expect(page.getByText("redacted")).toBeVisible();
  await page.getByRole("button", { name: "Sync now" }).click();
  await expect(page.getByText(/Synced fake:/)).toBeVisible();
  await expect(page.getByText(/forecast 2026-05/)).toBeVisible();

  await page.goto("/export");
  await expect(page.getByRole("heading", { exact: true, name: "Export" })).toBeVisible();
  await expect(page.getByRole("button", { name: /budget-averages-2026-05\.xlsx/ })).toBeVisible();
  await expect(page.getByText("budget_averages", { exact: true })).toBeVisible();
  await expect(page.getByText("Selected export")).toBeVisible();
  await page.getByRole("button", { name: "Generate XLSX" }).click();
  await expect(page.getByText(/Export \d+ generated/)).toBeVisible();
});
