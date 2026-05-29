import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test as nodeTest } from "node:test";
import readline from "node:readline";
import puppeteer from "puppeteer-core";

let serverProcess;
let baseUrl;
let browser;
const openPages = new Set();

before(async () => {
  ({ process: serverProcess, url: baseUrl } = await startSampleServer());
  browser = await puppeteer.launch({
    executablePath: findChromeExecutable(),
    headless: true,
    args: ["--no-sandbox", "--disable-gpu"],
  });
  trackPages(browser);
});

after(async () => {
  if (browser) {
    await browser.close();
  }
  if (serverProcess) {
    serverProcess.stdin.write("stop\n");
    await waitForExit(serverProcess, 8000);
  }
});

uiTest("dashboard answers the main money question on mobile without horizontal overflow", async () => {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true });
  await page.goto(baseUrl, { waitUntil: "networkidle0" });

  const bodyText = await page.locator("body").map((body) => body.innerText).wait();
  assert.match(bodyText, /Am I fine\?/);
  assert.match(bodyText, /Safe to spend\s+EUR 558/);
  assert.match(bodyText, /Safe per day\s+EUR 93\/day/);
  assert.match(bodyText, /Projected savings\s+EUR 1,558/);
  assert.match(bodyText, /Confidence\s+Low\s+Review needed/);
  assert.match(bodyText, /Top category changes/);
  assert.match(bodyText, /Dog\s+EUR 90 above usual/);
  assert.match(bodyText, /Upcoming fixed costs:\s+EUR 620/);
  assert.match(bodyText, /Forecast inputs/);
  assert.match(bodyText, /Fixed costs upcoming\s+EUR 620/);
  assert.match(bodyText, /Formula/);
  assert.match(bodyText, /1 transaction needs review/);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.equal(overflow <= 1, true, `mobile page overflows horizontally by ${overflow}px`);
});

uiTest("mobile navigation uses a compact bottom tab bar", async () => {
  const page = await browser.newPage();
  await page.setViewport({ width: 320, height: 700, deviceScaleFactor: 1, isMobile: true });
  await page.goto(baseUrl, { waitUntil: "networkidle0" });

  const metrics = await page.evaluate(() => {
    const header = document.querySelector("header");
    const tabbar = document.querySelector(".mobile-tabbar");
    const firstHeading = document.querySelector("h1");
    return {
      headerHeight: header?.getBoundingClientRect().height ?? 0,
      headingTop: firstHeading?.getBoundingClientRect().top ?? 0,
      tabbarBottom: tabbar ? Math.round(window.innerHeight - tabbar.getBoundingClientRect().bottom) : null,
      tabbarLabels: tabbar?.textContent?.replace(/\s+/g, " ").trim() ?? "",
      tabbarIconCount: tabbar?.querySelectorAll("svg").length ?? 0,
      desktopNavDisplay: getComputedStyle(document.querySelector(".desktop-nav")).display,
    };
  });
  assert.equal(metrics.headerHeight < 60, true, `mobile header is too tall: ${metrics.headerHeight}px`);
  assert.equal(metrics.headingTop < 130, true, `first heading starts too low: ${metrics.headingTop}px`);
  assert.equal(metrics.tabbarBottom, 0);
  assert.equal(metrics.tabbarLabels, "Today Month Txns Review More");
  assert.equal(metrics.tabbarIconCount, 5);
  assert.equal(metrics.desktopNavDisplay, "none");

  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0" }),
    page.locator(".mobile-tabbar a[href='/more']").click(),
  ]);
  const moreText = await page.locator("body").map((body) => body.innerText).wait();
  assert.match(moreText, /More/);
  assert.match(moreText, /Categories/);
  assert.match(moreText, /Settings/);
  assert.match(moreText, /Sign out/);
  const logoutMetrics = await page.evaluate(() => {
    const form = document.querySelector(".more-logout");
    const button = form?.querySelector("button");
    return {
      formWidth: Math.round(form?.getBoundingClientRect().width ?? 0),
      buttonWidth: Math.round(button?.getBoundingClientRect().width ?? 0),
      buttonHeight: Math.round(button?.getBoundingClientRect().height ?? 0),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  assert.equal(logoutMetrics.overflow <= 1, true, `more page overflows by ${logoutMetrics.overflow}px`);
  assert.equal(Math.abs(logoutMetrics.formWidth - logoutMetrics.buttonWidth) <= 1, true);
  assert.equal(logoutMetrics.buttonHeight <= 78, true, `logout row is too tall: ${logoutMetrics.buttonHeight}px`);
});

uiTest("month page explains forecast drivers on mobile without horizontal overflow", async () => {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true });
  await page.goto(`${baseUrl}/month`, { waitUntil: "networkidle0" });

  const bodyText = await page.locator("body").map((body) => body.innerText).wait();
  assert.match(bodyText, /Month/);
  assert.match(bodyText, /Safe to spend\s+EUR 558/);
  assert.match(bodyText, /Fixed costs\s+EUR 2,070/);
  assert.match(bodyText, /EUR 1,450 paid, EUR 620 upcoming/);
  assert.match(bodyText, /Income status\s+Income received/);
  assert.match(bodyText, /Uncategorized impact\s+EUR 42/);
  assert.match(bodyText, /Category pace/);
  assert.match(bodyText, /Groceries/);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.equal(overflow <= 1, true, `month page overflows horizontally by ${overflow}px`);
});

uiTest("review page keeps action controls usable on narrow screens", async () => {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true });
  await page.goto(`${baseUrl}/review`, { waitUntil: "networkidle0" });

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.equal(overflow <= 1, true, `review page overflows horizontally by ${overflow}px`);
  const bodyText = await page.locator("body").map((body) => body.innerText).wait();
  assert.match(bodyText, /Save and apply similar/);
  const aliasChecked = await page.locator("form.review-form input[name='create_alias']").map((input) => input.checked).wait();
  assert.equal(aliasChecked, true);

  const buttonWidths = await page.$$eval(".review-actions button", (buttons) =>
    buttons.map((button) => {
      const rect = button.getBoundingClientRect();
      const parent = button.parentElement?.getBoundingClientRect();
      return { buttonWidth: rect.width, parentWidth: parent?.width ?? 0 };
    }),
  );
  assert.equal(buttonWidths.length, 3);
  for (const { buttonWidth, parentWidth } of buttonWidths) {
    assert.equal(Math.abs(buttonWidth - parentWidth) <= 1, true);
  }

  const bottomMetrics = await page.evaluate(() => {
    document.querySelector(".review-actions button[name='next']").scrollIntoView({ block: "center" });
    const button = document.querySelector(".review-actions button[name='next']").getBoundingClientRect();
    const tabbar = document.querySelector(".mobile-tabbar").getBoundingClientRect();
    return {
      buttonBottom: Math.round(button.bottom),
      tabbarTop: Math.round(tabbar.top),
    };
  });
  assert.equal(bottomMetrics.buttonBottom < bottomMetrics.tabbarTop, true);
});

uiTest("transactions can be filtered on mobile without horizontal overflow", async () => {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true });
  await page.goto(`${baseUrl}/transactions`, { waitUntil: "networkidle0" });

  const rawHref = await page.$eval(".transaction-actions a[href$='/raw']", (link) => link.href);
  await page.goto(rawHref, { waitUntil: "domcontentloaded" });
  let bodyText = await page.$eval("body", (body) => body.innerText);
  assert.match(bodyText, /Raw transaction data/);
  assert.match(bodyText, /Provider transaction ID/);
  assert.match(bodyText, /"source": "sample"/);
  let overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.equal(overflow <= 1, true, `raw transaction page overflows horizontally by ${overflow}px`);

  await page.goto(`${baseUrl}/transactions`, { waitUntil: "networkidle0" });
  await page.locator(".advanced-filters summary").click();
  await page.select(".advanced-filter-grid select[name='kind']", "excluded");
  await submitFiltersAndWait(page, "kind=excluded", ["Sample Furniture"]);
  bodyText = await page.$eval("body", (body) => body.innerText);
  assert.match(bodyText, /Sample Furniture/);
  assert.match(bodyText, /excluded/);

  await page.goto(`${baseUrl}/transactions`, { waitUntil: "networkidle0" });
  await page.locator(".advanced-filters summary").click();
  await page.select(".advanced-filter-grid select[name='merchant']", "Sample Pet Care");
  await submitFiltersAndWait(page, "merchant=Sample Pet Care", ["Sample Pet Care"]);
  bodyText = await page.$eval("body", (body) => body.innerText);
  assert.match(bodyText, /Sample Pet Care/);

  await page.goto(`${baseUrl}/transactions`, { waitUntil: "networkidle0" });
  await page.locator(".advanced-filters summary").click();
  await page.select(".advanced-filter-grid select[name='kind']", "uncategorized");
  await submitFiltersAndWait(page, "kind=uncategorized", ["Unknown Sample Merchant"]);
  bodyText = await page.$eval("body", (body) => body.innerText);
  assert.match(bodyText, /Unknown Sample Merchant/);

  await page.goto(`${baseUrl}/transactions`, { waitUntil: "networkidle0" });
  await page.locator(".transaction-filters input[name='q']").fill("supermarket");
  await submitFiltersAndWait(page, "q=supermarket", ["Sample Supermarket"]);

  bodyText = await page.$eval("body", (body) => body.innerText);
  assert.match(bodyText, /Sample Supermarket/);

  await page.$eval(".transaction-edit", (details) => {
    details.open = true;
  });
  await page.select(".transaction-edit-form select[name='category']", "Shopping");
  await page.locator(".transaction-edit-form input[name='merchant']").fill("Sample Edited Shop");
  await page.$eval(".transaction-edit-form input[name='is_excluded_from_budget']", (input) => {
    input.checked = true;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await Promise.all([
    page.waitForResponse(
      (response) => response.url().includes("/transactions?q=supermarket") && response.status() === 200,
    ),
    page.$eval(".transaction-edit-form", (form) => form.requestSubmit()),
  ]);
  await page.waitForFunction(() => document.body.innerText.includes("Sample Edited Shop"), { timeout: 5000 });
  bodyText = await page.evaluate(() => document.body.innerText);
  assert.match(bodyText, /Sample Edited Shop/);
  assert.match(bodyText, /Shopping/);
  assert.match(bodyText, /excluded/);

  overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.equal(overflow <= 1, true, `transactions page overflows horizontally by ${overflow}px`);
});

uiTest("desktop transactions render as dense ledger rows", async () => {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await page.goto(`${baseUrl}/transactions`, { waitUntil: "domcontentloaded" });

  const metrics = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".transaction-card")].map((row) =>
      Math.round(row.getBoundingClientRect().height),
    );
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      rowCount: rows.length,
      maxRowHeight: Math.max(...rows),
      firstRowActions: document.querySelector(".transaction-actions")?.getBoundingClientRect().height ?? 0,
      tabbarDisplay: getComputedStyle(document.querySelector(".mobile-tabbar")).display,
    };
  });

  assert.equal(metrics.overflow <= 1, true, `desktop transactions page overflows by ${metrics.overflow}px`);
  assert.equal(metrics.rowCount >= 7, true);
  assert.equal(metrics.maxRowHeight <= 74, true, `desktop rows are too tall: ${metrics.maxRowHeight}px`);
  assert.equal(metrics.firstRowActions <= 28, true, `desktop row actions wrapped: ${metrics.firstRowActions}px`);
  assert.equal(metrics.tabbarDisplay, "none");
});

uiTest("categories show budget averages on mobile without horizontal overflow", async () => {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true });
  await page.goto(`${baseUrl}/categories`, { waitUntil: "networkidle0" });

  const bodyText = await page.locator("body").map((body) => body.innerText).wait();
  assert.match(bodyText, /Categories/);
  assert.match(bodyText, /Groceries/);
  assert.match(bodyText, /EUR 64\.35/);
  assert.match(bodyText, /Suggested/);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.equal(overflow <= 1, true, `categories page overflows horizontally by ${overflow}px`);
});

uiTest("settings expose forecast and llm controls on mobile", async () => {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true });
  await page.goto(`${baseUrl}/settings`, { waitUntil: "networkidle0" });

  const bodyText = await page.locator("body").map((body) => body.innerText).wait();
  assert.match(bodyText, /Settings/);
  assert.match(bodyText, /Current liquid balance/);
  assert.match(bodyText, /Salary day/);
  assert.match(bodyText, /Baseline months/);
  assert.match(bodyText, /Sync lookback days/);
  assert.match(bodyText, /Accounts/);
  assert.match(bodyText, /Sample current account/);
  assert.match(bodyText, /Category taxonomy/);
  assert.match(bodyText, /22 categories/);
  assert.match(bodyText, /Sync schedule/);
  assert.match(bodyText, /Manual sync/);
  assert.match(bodyText, /LLM fallback/);
  assert.match(bodyText, /LLM confidence threshold/);

  const controls = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    hasSwitch: document.querySelector("input[name='llm_enabled'][role='switch']") !== null,
    salaryDay: document.querySelector("input[name='salary_day']")?.value,
    baselineMonths: document.querySelector("input[name='baseline_months']")?.value,
    syncLookbackDays: document.querySelector("input[name='sync_lookback_days']")?.value,
    thresholdValue: document.querySelector("input[name='llm_confidence_threshold']")?.value,
  }));
  assert.equal(controls.overflow <= 1, true, `settings page overflows horizontally by ${controls.overflow}px`);
  assert.equal(controls.hasSwitch, true);
  assert.equal(controls.salaryDay, "24");
  assert.equal(controls.baselineMonths, "6");
  assert.equal(controls.syncLookbackDays, "90");
  assert.equal(controls.thresholdValue, "0.60");

  const bottomMetrics = await page.evaluate(() => {
    document.querySelector(".settings-form button[type='submit']").scrollIntoView({ block: "center" });
    const button = document.querySelector(".settings-form button[type='submit']").getBoundingClientRect();
    const tabbar = document.querySelector(".mobile-tabbar").getBoundingClientRect();
    return {
      buttonBottom: Math.round(button.bottom),
      tabbarTop: Math.round(tabbar.top),
    };
  });
  assert.equal(bottomMetrics.buttonBottom < bottomMetrics.tabbarTop, true);
});

uiTest("status page summarizes setup on mobile without exposing secrets", async () => {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true });
  await page.goto(`${baseUrl}/status`, { waitUntil: "networkidle0" });

  const bodyText = await page.locator("body").map((body) => body.innerText).wait();
  assert.match(bodyText, /Status/);
  assert.match(bodyText, /App version\s+0\.1\.0/);
  assert.match(bodyText, /Migration version\s+0004_classification_runtime/);
  assert.match(bodyText, /Last sync\s+completed/);
  assert.match(bodyText, /Last forecast update\s+2026-05/);
  assert.match(bodyText, /LLM model\s+unsloth\/gemma-4-E4B-it-GGUF/);
  assert.doesNotMatch(bodyText, /SECRET_KEY|ABN_SOFT_TOKEN|OIDC_CLIENT_SECRETS/);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.equal(overflow <= 1, true, `status page overflows horizontally by ${overflow}px`);
});

uiTest("export flow generates and downloads an xlsx on mobile", async () => {
  const page = await browser.newPage();
  const downloadPath = mkdtempSync(join(tmpdir(), "treasuri-export-"));
  const client = await page.target().createCDPSession();
  await client.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath });
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true });
  await page.goto(`${baseUrl}/export`, { waitUntil: "networkidle0" });

  let bodyText = await page.locator("body").map((body) => body.innerText).wait();
  assert.match(bodyText, /Export/);
  assert.match(bodyText, /No exports yet/);

  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0" }),
    page.locator(".export-action button[type='submit']").click(),
  ]);
  bodyText = await waitForExportCompletion(page);
  assert.match(bodyText, /budget-averages-2026-05\.xlsx/);
  assert.match(bodyText, /completed/);

  const metrics = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    downloadCount: document.querySelectorAll("a[href^='/export/files/']").length,
  }));
  assert.equal(metrics.overflow <= 1, true, `export page overflows horizontally by ${metrics.overflow}px`);
  assert.equal(metrics.downloadCount, 1);

  await page.locator("a[href^='/export/files/']").click();
  const downloaded = await waitForDownloadedFile(downloadPath, "budget-averages-2026-05.xlsx");
  const signature = readFileSync(downloaded).subarray(0, 2).toString("utf8");
  assert.equal(signature, "PK");
});

uiTest("recurring commitments can be confirmed and disabled on mobile", async () => {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true });
  await page.goto(`${baseUrl}/recurring`, { waitUntil: "networkidle0" });

  let bodyText = await page.locator("body").map((body) => body.innerText).wait();
  assert.match(bodyText, /Recurring/);
  assert.match(bodyText, /Sample Streaming/);
  assert.match(bodyText, /detected/);
  assert.match(bodyText, /New recurring payment detected/);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.equal(overflow <= 1, true, `recurring page overflows horizontally by ${overflow}px`);

  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0" }),
    page.locator(".recurring-actions form[action$='/confirm'] button").click(),
  ]);
  bodyText = await page.locator("body").map((body) => body.innerText).wait();
  assert.match(bodyText, /confirmed/);

  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0" }),
    page.locator(".recurring-actions form[action$='/disable'] button").click(),
  ]);
  bodyText = await page.locator("body").map((body) => body.innerText).wait();
  assert.match(bodyText, /No recurring payments detected/);
});

uiTest("review correction previews a reusable rule before showing it in the rules list", async () => {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`${baseUrl}/review`, { waitUntil: "networkidle0" });

  await page.select("form.review-form select[name='category']", "Groceries");
  await page.locator("form.review-form input[name='merchant']").fill("Sample Review Merchant");
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0" }),
    page.locator("form.review-form button[name='next']").click(),
  ]);

  const previewText = await page.locator("body").map((body) => body.innerText).wait();
  assert.match(previewText, /Rule preview/);
  assert.match(previewText, /Classify Unknown Sample Merchant/);
  assert.match(previewText, /Category\s+Groceries/);
  assert.match(previewText, /Merchant\s+Sample Review Merchant/);
  assert.match(previewText, /Manual overrides skipped\s+1/);

  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0" }),
    page.locator(".rule-preview button[type='submit']").click(),
  ]);
  const rulesText = await page.locator("body").map((body) => body.innerText).wait();
  assert.match(rulesText, /Rules/);
  assert.match(rulesText, /Classify Unknown Sample Merchant/);
  assert.match(rulesText, /Would change\s+0/);

  await page.locator("details.rule-editor > summary").click();
  await page.locator("form.rule-form input[name='name']").fill("Classify one-off purchases");
  await page.locator("form.rule-form input[name='pattern']").fill("Large one-off sample purchase");
  await page.select("form.rule-form select[name='category']", "Shopping");
  await page.locator("form.rule-form input[name='set_is_excluded_from_budget']").click();
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0" }),
    page.locator("form.rule-form button[type='submit']").click(),
  ]);
  const createdRuleText = await page.locator("body").map((body) => body.innerText).wait();
  assert.match(createdRuleText, /Classify one-off purchases/);
  assert.match(createdRuleText, /Flags\s+excluded/);
});

uiTest("pwa is installable and caches an offline dashboard summary shell", async () => {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true });
  await page.goto(baseUrl, { waitUntil: "networkidle0" });
  const expectedSummary = await page.$eval("#treasuri-offline-summary", (script) => JSON.parse(script.textContent));

  const manifest = await page.evaluate(async () => {
    const response = await fetch("/static/site.webmanifest");
    return response.json();
  });
  assert.equal(manifest.name, "Treasuri");
  assert.equal(manifest.display, "standalone");
  assert.deepEqual(manifest.icons, [
    {
      src: "/static/icons/icon.svg",
      sizes: "any",
      type: "image/svg+xml",
      purpose: "any maskable",
    },
  ]);

  const client = await page.target().createCDPSession();
  const installability = await withTimeout(
    client.send("Page.getInstallabilityErrors"),
    5000,
    "installability check timed out",
  );
  assert.deepEqual(installability.installabilityErrors, []);

  await page.waitForFunction(
    async () => {
      const registrations = await navigator.serviceWorker.getRegistrations();
      return registrations.some((registration) => registration.active);
    },
    { timeout: 5000 },
  );
  await page.reload({ waitUntil: "networkidle0", timeout: 10000 });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, { timeout: 5000 });

  const hasOfflineShell = await page.evaluate(async () => Boolean(await caches.match("/static/offline.html")));
  assert.equal(hasOfflineShell, true);

  await page.goto(`${baseUrl}/static/offline.html`, { waitUntil: "domcontentloaded", timeout: 10000 });
  await page.waitForFunction(() => document.body?.innerText.length > 0, { timeout: 5000 });
  const bodyText = await page.$eval("body", (body) => body.innerText);
  assert.match(bodyText, /Treasuri is offline/);
  assert.match(bodyText, /Last known dashboard summary/);
  assert.match(bodyText, new RegExp(`Safe to spend\\s+${escapeRegExp(expectedSummary.safe_to_spend)}`));
  assert.match(bodyText, new RegExp(`Safe per day\\s+${escapeRegExp(expectedSummary.safe_per_day)}`));
  assert.match(
    bodyText,
    new RegExp(
      `Confidence\\s+${escapeRegExp(expectedSummary.confidence)}\\s+${escapeRegExp(expectedSummary.confidence_note)}`,
    ),
  );
  assert.doesNotMatch(bodyText, /Sample Supermarket/);
});

function uiTest(name, run) {
  nodeTest(name, { timeout: 60000 }, async () => {
    const existingPages = new Set(openPages);
    try {
      await run();
    } catch (error) {
      await captureFailureArtifacts(name, error);
      throw error;
    } finally {
      await closeNewPages(existingPages);
    }
  });
}

function trackPages(activeBrowser) {
  const originalNewPage = activeBrowser.newPage.bind(activeBrowser);
  activeBrowser.newPage = async () => {
    const page = await originalNewPage();
    openPages.add(page);
    page.once("close", () => openPages.delete(page));
    return page;
  };
}

async function captureFailureArtifacts(testName, error) {
  const outputDirectory = process.env.E2E_ARTIFACT_DIR || join(tmpdir(), "treasuri-e2e-artifacts");
  mkdirSync(outputDirectory, { recursive: true });
  const slug = testName.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  const errorPath = join(outputDirectory, `${slug}.txt`);
  writeFileSync(errorPath, error?.stack || String(error), "utf8");

  let index = 0;
  for (const page of openPages) {
    if (page.isClosed()) {
      continue;
    }
    const screenshotPath = join(outputDirectory, `${slug}-${index}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    index += 1;
  }
  console.error(`Saved E2E failure artifacts for "${testName}" in ${outputDirectory}`);
}

async function transactionTitles(page) {
  return page.$$eval(".transaction-card h2", (titles) => titles.map((title) => title.innerText.trim()));
}

async function submitFiltersAndWait(page, expectedUrlPart, expectedTitles) {
  await Promise.all([
    page.waitForResponse(
      (response) => decodeURIComponent(response.url()).includes(expectedUrlPart) && response.status() === 200,
    ),
    page.locator(".transaction-filters button[type='submit']").click(),
  ]);
  await page.waitForFunction(
    (titles) =>
      JSON.stringify([...document.querySelectorAll(".transaction-card h2")].map((title) => title.innerText.trim())) ===
      JSON.stringify(titles),
    {},
    expectedTitles,
  );
  assert.deepEqual(await transactionTitles(page), expectedTitles);
  assert.equal(decodeURIComponent(new URL(page.url()).search).includes(expectedUrlPart), true);
}

async function closeNewPages(existingPages) {
  const pagesToClose = [...openPages].filter((page) => !existingPages.has(page) && !page.isClosed());
  await Promise.all(
    pagesToClose.map(async (page) => {
      try {
        await page.close();
      } catch {
        // Browser shutdown will clean up pages that are already gone.
      }
    }),
  );
}

async function startSampleServer() {
  const child = spawn("uv", ["run", "python", "-m", "e2e.support.sample_server"], {
    cwd: new URL("../..", import.meta.url),
    stdio: ["pipe", "pipe", "inherit"],
  });
  const lines = readline.createInterface({ input: child.stdout });
  try {
    for await (const line of lines) {
      if (!line.startsWith("E2E_SERVER_READY ")) {
        continue;
      }
      const payload = JSON.parse(line.slice("E2E_SERVER_READY ".length));
      return { process: child, url: payload.url };
    }
  } finally {
    lines.close();
  }
  throw new Error("sample server exited before reporting readiness");
}

function findChromeExecutable() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  for (const command of ["google-chrome", "chromium", "chromium-browser"]) {
    const result = spawnSync("which", [command], { encoding: "utf8" });
    if (result.status === 0) {
      return result.stdout.trim();
    }
  }
  throw new Error("Set PUPPETEER_EXECUTABLE_PATH or install google-chrome/chromium");
}

function withTimeout(promise, timeoutMs, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function waitForDownloadedFile(downloadPath, filename) {
  const target = join(downloadPath, filename);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (existsSync(target) && !readdirSync(downloadPath).some((entry) => entry.endsWith(".crdownload"))) {
      return target;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Download did not finish: ${filename}`);
}

async function waitForExportCompletion(page) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const bodyText = await page.$eval("body", (body) => body.innerText);
    if (bodyText.includes("budget-averages-2026-05.xlsx") && bodyText.includes("completed")) {
      return bodyText;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
    await page.reload({ waitUntil: "networkidle0" });
  }
  throw new Error("Export did not complete through the worker");
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve();
    }, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
