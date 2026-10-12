import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  writeFile,
  readFile,
  rm,
  chmod,
  mkdir,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, createCipheriv } from "node:crypto";
import { spawnSync } from "node:child_process";
import { verifyBackup, extractSourceArchive } from "../deploy-vps.mjs";

const cli = new URL("../deploy-vps.mjs", import.meta.url);
const helper = new URL("../deployment-backup.py", import.meta.url);

async function fixture(fn) {
  const folder = await mkdtemp(join(tmpdir(), "wb-deploy-test-"));
  try {
    await fn(folder);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

test("Git source modes survive the private umask without opening the release directory", async () => {
  await fixture(async (folder) => {
    const tracked = join(folder, "tracked"),
      source = join(folder, "source"),
      archive = join(folder, "source.tar");
    await mkdir(tracked, { mode: 0o755 });
    await mkdir(source, { mode: 0o700 });
    await writeFile(join(tracked, "package.json"), "{}", { mode: 0o644 });
    await chmod(join(tracked, "package.json"), 0o644);
    assert.equal(
      spawnSync("tar", ["-cf", archive, "-C", tracked, "package.json"]).status,
      0,
    );
    const previous = process.umask(0o077);
    try {
      await extractSourceArchive(archive, source);
    } finally {
      process.umask(previous);
    }
    assert.equal(
      (await stat(join(source, "package.json"))).mode & 0o777,
      0o644,
    );
    assert.equal((await stat(source)).mode & 0o777, 0o700);
  });
});

test("backup authentication rejects tampering, wrong keys and truncation", async () => {
  await fixture(async (folder) => {
    const key = randomBytes(32),
      nonce = randomBytes(12);
    const header = Buffer.concat([Buffer.from("WBDEPLOY1\n"), nonce]);
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(header);
    const archive = Buffer.concat([
      header,
      cipher.update(Buffer.alloc(3 * 1024 * 1024, 7)),
      cipher.final(),
      cipher.getAuthTag(),
    ]);
    const payload = join(folder, "snapshot.wbenc"),
      secret = join(folder, "recovery.key");
    await writeFile(payload, archive);
    await writeFile(secret, key);
    await verifyBackup(payload, secret);
    await writeFile(secret, randomBytes(32));
    await assert.rejects(verifyBackup(payload, secret));
    await writeFile(secret, key);
    archive[header.length + 10] ^= 1;
    await writeFile(payload, archive);
    await assert.rejects(verifyBackup(payload, secret));
    await writeFile(payload, archive.subarray(0, 12));
    await assert.rejects(verifyBackup(payload, secret));
  });
});

test("Python snapshots interoperate with Node and never publish unauthenticated plaintext", async () => {
  const python = spawnSync("python3", ["-c", "import cryptography"]);
  if (python.status !== 0)
    throw new Error(
      "Install Python cryptography to run snapshot integration tests",
    );
  await fixture(async (folder) => {
    const source = join(folder, "source"),
      archive = join(folder, "backup.wbenc"),
      key = join(folder, "recovery.key"),
      tar = join(folder, "recovered.tar");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(source));
    await writeFile(
      join(source, "synthetic.dump"),
      "synthetic snapshot payload",
    );
    let r = spawnSync("python3", [
      helper.pathname,
      "encrypt",
      source,
      archive,
      key,
    ]);
    assert.equal(r.status, 0);
    await verifyBackup(archive, key);
    r = spawnSync("python3", [helper.pathname, "decrypt", archive, key, tar]);
    assert.equal(r.status, 0);
    r = spawnSync("tar", ["-xOf", tar, "./synthetic.dump"], {
      encoding: "utf8",
    });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "synthetic snapshot payload");
    const tampered = await readFile(archive);
    tampered[tampered.length - 1] ^= 1;
    await writeFile(archive, tampered);
    const untrusted = join(folder, "untrusted.tar");
    r = spawnSync("python3", [
      helper.pathname,
      "decrypt",
      archive,
      key,
      untrusted,
    ]);
    assert.notEqual(r.status, 0);
    await assert.rejects(readFile(untrusted));
    assert.equal((await readFile(tar)).length > 0, true);
  });
});

test("deployment refuses uncommitted work before Docker or SSH can run", async () => {
  await fixture(async (folder) => {
    const git = join(folder, "git"),
      touched = join(folder, "external-command");
    await writeFile(
      git,
      `#!/bin/sh\ncase "$1" in branch) echo main;; rev-parse) echo ${"a".repeat(40)};; status) echo ' M apps/server/src/main.ts';; *) exit 1;; esac\n`,
    );
    await chmod(git, 0o700);
    for (const command of ["docker", "ssh", "pnpm"]) {
      const path = join(folder, command);
      await writeFile(
        path,
        `#!/bin/sh\nprintf attempted > '${touched}'\nexit 1\n`,
      );
      await chmod(path, 0o700);
    }
    const r = spawnSync(process.execPath, [cli.pathname], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${folder}:${process.env.PATH}` },
    });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /Working tree is dirty/);
    await assert.rejects(readFile(touched));
  });
});
