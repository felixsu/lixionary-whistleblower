import { randomBytes } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
await mkdir(".suite-dev", { recursive: true, mode: 0o700 });
let password;
try {
  password = (await readFile(".suite-dev/postgres.env", "utf8"))
    .split("POSTGRES_PASSWORD=")[1]
    .trim();
} catch {
  password = randomBytes(32).toString("hex");
  await writeFile(
    ".suite-dev/postgres.env",
    `POSTGRES_PASSWORD=${password}\n`,
    { mode: 0o600 },
  );
}
await writeFile(
  ".suite-dev/test-database-url",
  `postgres://postgres:${password}@127.0.0.1:6412/postgres`,
  { mode: 0o600 },
);
