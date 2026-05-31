import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../../..");

describe("PWA assets", () => {
  it("declares installable root-scope metadata", () => {
    const manifest = JSON.parse(read("public/manifest.webmanifest"));

    expect(manifest.name).toBe("Treasuri");
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.icons[0].src).toBe("/icons/icon.svg");
  });

  it("keeps the offline shell free of transaction detail", () => {
    const offline = read("public/offline.html").toLowerCase();

    expect(offline).toContain("reconnect");
    expect(offline).not.toContain("transaction history");
    expect(offline).not.toContain("jumbo");
    expect(offline).not.toContain("iban");
  });

  it("does not cache API responses in the service worker", () => {
    const serviceWorker = read("public/service-worker.js");

    expect(serviceWorker).toContain('url.pathname.startsWith("/api/")');
    expect(serviceWorker).toContain("/offline.html");
    expect(serviceWorker).not.toContain("/api/dashboard");
    expect(serviceWorker).not.toContain("/api/transactions");
  });
});

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}
