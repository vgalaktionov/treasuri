import { loadConfig } from "./config/env.ts";
import { createApp } from "./http/app.ts";

const config = loadConfig();
const { host, port } = config.http;

if (!Number.isInteger(port) || port <= 0) {
  throw new Error("HTTP_PORT must be a positive integer");
}

const server = createApp(config).listen(port, host, () => {
  console.log(`treasuri listening on http://${host}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      process.exit(0);
    });
  });
}
