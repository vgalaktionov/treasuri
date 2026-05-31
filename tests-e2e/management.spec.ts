import { expect, test } from "@playwright/test";

test("transaction filters preserve context and edits stay in place", async ({ page }) => {
  await page.goto("/transactions");

  await page.getByRole("textbox", { name: "Search transactions" }).fill("dog");
  await page.getByRole("button", { exact: true, name: "Filter" }).click();

  await expect(page).toHaveURL(/\/transactions\?query=dog$/);
  await expect(page.getByText("Dog food sample")).toBeVisible();
  await expect(page.getByText("Groceries sample")).toHaveCount(0);
  await page.getByRole("button", { name: "Edit" }).click();
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
  await expect(page.getByText("Savings transfer sample")).toBeVisible();
  await page.getByRole("button", { name: "Raw data" }).click();
  await expect(page.getByText("Sample current account")).toBeVisible();
  await expect(page.getByText('"source": "sample"')).toBeVisible();
});
