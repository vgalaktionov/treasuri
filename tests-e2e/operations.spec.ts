import { expect, test } from "@playwright/test";

test("operations workspace covers settings, status, and exports", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByText(/current balance/i)).toHaveCount(0);
  await page.getByLabel("Target monthly savings").fill("1250.00");
  await page.getByLabel("Safety buffer").fill("900.00");
  await page.getByLabel("Baseline months").fill("8");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Settings saved.")).toBeVisible();

  await page.goto("/status");
  await expect(page.getByRole("heading", { name: "Status" })).toBeVisible();
  await expect(page.getByText("Secrets")).toBeVisible();
  await expect(page.getByText("redacted")).toBeVisible();

  await page.goto("/export");
  await expect(page.getByRole("heading", { name: "Export" })).toBeVisible();
  await page.getByRole("button", { name: "Generate" }).click();
  await expect(page.getByText(/Export \d+ generated/)).toBeVisible();
});
