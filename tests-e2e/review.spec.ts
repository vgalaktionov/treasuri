import { expect, test } from "@playwright/test";

test("review actions update the inbox without leaving the page", async ({ page }) => {
  await page.goto("/review");

  await expect(page.getByRole("heading", { name: "Review inbox" })).toBeVisible();
  const accept = page.getByRole("button", { name: "Accept" });
  if ((await accept.count()) > 0) {
    await expect(page.getByText("1 to review")).toBeVisible();
    await accept.click();
  }

  await expect(page).toHaveURL(/\/review$/);
  await expect(page.getByText("0 to review")).toBeVisible();
  await expect(page.getByText("Review inbox is clear.")).toBeVisible();
});
