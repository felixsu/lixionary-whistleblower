import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
const file = ".suite-dev/suite.env",
  env = await readFile(file, "utf8");
if (!env.includes("SUITE_NODE_ENV=development"))
  throw new Error("Browser seed is limited to development");
const code = `import postgres from 'postgres'; import {randomUUID} from 'node:crypto'; import {hashSecret} from '@whistle/runtime'; import {defaultSettings} from '@whistle/shared'; const db=postgres(process.env.MIGRATION_DATABASE_URL,{max:1,onnotice:()=>{}}); try { await db.begin(async tx=>{const existing=await tx\`select email from staff\`;if(existing.some(s=>!s.email.startsWith('e2e-')))throw new Error('Non-test staff present; refusing seed');const roles=[['admin','admin'],['manager','manager'],['manager2','manager'],['analyst','analyst'],['independent','manager'],['independent2','manager']];const ids={};for(const [name,role] of roles){const row=await tx\`insert into staff(email,name,role,password_hash) values(\${'e2e-'+name+'@example.test'},\${'E2E '+name},\${role},\${await hashSecret('UI test-only long password')}) on conflict(email) do update set active=true,mfa_enc=null,mfa_pending_enc=null,mfa_last_step=null returning id\`;ids[name]=row[0].id;}const normal=await tx\`insert into teams(name,restricted) values('E2E Standard',false) on conflict(name) do update set restricted=false returning id\`;const restricted=await tx\`insert into teams(name,restricted) values('E2E Independent',true) on conflict(name) do update set restricted=true returning id\`;for(const name of ['manager','manager2','analyst'])await tx\`insert into team_members values(\${normal[0].id},\${ids[name]}) on conflict do nothing\`;for(const name of ['independent','independent2'])await tx\`insert into team_members values(\${restricted[0].id},\${ids[name]}) on conflict do nothing\`;const body={...defaultSettings,defaultTeamId:normal[0].id,restrictedTeamId:restricted[0].id,retention:{cases:365,contacts:365,evidence:365,transcripts:365,audit:365,backups:365}};await tx\`insert into settings(id,body,configured) values(1,\${tx.json(body)}::jsonb,true) on conflict(id) do update set body=excluded.body,configured=true,version=settings.version+1\`;});console.log('Development browser fixture accounts ready.');}finally{await db.end();}`;
const result = spawnSync(
  "docker",
  [
    "compose",
    "--env-file",
    file,
    "run",
    "--rm",
    "--no-deps",
    "case-migrate",
    "node",
    "--input-type=module",
    "-e",
    code,
  ],
  { stdio: "inherit" },
);
process.exitCode = result.status ?? 1;
