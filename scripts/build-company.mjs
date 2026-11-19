import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { readFile, readdir, writeFile } from 'node:fs/promises';
const root=resolve(import.meta.dirname,'..');
for(const [file,args] of [['typescript/bin/tsc',['--noEmit']],['vite/bin/vite.js',['build']]]) {
  const result=spawnSync(process.execPath,[resolve(root,'node_modules',file),...args],{cwd:root,env:{...process.env,VITE_COMPANY_DEPLOYMENT:'1'},stdio:'inherit'});
  if(result.error)throw result.error;if(result.status!==0)process.exit(result.status || 1);
}
const catalog=JSON.parse(await readFile(resolve(root,'outlook-templates/templates.json'),'utf8'));
const assets=resolve(root,'dist/assets');
const javascript=(await Promise.all((await readdir(assets)).filter(file=>file.endsWith('.js')).map(file=>readFile(resolve(assets,file),'utf8')))).join('\n');
const addresses=catalog.templates.flatMap(template=>[...template.to,...template.cc].map(person=>person.email)).filter(Boolean);
if(addresses.some(address=>javascript.toLowerCase().includes(address.toLowerCase())))throw new Error('公司建置仍含本機範本收件者，已停止封裝。');
const {version}=JSON.parse(await readFile(resolve(root,'package.json'),'utf8'));
await writeFile(resolve(root,'dist/company-build.json'),JSON.stringify({version,company:true,bundledRecipientMatches:0})+'\n');
