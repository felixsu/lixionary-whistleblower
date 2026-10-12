import { spawn } from "node:child_process";

const args = process.argv.slice(2).filter((arg) => arg !== "--");
if (args.some((arg) => arg !== "--check")) {
  console.error("Usage: pnpm email:configure:vps [--check]");
  process.exit(1);
}
// Configuration never copies or displays the operator-installed VPS key.
const script = String.raw`
import datetime,os,re,stat,tempfile
from pathlib import Path
root=Path('/app/lixionary-whistleblower/.suite-config')
key=root/'secrets/zoho_api_key';env=root/'suite.env'
try:
 if not key.is_file() or key.stat().st_uid!=os.getuid() or stat.S_IMODE(key.stat().st_mode)!=0o600:
  raise ValueError()
 token=re.sub(r'^Zoho-enczapikey\s+','',key.read_text().strip(),flags=re.I)
 if not token or re.search(r'\s',token):raise ValueError()
 if not env.is_file() or env.stat().st_uid!=os.getuid() or stat.S_IMODE(env.stat().st_mode)!=0o600:raise ValueError()
 lines=env.read_text().splitlines();values={}
 for line in lines:
  if '=' in line and not line.startswith('#'):
   k,v=line.split('=',1);values[k]=v
 if values.get('SUITE_NODE_ENV')!='production' or values.get('PUBLIC_WEB_URL')!='https://whistle-blower.lixionary.com':raise ValueError()
except Exception:
 raise SystemExit('Zoho setup requires the existing production environment and a nonempty owner-only mode-600 key file. No secret values were displayed.')
updates={'STAFF_EMAIL_PROVIDER':'zoho','PRIVACY_EMAIL_PROVIDER':'zoho','STAFF_EMAIL_FROM':'noreply@lixionary.com','PRIVACY_EMAIL_FROM':'noreply@lixionary.com'}
if ${JSON.stringify(args.includes("--check")) === "true" ? "True" : "False"}:
 print('Zoho key permissions and production environment verified; '+('provider settings are ready.' if all(values.get(k)==v for k,v in updates.items()) else 'provider settings still need configuration.'))
else:
 if not all(values.get(k)==v for k,v in updates.items()):
  backup=root/('suite.env.before-zoho-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
  with backup.open('xb') as f:
   os.chmod(backup,0o600);f.write(env.read_bytes());f.flush();os.fsync(f.fileno())
  result=[];seen=set()
  for line in lines:
   k=line.split('=',1)[0]
   if k in updates:
    if k not in seen:result.append(k+'='+updates[k]);seen.add(k)
   else:result.append(line)
  result.extend(k+'='+v for k,v in updates.items() if k not in seen)
  fd,name=tempfile.mkstemp(prefix='.zoho-env-',dir=root)
  try:
   with os.fdopen(fd,'w') as f:f.write('\n'.join(result)+'\n');f.flush();os.fsync(f.fileno())
   os.replace(name,env)
  finally:
   Path(name).unlink(missing_ok=True)
 print('Production Zoho settings prepared. Existing settings were preserved; containers were not restarted.')
`;
const child = spawn(
  "ssh",
  [
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    "ConnectTimeout=15",
    "lixsu@lixionary.com",
    "umask 077; python3 -",
  ],
  { stdio: ["pipe", "inherit", "inherit"] },
);
child.stdin.on("error", () => {});
child.on("error", () => {
  console.error("Unable to connect to the VPS.");
  process.exitCode = 1;
});
child.on("close", (code) => {
  if (code !== 0) process.exitCode = 1;
});
child.stdin.end(script);
