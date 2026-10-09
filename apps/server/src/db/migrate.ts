import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { loadEnvFiles } from "../lib/env.js";
import { createDb } from "./client.js";

export const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "migrations");

export async function runMigrations(url: string): Promise<void> {
  const { db, close } = createDb(url);
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  } finally {
    await close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  loadEnvFiles();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  await runMigrations(url);
  console.log("Migrations applied.");
}
