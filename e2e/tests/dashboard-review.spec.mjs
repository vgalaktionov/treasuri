import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { after, before, test } from "node:test";
import readline from "node:readline";
import puppeteer from "puppeteer-core";

let serverProcess;
let baseUrl;
let browser;

before(async () => {
  ({ process: serverProcess, url: baseUrl } = await startSampleServer());
  browser = await puppeteer.launch({
    executablePath: findChromeExecutable(),
    headless: true,
    args: ["--no-sandbox", "--disable-gpu"],
  });
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

test("dashboard answers the main money question on mobile without horizontal overflow", async () => {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true });
  await page.goto(baseUrl, { waitUntil: "networkidle0" });

  const bodyText = await page.locator("body").map((body) => body.innerText).wait();
  assert.match(bodyText, /Am I fine\?/);
  assert.match(bodyText, /Safe to spend\s+EUR 558/);
  assert.match(bodyText, /Safe per day\s+EUR 93\/day/);
  assert.match(bodyText, /Projected savings\s+EUR 1,558/);
  assert.match(bodyText, /Forecast inputs/);
  assert.match(bodyText, /Fixed costs upcoming\s+EUR 620/);
  assert.match(bodyText, /Formula/);
  assert.match(bodyText, /1 transaction needs review/);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.equal(overflow <= 1, true, `mobile page overflows horizontally by ${overflow}px`);
});

test("month page explains forecast drivers on mobile without horizontal overflow", async () => {
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

test("review page keeps action controls usable on narrow screens", async () => {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true });
  await page.goto(`${baseUrl}/review`, { waitUntil: "networkidle0" });

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.equal(overflow <= 1, true, `review page overflows horizontally by ${overflow}px`);

  const buttonWidths = await page.$$eval(".review-actions button", (buttons) =>
    buttons.map((button) => {
      const rect = button.getBoundingClientRect();
      const parent = button.parentElement?.getBoundingClientRect();
      return { buttonWidth: rect.width, parentWidth: parent?.width ?? 0 };
    }),
  );
  assert.equal(buttonWidths.length, 2);
  for (const { buttonWidth, parentWidth } of buttonWidths) {
    assert.equal(Math.abs(buttonWidth - parentWidth) <= 1, true);
  }
});

test("transactions can be filtered on mobile without horizontal overflow", async () => {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true });
  await page.goto(`${baseUrl}/transactions`, { waitUntil: "networkidle0" });

  await page.locator(".transaction-filters input[name='q']").fill("supermarket");
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0" }),
    page.locator(".transaction-filters button[type='submit']").click(),
  ]);

  const bodyText = await page.locator("body").map((body) => body.innerText).wait();
  assert.match(bodyText, /Sample Supermarket/);
  assert.doesNotMatch(bodyText, /Sample Employer/);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.equal(overflow <= 1, true, `transactions page overflows horizontally by ${overflow}px`);
});

test("categories show budget averages on mobile without horizontal overflow", async () => {
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

test("review correction previews a reusable rule before showing it in the rules list", async () => {
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
});

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
