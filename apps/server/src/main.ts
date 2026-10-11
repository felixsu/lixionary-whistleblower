import { createClient } from "redis";
import { redisLimiter, safeError } from "@whistle/runtime";
import { loadEnvFiles } from "./lib/env.js";
import { loadConfig } from "./config.js";
import { sql } from "drizzle-orm";
import { createDb, rows } from "./db/client.js";
import { buildApp } from "./app.js";
import { startJobs } from "./jobs.js";
loadEnvFiles();
const config = loadConfig();
const { db, close } = createDb(config.dbUrl);
const redis = createClient({ url: config.redisUrl });
redis.on("error", () => console.error("rate limit store unavailable"));
await redis.connect();
const app = await buildApp({ config, db, limiter: redisLimiter(redis) });
app.get("/api/health", async () => {
  await redis.ping();
  await rows(db, sql`select 1`);
  return { ok: true };
});
const stop = startJobs(db, config, app.log);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    void (async () => {
      stop();
      await app.close();
      await close();
      await redis.quit();
    })().catch((e) => {
      console.error(safeError(e));
      process.exitCode = 1;
    });
  });
await app.listen({ host: config.host, port: config.port });
