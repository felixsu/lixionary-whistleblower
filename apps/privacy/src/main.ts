import { createClient } from "redis";
import { redisLimiter } from "@whistle/runtime";
import { loadConfig } from "./config.js";
import { createDb } from "./db/client.js";
import { buildApp } from "./app.js";
const config = loadConfig();
const { db, close } = createDb(config.dbUrl),
  redis = createClient({ url: config.redisUrl });
redis.on("error", () => console.error("private rate limit store unavailable"));
await redis.connect();
const app = await buildApp({ db, config, limiter: redisLimiter(redis) });
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    void Promise.all([app.close(), close(), redis.quit()]);
  });
await app.listen({ host: config.host, port: config.port });
