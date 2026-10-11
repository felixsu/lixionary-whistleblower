import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { fileURLToPath } from "node:url";
export async function runMigrations(url: string) {
  const c = postgres(url, { max: 1 });
  try {
    await migrate(drizzle(c), {
      migrationsFolder: fileURLToPath(
        new URL("./migrations/", import.meta.url),
      ),
    });
  } finally {
    await c.end();
  }
}
if (import.meta.url === `file://${process.argv[1]}`) {
  if (!process.env.MIGRATION_DATABASE_URL)
    throw new Error(
      "MIGRATION_DATABASE_URL required; runtime must not own schema",
    );
  await runMigrations(process.env.MIGRATION_DATABASE_URL);
}
