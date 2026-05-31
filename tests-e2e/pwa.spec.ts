import { expect, test } from "@playwright/test";

test("PWA metadata and safe offline shell are available", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /EUR 98\.45/ })).toBeVisible();

  const manifest = await page.request.get("/manifest.webmanifest");
  const serviceWorker = await page.request.get("/service-worker.js");
  const offline = await page.request.get("/offline.html");
  const offlineText = await offline.text();
  const storedSummary = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("treasuri:last-dashboard-summary") ?? "{}"),
  );

  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    "href",
    "/manifest.webmanifest",
  );
  expect(manifest.ok()).toBe(true);
  expect(serviceWorker.ok()).toBe(true);
  const serviceWorkerText = await serviceWorker.text();
  expect(serviceWorkerText).toContain("/offline.html");
  expect(serviceWorkerText).toContain("/offline-summary.js");
  expect((await manifest.json()).display).toBe("standalone");
  expect(offline.ok()).toBe(true);
  expect(offlineText).toContain("Reconnect to view your dashboard");
  expect(offlineText).toContain("Last known dashboard summary");
  expect(offlineText).not.toContain("Jumbo");
  expect(offlineText).not.toContain("IBAN");
  expect(storedSummary).toMatchObject({
    projected_savings: "EUR 1098.45",
    safe_to_spend: "EUR 98.45",
    target_savings: "EUR 1000.00",
  });
});
