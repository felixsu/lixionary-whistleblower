import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  chmod,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), "wb-zoho-config-"));
  try {
    await mkdir(join(root, "secrets"));
    await mkdir(join(root, "bin"));
    await writeFile(
      join(root, "suite.env"),
      "SUITE_NODE_ENV=production\nPUBLIC_WEB_URL=https://whistle-blower.lixionary.com\nUNRELATED_SETTING=preserve-me\nTWILIO_FROM=\n",
      { mode: 0o600 },
    );
    await writeFile(
      join(root, "secrets/zoho_api_key"),
      "synthetic-credential",
      { mode: 0o600 },
    );
    await writeFile(
      join(root, "bin/ssh"),
      `#!/usr/bin/env python3
import os,subprocess,sys
script=sys.stdin.read().replace('/app/lixionary-whistleblower/.suite-config',os.environ['WB_CONFIG_TEST_ROOT'])
raise SystemExit(subprocess.run(['python3','-c',script]).returncode)
`,
    );
    await chmod(join(root, "bin/ssh"), 0o700);
    const run = (...args) =>
      spawnSync(
        process.execPath,
        [
          new URL("../configure-zoho-vps.mjs", import.meta.url).pathname,
          ...args,
        ],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${join(root, "bin")}:${process.env.PATH}`,
            WB_CONFIG_TEST_ROOT: root,
          },
        },
      );
    await fn(root, run);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("Zoho configuration preflight is read-only; update preserves settings, permissions and a recoverable backup", () =>
  fixture(async (root, run) => {
    const original = await readFile(join(root, "suite.env"), "utf8");
    let result = run("--check");
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(join(root, "suite.env"), "utf8"), original);
    result = run();
    assert.equal(result.status, 0, result.stderr);
    const text = await readFile(join(root, "suite.env"), "utf8");
    assert.ok(text.startsWith(original));
    assert.ok(text.includes("STAFF_EMAIL_PROVIDER=zoho\n"));
    assert.ok(text.includes("PRIVACY_EMAIL_FROM=noreply@lixionary.com\n"));
    assert.equal(text.includes("\\n"), false);
    assert.equal((await stat(join(root, "suite.env"))).mode & 0o777, 0o600);
    const backups = (await readdir(root)).filter((name) =>
      name.startsWith("suite.env.before-zoho-"),
    );
    assert.equal(backups.length, 1);
    assert.equal(await readFile(join(root, backups[0]), "utf8"), original);
    assert.equal(run().status, 0);
    assert.equal(
      (await readdir(root)).filter((name) =>
        name.startsWith("suite.env.before-zoho-"),
      ).length,
      1,
    );
    assert.equal(run("--check").status, 0);
    assert.equal(result.stdout.includes("synthetic-credential"), false);
  }));

test("Zoho configuration refuses missing, empty, unprotected or malformed credentials without changing the environment", () =>
  fixture(async (root, run) => {
    const original = await readFile(join(root, "suite.env"), "utf8");
    const key = join(root, "secrets/zoho_api_key");
    for (const content of ["", "synthetic\ncredential"]) {
      await writeFile(key, content);
      const result = run();
      assert.notEqual(result.status, 0);
      assert.equal(await readFile(join(root, "suite.env"), "utf8"), original);
      assert.equal(result.stderr.includes("credential"), false);
    }
    await writeFile(key, "synthetic-credential");
    await chmod(key, 0o644);
    assert.notEqual(run().status, 0);
    await rm(key);
    assert.notEqual(run().status, 0);
    assert.equal(await readFile(join(root, "suite.env"), "utf8"), original);
  }));
