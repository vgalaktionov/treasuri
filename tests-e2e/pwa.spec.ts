import { expect, test } from "@playwright/test";

test("PWA metadata and safe offline shell are available", async ({ page }) => {
  await page.goto("/");

  const manifest = await page.request.get("/manifest.webmanifest");
  const serviceWorker = await page.request.get("/service-worker.js");
  const offline = await page.request.get("/offline.html");
  const offlineText = await offline.text();

  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    "href",
    "/manifest.webmanifest",
  );
  expect(manifest.ok()).toBe(true);
  expect(serviceWorker.ok()).toBe(true);
  expect(await serviceWorker.text()).toContain("/offline.html");
  expect((await manifest.json()).display).toBe("standalone");
  expect(offline.ok()).toBe(true);
  expect(offlineText).toContain("Reconnect to view your dashboard");
  expect(offlineText).not.toContain("Jumbo");
  expect(offlineText).not.toContain("IBAN");
});
