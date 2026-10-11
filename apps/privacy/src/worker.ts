import { loadConfig } from "./config.js";
import { createDb } from "./db/client.js";
import { startJobs } from "./jobs.js";
const config = loadConfig(),
  { db, close } = createDb(config.dbUrl);
const stop = startJobs(db, config, {
  error: () => console.error("private background operation failed"),
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    stop();
    void close().finally(() => process.exit(0));
  });
// Worker timers are unreferenced so keep the dedicated process running.
setInterval(() => {}, 60000);
