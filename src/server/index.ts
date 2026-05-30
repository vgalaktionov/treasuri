import { createApp } from "./http/app.ts";

const host = process.env.HTTP_HOST ?? "127.0.0.1";
const port = Number(process.env.HTTP_PORT ?? "5174");

if (!Number.isInteger(port) || port <= 0) {
  throw new Error("HTTP_PORT must be a positive integer");
}

const server = createApp().listen(port, host, () => {
  console.log(`treasuri listening on http://${host}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      process.exit(0);
    });
  });
}
