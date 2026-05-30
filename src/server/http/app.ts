import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const clientDist = path.join(repoRoot, "dist/client");

export function createApp() {
  const app = express();

  app.get("/healthz", (_request, response) => {
    response.json({ status: "ok" });
  });

  app.use(express.static(clientDist, { index: false }));

  app.get(/.*/, (_request, response) => {
    response.sendFile(path.join(clientDist, "index.html"));
  });

  return app;
}
