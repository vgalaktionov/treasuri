const command = process.argv[2];

if (!command) {
  console.log("Available admin commands: seed-categories, load-sample-data, sync-now");
  process.exit(0);
}

throw new Error(`Admin command is not implemented yet: ${command}`);
