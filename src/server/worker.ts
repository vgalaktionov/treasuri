console.log("treasuri worker placeholder started");

const interval = setInterval(() => {
  // Jobs are wired in a later PRD v2 slice.
}, 60_000);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    clearInterval(interval);
    process.exit(0);
  });
}
