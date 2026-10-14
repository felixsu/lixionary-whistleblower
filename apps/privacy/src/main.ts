import { postgresLimiter, safeError } from "@whistle/runtime";
import { loadConfig } from "./config.js";
import { createDb } from "./db/client.js";
import { buildApp } from "./app.js";
import { startJobs } from "./jobs.js";
const config = loadConfig();
const { db, close } = createDb(config.dbUrl);
const app = await buildApp({
  db,
  config,
  limiter: postgresLimiter((query) => db.execute(query)),
});
const stop = startJobs(db, config, app.log);
let shuttingDown = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    const timeout = setTimeout(() => process.exit(1), 175000);
    void (async () => {
      const drained = stop();
      await app.close();
      await drained;
      await close();
    })()
      .catch((e) => {
        console.error(safeError(e));
        process.exitCode = 1;
      })
      .finally(() => clearTimeout(timeout));
  });
await app.listen({ host: config.host, port: config.port });
