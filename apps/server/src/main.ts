import { loadEnvFiles } from "./lib/env.js";
import { loadConfig } from "./config.js";
import { createDb } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";
import { createMinimaxClient } from "./ai/minimax.js";
import { createDiskStorage } from "./lib/storage.js";
import { createMailer } from "./notify/mailer.js";
import { startBackgroundJobs } from "./notify/outbox.js";
import { buildApp } from "./app.js";

loadEnvFiles();
const config = loadConfig();

await runMigrations(config.databaseUrl);
const { db, close } = createDb(config.databaseUrl);
const ai = createMinimaxClient(config.ai);
const storage = createDiskStorage(config.uploadDir);
const app = await buildApp({ config, db, ai, storage });

const mailer = createMailer(config.mail, (msg) => app.log.info(msg));
const stopJobs = startBackgroundJobs({ db, mailer, storage, webUrl: config.publicWebUrl, log: app.log });

if (!ai.enabled) app.log.warn("MINIMAX_API_KEY is not set: the AI assistant is disabled and reporters will use the form.");

const shutdown = async () => {
  stopJobs();
  await app.close();
  await close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ host: config.host, port: config.port });
