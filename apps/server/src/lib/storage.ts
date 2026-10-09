import { createReadStream } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";

/** Evidence files on local disk, outside any web root. Keys are random UUIDs, never user input. */
export interface Storage {
  save(data: Buffer): Promise<string>;
  read(key: string): Readable;
  remove(key: string): Promise<void>;
}

export function createDiskStorage(dir: string): Storage {
  const pathFor = (key: string) => {
    if (!/^[0-9a-f-]{36}$/.test(key)) throw new Error("invalid storage key");
    return join(dir, key);
  };
  return {
    async save(data) {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const key = randomUUID();
      await writeFile(pathFor(key), data, { mode: 0o600 });
      return key;
    },
    read: (key) => createReadStream(pathFor(key)),
    remove: (key) => rm(pathFor(key), { force: true }),
  };
}
