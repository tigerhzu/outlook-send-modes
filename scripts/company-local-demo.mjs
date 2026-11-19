/** Local-only demonstration. Never imported by server/index.mjs or shipped as its authentication. */
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPair, SignJWT } from 'jose';
import { createCompanyServer } from '../server/service.mjs';
import { createAuthenticator } from '../server/auth.mjs';
import { FileRepository } from '../server/repository.mjs';
import { emptyState, validateTemplate } from '../server/catalog.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const assets = resolve(root, 'tests/local-demo');
const roles = {reader:[], editor:['Template.Editor'], publisher:['Template.Publisher']};
export const demoTemplate = () => validateTemplate({
  id:'demo-service-notice', name:'維護通知', category:'服務', tags:['本地測試'], language:'zh-TW',
  version:'demo-v1', updatedAt:'2026-11-16T00:00:00.000Z', owner:'示範 IT', audience:[],
  subject:'{{customer}}：維護通知',
  bodyHtml:'<p>{{customer}} 您好：</p><p>預計於 {{day}} 進行系統維護。</p><table style="border-collapse:collapse;width:100%"><tbody><tr><th style="border:1px solid #cbd5e1;padding:8px">說明</th><td style="border:1px solid #cbd5e1;padding:8px">{{details}}</td></tr></tbody></table><p>感謝您的配合。</p>',
  bodyText:'{{customer}} 您好：\n預計於 {{day}} 進行系統維護。\n說明：{{details}}\n感謝您的配合。',
  fields:[{key:'customer',label:'稱呼',type:'text',required:true},{key:'day',label:'維護日期',type:'date',required:true},{key:'details',label:'維護說明',type:'text',required:true,defaultValue:'服務將暫停 15 分鐘。'}],
});

export async function startLocalDemo({port = 4175, distDir = resolve(root,'dist')} = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('連接埠必須介於 0–65535。');
  let marker;
  try { marker = JSON.parse(await readFile(join(distDir,'company-build.json'),'utf8')); }
  catch { throw new Error('請先執行 npm run build:company。'); }
  if (marker.company !== true || marker.bundledRecipientMatches !== 0) throw new Error('必須使用通過檢查的公司版本，請執行 npm run build:company。');
  const taskpane = (await readFile(join(distDir,'taskpane.html'),'utf8'))
    .replace(/<script\b[^>]*id="office-js"[^>]*><\/script>/, '<script id="office-js" src="/__demo/office.js"></script>')
    .replace('<body>', '<body><aside style="padding:8px 12px;background:#fff1c2;color:#713f12;font:600 13px system-ui">本地模擬 · 未連接 Outlook</aside>');
  if (taskpane.includes('https://appsforoffice.microsoft.com/')) throw new Error('Office.js 模擬載入失敗，已停止。');
  const runtimeRoot = resolve(root,'.runtime'); await mkdir(runtimeRoot,{recursive:true});
  const directory = await mkdtemp(join(runtimeRoot,'local-demo-'));
  const repository = new FileRepository(join(directory,'catalog-state.json'));
  const sample = demoTemplate();
  await writeFile(repository.path, JSON.stringify({...emptyState(),revision:'demo-initial',published:[sample],history:[{revision:'demo-initial',at:sample.updatedAt,action:'publish',templateId:sample.id,actor:'demo-publisher',snapshot:sample}]}),'utf8');
  const {publicKey,privateKey} = await generateKeyPair('RS256');
  const config = {tenantId:'11111111-1111-4111-8111-111111111111',clientId:'22222222-2222-4222-8222-222222222222',apiAudience:'33333333-3333-4333-8333-333333333333',scope:'api://33333333-3333-4333-8333-333333333333/Templates.Read',publicOrigin:''};
  const server = createCompanyServer({repository,config,distDir,authenticate:createAuthenticator(config,publicKey)});
  const normalRequest = server.listeners('request')[0]; server.removeAllListeners('request');
  const reply = (response,status,type,body) => {response.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'"});response.end(body);};
  server.on('request',async (request,response) => {
    try {
      if (request.headers.host !== new URL(config.publicOrigin).host || (request.headers.origin && request.headers.origin !== config.publicOrigin) || request.headers['sec-fetch-site'] === 'cross-site') return reply(response,403,'text/plain; charset=utf-8','此示範僅允許本機同源存取。');
      const url = new URL(request.url,config.publicOrigin);
      if (url.pathname === '/__demo/token') {
        if (request.method !== 'POST' || request.headers.origin !== config.publicOrigin || request.headers['content-type'] !== 'application/json') return reply(response,403,'application/json','{}');
        const role = url.searchParams.get('role');
        if (!Object.hasOwn(roles,role)) return reply(response,400,'application/json','{}');
        const expiresAt = Date.now() + 30*60*1000;
        const accessToken = await new SignJWT({ver:'2.0',oid:`demo-${role}`,tid:config.tenantId,azp:config.clientId,scp:'Templates.Read',roles:roles[role]})
          .setProtectedHeader({alg:'RS256'}).setIssuer(`https://login.microsoftonline.com/${config.tenantId}/v2.0`).setAudience(config.apiAudience).setIssuedAt().setNotBefore('0s').setExpirationTime('30m').sign(privateKey);
        return reply(response,200,'application/json',JSON.stringify({accessToken,expiresAt}));
      }
      if (url.pathname === '/auth.html') return reply(response,404,'text/plain; charset=utf-8','本地示範使用虛構帳號，不開啟 Microsoft 登入。');
      const files = {'/':'index.html','/__demo/office.js':'office.js','/__demo/shell.js':'shell.js'};
      if (Object.hasOwn(files,url.pathname)) {
        if (request.method !== 'GET') return reply(response,405,'text/plain','Method not allowed');
        const name = files[url.pathname];
        return reply(response,200,name.endsWith('.js')?'text/javascript; charset=utf-8':'text/html; charset=utf-8',await readFile(join(assets,name)));
      }
      if (url.pathname === '/taskpane.html') return reply(response,200,'text/html; charset=utf-8',taskpane);
      return normalRequest(request,response);
    } catch { if (!response.headersSent) reply(response,500,'text/plain; charset=utf-8','本地模擬服務發生錯誤。'); else response.destroy(); }
  });
  const cleanup = async () => {
    const rel = relative(runtimeRoot,directory);
    if (!rel || rel.startsWith('..') || isAbsolute(rel) || !rel.startsWith('local-demo-')) throw new Error('模擬暫存路徑無效，停止清理。');
    await rm(directory,{recursive:true,force:true});
  };
  try { await new Promise((resolveListen,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.removeListener('error',reject);resolveListen();});}); }
  catch (error) { await cleanup(); throw error; }
  config.publicOrigin = `http://127.0.0.1:${server.address().port}`;
  let closed = false;
  return {url:config.publicOrigin, server, repository, async close(){if(closed)return;closed=true;server.closeAllConnections();await new Promise(resolveClose=>server.close(resolveClose));await cleanup();}};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--port' || !/^\d+$/.test(args[1]))) throw new Error('用法：node scripts/company-local-demo.mjs [--port 4175]');
  try {
    const demo = await startLocalDemo({port:args.length?Number(args[1]):4175});
    console.log(`本地模擬已啟動：${demo.url}\n使用虛構帳號與測試草稿；不連接 Outlook、Entra 或 SharePoint。\n按 Ctrl+C 結束，本次模擬範本修改會清除。`);
    for (const signal of ['SIGINT','SIGTERM']) process.once(signal,async()=>{await demo.close();process.exit(0);});
  } catch(error) { console.error(error.code === 'EADDRINUSE' ? '連接埠已被使用，可加 --port 4176。' : error.message);process.exitCode=1; }
}
