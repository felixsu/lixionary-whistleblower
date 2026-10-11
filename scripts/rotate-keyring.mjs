import { readFile, writeFile, rename } from "node:fs/promises";
import { randomBytes } from "node:crypto";
const [path, id] = process.argv.slice(2);
if (!path || !/^[A-Za-z0-9_-]{1,40}$/.test(id ?? ""))
  throw new Error("Usage: rotate-keyring.mjs KEYRING_FILE NEW_KEY_ID");
const ring = JSON.parse(await readFile(path, "utf8"));
if (ring.keys[id]) throw new Error("New key ID must be unique");
ring.keys[id] = randomBytes(32).toString("base64");
ring.active = id;
const temp = `${path}.new`;
await writeFile(temp, JSON.stringify(ring), { mode: 0o600, flag: "wx" });
await rename(temp, path);
console.log(
  "Active encryption key changed. Old keys preserved for re-encryption and retained backups.",
);
