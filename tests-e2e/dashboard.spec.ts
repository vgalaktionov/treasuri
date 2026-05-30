import { expect, test } from "@playwright/test";

test("dashboard shows safe-to-spend and an accessible forecast explanation", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: /EUR 98\.45/ })).toBeVisible();
  await expect(page.getByText("Safe to spend this month")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Current balance" })).toBeVisible();
  await page.getByText("Forecast explanation").click();
  await expect(page.getByText("synced current liquid balance")).toBeVisible();
});
