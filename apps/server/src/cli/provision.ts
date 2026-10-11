import postgres from "postgres";
import { readFileSync } from "node:fs";
import { runMigrations } from "../db/migrate.js";
const privateService = false;
function secret(name: string) {
  const path = process.env[`${name}_FILE`];
  const v = path ? readFileSync(path, "utf8").trim() : process.env[name];
  if (!v) throw new Error(`${name} required`);
  return v;
}
const migration = secret("MIGRATION_DATABASE_URL"),
  runtime = secret(
    privateService ? "PRIVACY_DATABASE_URL" : "SUITE_DATABASE_URL",
  );
const url = new URL(runtime),
  role = url.username;
if (!["wb_case", "wb_private"].includes(role))
  throw new Error("Unexpected runtime role");
await runMigrations(migration);
const owner = postgres(migration, { max: 1, onnotice: () => {} });
try {
  await owner.begin(async (tx) => {
    const exists = await tx`select rolname from pg_roles where rolname=${role}`;
    const escapedPassword = decodeURIComponent(url.password).replaceAll(
      "'",
      "''",
    );
    if (!exists.length)
      await tx.unsafe(
        `CREATE ROLE ${role} LOGIN PASSWORD '${escapedPassword}'`,
      );
    await tx.unsafe(
      `GRANT CONNECT ON DATABASE ${url.pathname.slice(1)} TO ${role}`,
    );
    await tx.unsafe(`GRANT USAGE ON SCHEMA public TO ${role}`);
    await tx.unsafe(
      `GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO ${role}`,
    );
    await tx.unsafe(
      `GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`,
    );
    if (!privateService) {
      await tx.unsafe(`REVOKE UPDATE,DELETE ON audit_events FROM ${role}`);
      await tx.unsafe(
        `REVOKE INSERT,UPDATE,DELETE ON audit_anchors FROM ${role}`,
      );
    }
  });
  console.log("Migrations and runtime permissions applied.");
} finally {
  await owner.end();
}
