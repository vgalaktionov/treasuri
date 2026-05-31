import { expect, test } from "@playwright/test";

test("dashboard shows safe-to-spend and an accessible forecast explanation", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: /EUR 98\.45/ })).toBeVisible();
  await expect(page.getByText("safe to spend")).toBeVisible();
  await expect(page.locator("aside:visible").filter({ hasText: "Next actions" })).toBeVisible();
  await expect(page.getByText("Income status")).toBeVisible();
  await expect(page.getByText("Uncategorized impact")).toBeVisible();
  await expect(page.getByText("Synced balance")).toBeVisible();

  await page.getByRole("tab", { name: "Month" }).click();
  await expect(page.getByText("Category pace")).toBeVisible();
  await expect(page.getByText("Groceries")).toBeVisible();

  await page.getByRole("tab", { name: "Explain" }).click();
  await expect(page.getByText("Forecast explanation")).toBeVisible();
  await expect(page.getByText("synced current liquid balance")).toBeVisible();
});
