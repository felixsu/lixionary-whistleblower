import {readFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
const env={...process.env};
for(const [name,path] of Object.entries(env)){if(name.endsWith('_FILE')&&path){env[name.slice(0,-5)]=readFileSync(path,'utf8').trim();delete env[name];}}
const child=spawn(process.argv[2]??'node',process.argv.slice(3),{env,uid:1000,gid:1000,stdio:'inherit'});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.on('error',()=>{console.error('Unable to start runtime');process.exit(1);});child.on('exit',(code)=>process.exit(code??1));
