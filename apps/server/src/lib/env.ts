import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Loads the repo-root .env (then an app-local one) without overriding real env vars. */
export function loadEnvFiles(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, "../../../../.env"),
    resolve(here, "../../.env"),
  ];
  for (const file of candidates) {
    if (existsSync(file)) process.loadEnvFile(file);
  }
}
