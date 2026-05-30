import { expect, test } from "@playwright/test";

test("shell shows the correct navigation for the viewport", async ({ page }, testInfo) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "You are fine for the month." })).toBeVisible();

  if (testInfo.project.name === "desktop") {
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Transactions" })).toBeVisible();
    return;
  }

  await expect(page.getByRole("navigation", { name: "Mobile primary" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Home" })).toBeVisible();
  await expect(page.getByRole("link", { name: "More" })).toBeVisible();
});
