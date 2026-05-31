import { expect, test } from "@playwright/test";

test("transaction filters preserve context and edits stay in place", async ({ page }) => {
  await page.goto("/transactions");

  await page.getByRole("textbox", { name: "Search transactions" }).fill("dog");
  await page.getByRole("button", { exact: true, name: "Filter" }).click();

  await expect(page).toHaveURL(/\/transactions\?query=dog$/);
  await expect(page.getByText("Dog food sample").first()).toBeVisible();
  await expect(page.getByText("Groceries sample")).toHaveCount(0);
  await expect(page.getByText("1 shown")).toBeVisible();
  await expect(page.getByText("Filtered net")).toBeVisible();
  await expect(
    page.locator("article").filter({ hasText: "Filtered net" }).getByText("EUR -89.95"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Preview rule" }).click();
  await expect(page.getByText("Classify Sample Pet Care")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Preview matches" })).toBeVisible();
  await expect(page.getByText("Sample Pet Care").last()).toBeVisible();
  await page.getByRole("button", { name: "Create rule" }).click();
  await expect(page.getByText(/Rule \d+ created/)).toBeVisible();
  await page.getByLabel("Category for Dog food sample").selectOption({ label: "Groceries" });
  await page.getByLabel("Merchant for Dog food sample").fill("Sample Dog Store");
  await page.getByLabel("Remember merchant").check();
  await page.getByLabel("One-off").check();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL(/\/transactions\?query=dog$/);
});

test("transaction workspace exposes advanced filters and raw details", async ({ page }) => {
  await page.goto("/transactions");

  await page.getByLabel("Type filter").selectOption("savings");
  await page.getByRole("button", { exact: true, name: "Filter" }).click();

  await expect(page).toHaveURL(/kind=savings/);
  await expect(page.getByText("Savings transfer sample").first()).toBeVisible();
  await expect(page.getByText("1 shown")).toBeVisible();
  await expect(page.getByText("Outflow")).toBeVisible();
  await page.getByRole("button", { name: "Raw data" }).click();
  await expect(page.getByText("Sample current account")).toBeVisible();
  await expect(page.getByText('"source": "sample"')).toBeVisible();
});

test("category workspace shows budget averages and filters", async ({ page }) => {
  await page.goto("/categories");

  await expect(page.getByRole("heading", { name: "Categories" })).toBeVisible();
  await expect(page.getByText("Current spend")).toBeVisible();
  await expect(page.getByText("Suggested budget")).toBeVisible();
  await expect(page.getByText("Dog")).toBeVisible();
  await expect(page.getByText("Groceries")).toBeVisible();
  await expect(page.getByText("EUR 0.05 left")).toBeVisible();

  await page.getByRole("button", { name: "Excluded" }).click();
  await expect(page.getByText("Savings")).toBeVisible();
  await expect(page.getByText("Unknown")).toBeVisible();
  await expect(page.getByText("Dog")).toHaveCount(0);

  await page.getByLabel("Search categories").fill("savi");
  await expect(page.getByText("Savings")).toBeVisible();
  await expect(page.getByText("Unknown")).toHaveCount(0);
});
