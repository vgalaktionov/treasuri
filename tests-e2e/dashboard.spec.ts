import { expect, test } from "@playwright/test";

test("dashboard shows safe-to-spend and an accessible forecast explanation", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: /EUR 98\.45/ })).toBeVisible();
  await expect(page.getByText("safe to spend this month")).toBeVisible();
  await expect(page.getByText("safe to spend today")).toBeVisible();
  await expect(page.locator("aside:visible").filter({ hasText: "Next actions" })).toBeVisible();
  await expect(page.locator("dt:visible").filter({ hasText: "Income status" })).toBeVisible();
  await expect(page.locator("dt:visible").filter({ hasText: "Uncategorized impact" })).toBeVisible();
  await expect(page.locator("dt:visible").filter({ hasText: "Synced balance" })).toBeVisible();
  await expect(page.getByText("Target savings")).toBeVisible();
  await expect(page.getByText("EUR 1000.00").first()).toBeVisible();
  await expect(page.getByText("Review blockers")).toBeVisible();
  await expect(page.getByText("Unknown Sample Merchant")).toBeVisible();
  await page.getByRole("tab", { name: "After review" }).click();
  await expect(page.getByRole("heading", { name: /EUR 56\.35/ })).toBeVisible();
  await expect(page.locator("dt:visible").filter({ hasText: "After review impact" })).toBeVisible();
  await expect(page.getByText(/Review impact reserved/)).toBeVisible();
  await page.getByRole("tab", { name: "Synced forecast" }).click();
  await expect(page.getByRole("heading", { name: /EUR 98\.45/ })).toBeVisible();

  await page.getByRole("tab", { name: "Month" }).click();
  await expect(page.locator("h2:visible").filter({ hasText: "Category pace" })).toBeVisible();
  await expect(page.locator("h2:visible").filter({ hasText: "Month movement" })).toBeVisible();
  await expect(page.locator("p:visible").filter({ hasText: "Groceries" })).toBeVisible();
  await expect(page.getByText("Sample Supermarket")).toBeVisible();

  await page.getByRole("tab", { name: "Explain" }).click();
  await expect(page.locator("p:visible").filter({ hasText: "Forecast equation" })).toBeVisible();
  await expect(page.getByText("Synced current balance")).toBeVisible();
  await expect(page.getByText("Predicted variable remaining", { exact: true })).toBeVisible();
  await expect(page.locator("p:visible").filter({ hasText: "EUR 16.41/day" })).toBeVisible();
  await expect(page.locator("p:visible").filter({ hasText: "Forecast inputs" })).toBeVisible();
  await expect(
    page.locator("dt:visible").filter({ hasText: "synced current liquid balance" }),
  ).toBeVisible();
});

test("dashboard month movement opens the selected transaction", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("tab", { name: "Month" }).click();
  await page.getByRole("link", { name: /Sample Supermarket/ }).click();

  await expect(page).toHaveURL(/\/transactions\?month=2026-05&transactionId=2/);
  await expect(page.getByRole("heading", { name: "Sample Supermarket" })).toBeVisible();
});
