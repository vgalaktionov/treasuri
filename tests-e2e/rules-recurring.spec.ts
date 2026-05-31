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
  await expect(page.getByText("Preview matches")).toBeVisible();
  await expect(page.getByText("Groceries sample")).toBeVisible();
  await expect(page.getByRole("link", { name: /Groceries sample/ })).toHaveAttribute(
    "href",
    "/transactions?transactionId=2",
  );
  await page.getByRole("button", { name: "Save rule" }).first().click();
  await expect(page.getByText("Rule created.")).toBeVisible();

  await expect(page.getByText("Groceries rule")).toBeVisible();
  await page.getByRole("button", { name: /Groceries rule/ }).click();
  await page.getByRole("button", { name: "Apply history" }).click();
  await expect(page.getByText(/Applied \d+ transaction/)).toBeVisible();
  await page.getByLabel("Rule operator").selectOption("starts_with");
  await page.getByRole("button", { name: "Save rule" }).click();
  await expect(page.getByText("Rule updated.")).toBeVisible();
  await page.getByRole("button", { name: "Disable" }).click();
  await expect(page.getByText("Rule disabled.")).toBeVisible();
  await expect(page.getByText("inactive")).toBeVisible();
});

test("recurring workspace edits assumptions and disables detected commitments", async ({ page }) => {
  await page.goto("/recurring?seriesId=2");

  await expect(page.getByRole("heading", { name: "Recurring" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sample Streaming" })).toBeVisible();
  await page.getByRole("button", { name: /Sample Streaming/ }).click();
  await expect(page).toHaveURL(/\/recurring\?seriesId=2$/);
  await expect(page.getByRole("heading", { name: "Linked transactions" })).toBeVisible();
  await expect(page.getByText("Monthly streaming sample")).toBeVisible();
  await expect(page.getByRole("link", { name: /Monthly streaming sample/ })).toHaveAttribute(
    "href",
    "/transactions?transactionId=8",
  );
  await page.getByRole("link", { name: /Monthly streaming sample/ }).click();
  await expect(page).toHaveURL(/\/transactions\?transactionId=8$/);
  await expect(page.getByRole("heading", { name: "Sample Streaming" })).toBeVisible();

  await page.goto("/recurring?seriesId=2");
  await expect(page.getByRole("heading", { name: "Sample Streaming" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Forecast impact" })).toBeVisible();
  await expect(page.getByText("Matches saved assumptions")).toBeVisible();
  await page.getByLabel("Expected amount").fill("19.99");
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  await expect(page.getByText("-EUR 5.00")).toBeVisible();
  await page.getByLabel("Expected day").fill("16");
  await page.getByLabel("Next expected").fill("2026-06-16");
  await page.getByRole("button", { exact: true, name: "Save assumptions" }).click();
  await expect(page.getByText("Recurring assumptions saved.")).toBeVisible();
  await expect(page.getByText("Matches saved assumptions")).toBeVisible();
  await expect(page.getByText("EUR 19.99").first()).toBeVisible();
  await expect(page.getByText("Next expected 2026-06-16")).toBeVisible();
  await expect(page.getByRole("button", { exact: true, name: "Confirm" })).toHaveCount(0);
  await page.getByRole("button", { exact: true, name: "Disable" }).click();
  await expect(page.getByText("Recurring series disabled.")).toBeVisible();
  await expect(page.getByText("Sample Streaming")).toHaveCount(0);
});
