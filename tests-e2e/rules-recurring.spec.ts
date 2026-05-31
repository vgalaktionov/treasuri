import { expect, test } from "@playwright/test";

test("rules workspace previews, creates, edits, and toggles rules", async ({ page }) => {
  await page.goto("/rules");

  await expect(page.getByRole("heading", { name: "Rules" })).toBeVisible();
  await page.getByLabel("Rule name").fill("Groceries rule");
  await page.getByLabel("Priority").fill("15");
  await page.getByLabel("Rule field").selectOption("description");
  await page.getByLabel("Rule operator").selectOption("contains");
  await page.getByLabel("Rule pattern").fill("Groceries");
  await page.getByLabel("Rule merchant").fill("Sample Supermarket");
  await page.getByLabel("Fixed").check();
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByText(/matches/)).toBeVisible();
  await page.getByRole("button", { name: "Save rule" }).first().click();

  await expect(page.getByText("Groceries rule")).toBeVisible();
  await page.getByRole("button", { name: "Edit" }).last().click();
  await page.getByLabel("Rule operator").last().selectOption("starts_with");
  await page.getByRole("button", { name: "Save rule" }).last().click();
  await page.getByRole("button", { name: "Disable" }).last().click();
  await expect(page.getByText("inactive")).toBeVisible();
});

test("recurring workspace confirms and disables detected commitments", async ({ page }) => {
  await page.goto("/recurring");

  await expect(page.getByRole("heading", { name: "Recurring" })).toBeVisible();
  await expect(page.getByText("Sample Streaming")).toBeVisible();
  await page.getByRole("button", { name: "Confirm" }).click();
  await page.getByRole("button", { name: "Disable" }).last().click();
  await expect(page.getByText("Sample Streaming")).toHaveCount(0);
});
