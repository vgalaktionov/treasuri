import { expect, test } from "@playwright/test";

test("shell shows the correct navigation for the viewport", async ({ page }, testInfo) => {
  await page.goto("/");

  await expect(page.getByText("Safe to spend this month")).toBeVisible();

  if (testInfo.project.name === "desktop") {
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Transactions" })).toBeVisible();
    return;
  }

  await expect(page.getByRole("navigation", { name: "Mobile primary" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Home" })).toBeVisible();
  await page.getByRole("link", { name: "More" }).click();
  await expect(page).toHaveURL(/\/more$/);
  await expect(page.getByRole("heading", { name: "More" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Categories/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Rules/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Status/ })).toBeVisible();
  await expect(page.getByText("Safe to spend this month")).toHaveCount(0);
});
