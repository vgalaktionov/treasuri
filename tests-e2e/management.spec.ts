import { expect, test } from "@playwright/test";

test("transaction filters preserve context and edits stay in place", async ({ page }) => {
  await page.goto("/transactions");

  await page.getByRole("textbox", { name: "Search transactions" }).fill("dog");
  await page.getByRole("button", { name: "Search" }).click();

  await expect(page).toHaveURL(/\/transactions\?query=dog$/);
  await expect(page.getByText("Dog food sample")).toBeVisible();
  await expect(page.getByText("Groceries sample")).toHaveCount(0);
  await page.getByLabel("Category for Dog food sample").selectOption({ label: "Groceries" });
  await expect(page).toHaveURL(/\/transactions\?query=dog$/);
});
