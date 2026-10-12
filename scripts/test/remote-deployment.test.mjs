import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  chmod,
  copyFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { verifyBackup } from "../deploy-vps.mjs";

const revision = "a".repeat(40);
const releaseId = `${revision}-20261011T000000Z-123`;
const images = Object.fromEntries(
  ["case", "private", "web"].map((kind, index) => [
    kind,
    `sha256:${"abc"[index].repeat(64)}`,
  ]),
);

// Run the actual remote driver in an isolated filesystem. External infrastructure
// commands are mocked; encryption, shell traps and acknowledgement gates are real.
async function simulate(failure) {
  const root = await mkdtemp(join(tmpdir(), "wb-remote-test-"));
  try {
    const bin = join(root, "bin");
    const release = join(root, ".suite-config/releases", releaseId);
    for (const dir of [
      bin,
      release,
      join(root, ".suite-config/secrets"),
      join(root, "deploy/nginx"),
      join(root, "nginx"),
    ])
      await mkdir(dir, { recursive: true });
    for (const file of [
      "docker-compose.yml",
      "deploy/compose.vps.yml",
      "nginx/whistle-blower.lixionary.com.conf",
    ])
      await writeFile(join(root, file), "synthetic configuration");
    await writeFile(
      join(root, ".suite-config/suite.env"),
      "SUITE_NODE_ENV=production\nPUBLIC_WEB_URL=https://whistle-blower.lixionary.com\n",
    );
    await writeFile(join(release, "images.tar.gz"), "synthetic image bundle");
    await writeFile(
      join(release, "images.json"),
      JSON.stringify({ revision, images }),
    );
    await copyFile(
      new URL("../deployment-backup.py", import.meta.url),
      join(release, "deployment-backup.py"),
    );
    const driver = (
      await readFile(
        new URL("../deploy-vps-remote.sh", import.meta.url),
        "utf8",
      )
    )
      .replace("root=/app/lixionary-whistleblower", `root='${root}'`)
      .replaceAll("/etc/nginx/sites-available/", `${root}/nginx/`);
    const path = join(root, "driver.sh");
    await writeFile(path, driver);
    const mock = `#!/usr/bin/env python3
import json,os,sys
from pathlib import Path
root=Path(os.environ['WB_TEST_ROOT']);args=sys.argv[1:];command=Path(sys.argv[0]).name
with (root/'commands.jsonl').open('a') as f:f.write(json.dumps([command]+args)+'\\n')
revision=os.environ['WB_TEST_REVISION'];images=json.loads(os.environ['WB_TEST_IMAGES'])
if command=='git':
 if args[0]=='branch':print('main')
 elif args[0]=='rev-parse':print(revision if args[1]=='origin/main' or (root/'merged').exists() else 'b'*40)
 elif args[0]=='show':print('synthetic configuration')
 elif args[0]=='merge':(root/'merged').touch()
elif command=='df':print('Filesystem 1024-blocks Used Available Capacity Mounted\\nfixture 20000000 0 20000000 0% /')
elif command=='docker':
 if args[0]=='compose':
  if 'config' in args and '--format' in args:
   names=['case-db','private-db','case-redis','private-redis','scanner','case-api','web']
   print(json.dumps({'services':{n:{} for n in names},'networks':{},'volumes':{},'secrets':{}}))
  elif 'stop' in args:(root/'stopped').touch()
  elif 'start' in args:(root/'restarted').touch()
  elif 'up' in args:(root/'activated').touch()
  elif 'pg_dump' in args:print('synthetic database dump')
  elif 'run' in args and 'checkpoint' in args:print(json.dumps({'last':None,'held':[],'deleted':[]}))
  elif 'run' in args and 'case-migrate' in args and 'node' not in args:
   (root/'migrations-started').touch()
   if os.environ['WB_TEST_FAILURE']=='migration':sys.exit(42)
 elif args[0]=='image':
  print(json.dumps([{'Architecture':'amd64','Os':'linux','Config':{'Labels':{'org.opencontainers.image.revision':revision}}}]))
 elif args[0]=='inspect':
  name=args[1]
  if '--format' in args:print('synthetic-vault' if '.Mounts' in args[-1] else 'sha256:'+'d'*64)
  else:
   kind='case' if 'case-api' in name else 'web' if '-web-' in name else 'private'
   image=images[kind] if (root/'activated').exists() else 'sha256:'+'d'*64
   print(json.dumps([{'State':{'Running':True},'Image':image}]))
 elif args[0]=='run':
  mount=next(v for v in args if v.endswith(':/snapshot'))
  (Path(mount[:-10])/'vault.tar').write_bytes(b'synthetic sealed vault')
`;
    for (const command of ["git", "docker", "sudo", "flock", "curl", "df"]) {
      await writeFile(join(bin, command), mock);
      await chmod(join(bin, command), 0o700);
    }
    const result = spawnSync("bash", [path, "deploy", revision, releaseId], {
      input:
        failure === "backup"
          ? "BACKUP_FAILED\n"
          : `BACKUP_VERIFIED ${releaseId}\n`,
      encoding: "utf8",
      timeout: 30000,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        WB_TEST_ROOT: root,
        WB_TEST_REVISION: revision,
        WB_TEST_IMAGES: JSON.stringify(images),
        WB_TEST_FAILURE: failure,
      },
    });
    assert.equal(result.error, undefined);
    await verifyBackup(
      join(release, "snapshot.wbenc"),
      join(release, "recovery.key"),
    );
    await assert.rejects(readFile(join(release, "staging/cases.dump")));
    const exists = async (name) =>
      readFile(join(root, name)).then(
        () => true,
        () => false,
      );
    if (failure === "backup") {
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /migrations were not started/);
      assert.equal(await exists("restarted"), true);
      assert.equal(await exists("migrations-started"), false);
      assert.equal(await exists("merged"), false);
    } else if (failure === "migration") {
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Older binaries were not restarted/);
      assert.equal(await exists("migrations-started"), true);
      assert.equal(await exists("restarted"), false);
      assert.equal(await exists("activated"), false);
    } else {
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, new RegExp(`__WB_DEPLOY_OK__ ${revision}`));
      const record = JSON.parse(
        await readFile(join(release, "deployment.json")),
      );
      assert.deepEqual(record.images, images);
      assert.equal(record.local_backup_authenticated, true);
      const active = JSON.parse(
        await readFile(join(root, ".suite-config/active-release.json")),
      );
      assert.equal(active.services["case-api"].image, images.case);
      const commands = (await readFile(join(root, "commands.jsonl"), "utf8"))
        .trim()
        .split("\n")
        .map(JSON.parse);
      const up = commands.find(
        ([command, ...args]) => command === "docker" && args.includes("up"),
      );
      assert.equal(up.includes("--no-deps"), true);
      assert.equal(up.includes("--no-build"), true);
      for (const service of ["case-db", "private-db", "scanner"])
        assert.equal(up.includes(service), false);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("failed local snapshot acknowledgement resumes old services before migration", () =>
  simulate("backup"));
test("failed migration never restarts older binaries", () =>
  simulate("migration"));
test("successful remote release pins app images and leaves infrastructure running", () =>
  simulate("none"));
