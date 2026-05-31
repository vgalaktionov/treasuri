import { expect, test } from "@playwright/test";

test("review actions update the inbox without leaving the page", async ({ page }) => {
  await page.goto("/review");

  await expect(page.getByRole("heading", { name: "Review inbox" })).toBeVisible();
  await expect(page.getByText("Queue")).toBeVisible();
  const accept = page.getByRole("button", { name: "Accept" });
  if ((await accept.count()) > 0) {
    await expect(page.getByText("1 to review")).toBeVisible();
    await accept.click();
  }

  await expect(page).toHaveURL(/\/review$/);
  await expect(page.getByText("0 to review")).toBeVisible();
  await expect(page.getByText("Review inbox is clear.")).toBeVisible();
});

test("review correction supports merchant flags and rule preview", async ({ page }) => {
  await page.goto("/review");

  await expect(page.getByRole("heading", { name: "Review inbox" })).toBeVisible();
  await expect(page.getByText("Queue")).toBeVisible();
  await page.getByLabel("Category for Needs review sample").selectOption({ label: "Dog" });
  await page.getByLabel("Merchant for Needs review sample").fill("Sample Pet Care");
  await page.getByLabel("Remember merchant").check();
  await page.getByLabel("One-off").check();
  await page.getByLabel("Exclude").check();
  await page.getByRole("button", { name: "Preview rule" }).click();

  await expect(page).toHaveURL(/\/review$/);
  await expect(page.getByText("Rule preview")).toBeVisible();
  await expect(page.getByText("Unknown Sample Merchant", { exact: true })).toBeVisible();
  await expect(page.getByText("0 to review")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Preview matches" })).toBeVisible();
  await expect(page.getByText("Needs review sample")).toBeVisible();
  await page.getByRole("button", { name: "Create rule" }).click();
  await expect(page.getByText(/Rule \d+ created/)).toBeVisible();
});

test("review inbox can quickly exclude a forecast blocker", async ({ page }) => {
  await page.goto("/review");

  await expect(page.getByRole("heading", { name: "Review inbox" })).toBeVisible();
  await page.getByRole("button", { name: "Exclude" }).click();

  await expect(page).toHaveURL(/\/review$/);
  await expect(page.getByText("0 to review")).toBeVisible();
  await expect(page.getByText("Review inbox is clear.")).toBeVisible();
});
