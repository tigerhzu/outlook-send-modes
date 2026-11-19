import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPair, SignJWT } from 'jose';
import { validateTemplate, emptyState, validateState, catalogView, etag, HttpError } from '../server/catalog.mjs';
import { FileRepository, SharePointRepository } from '../server/repository.mjs';
import { createCompanyServer } from '../server/service.mjs';
import { createAuthenticator } from '../server/auth.mjs';
import { readConfig } from '../server/index.mjs';

const sample = () => ({id:'service-note', name:'服務通知', category:'通知', tags:['服務'], language:'zh-TW', version:'draft', updatedAt:'2026-11-16T00:00:00Z', subject:'服務通知 {{customer}}', bodyHtml:'<p>{{customer}} 您好</p><table style="border-collapse:collapse;background-color:rgb(255, 255, 255)"><tr><td>工作項目</td></tr></table>', bodyText:'{{customer}} 您好\n工作項目', fields:[{key:'customer',label:'客戶名稱',type:'text',required:true}], owner:'IT', audience:[]});
const rejects400 = fn => assert.throws(fn, error => error instanceof HttpError && error.status === 400);

test('template validates and normalizes table structure without adding recipients', () => {
  const result = validateTemplate(sample());
  assert.match(result.bodyHtml, /<tbody>/);
  assert.equal(result.fields[0].required, true);
  assert.equal(Object.hasOwn(result, 'to'), false);
});
test('template fails closed for active HTML, CSS URLs, unknown fields and attribute substitution', () => {
  for (const bodyHtml of ['<script>alert(1)</script>', '<p onclick="alert(1)">hello</p>', '<img src="https://example.com">', '<p style="background:image-set(\"https://example.com/a\" 1x)">hello</p>', '<p style="color:var(--x)">hello</p>', '<p style="background:u\\72l(https://example.com)">hello</p>', '<p title="{{customer}}">hello</p>', '<p>{{missing}}</p>', '<p>{{customer</p>', '<!--{{customer}}--><p>hello</p>']) rejects400(() => validateTemplate({...sample(), bodyHtml}));
  for (const value of [{to:[]}, {cc:[]}, {bcc:[]}]) rejects400(() => validateTemplate({...sample(),...value}));
});
test('template IDs and fields require strings, reject reserved names and invalid dates', () => {
  for (const value of [undefined,null,'',{},'../x']) rejects400(() => validateTemplate({...sample(),id:value}));
  for (const key of [undefined,null,'constructor','prototype','__proto__']) rejects400(() => validateTemplate({...sample(), fields:[{key,label:'姓名',type:'text',required:true}]}));
  for (const date of ['2026-99-99','2026-02-30','hello']) rejects400(() => validateTemplate({...sample(),fields:[{key:'customer',label:'日期',type:'date',required:true,defaultValue:date}]}));
  assert.throws(() => validateState({...emptyState(),revision:undefined}));
});
test('audience filtering does not leak other departments or drafts', () => {
  const state = {...emptyState(),drafts:[sample()],published:[{...sample(),id:'public'},{...sample(),id:'finance',audience:['Department.Finance']}]};
  assert.deepEqual(catalogView(state,{roles:[]}).templates.map(t => t.id), ['public']);
  assert.deepEqual(catalogView(state,{roles:['Department.Finance']}).templates.map(t => t.id), ['public','finance']);
  assert.equal(catalogView(state,{roles:[]}).drafts, undefined);
});
test('publication rejects NUL and non-finite numeric defaults that readers cannot render', () => {
  rejects400(()=>validateTemplate({...sample(),name:'hello\u0000'}));
  rejects400(()=>validateTemplate({...sample(),fields:[{key:'customer',label:'數字',type:'number',required:true,defaultValue:'9'.repeat(400)}]}));
  for(const value of ['+1','.5','1.']) assert.equal(validateTemplate({...sample(),fields:[{key:'customer',label:'數字',type:'number',required:true,defaultValue:value}]}).fields[0].defaultValue,value);
});
test('file repository atomic revisions reject lost writes and malformed storage', async t => {
  const directory = await mkdtemp(join(tmpdir(),'company-repository-'));
  t.after(() => rm(directory,{recursive:true,force:true}));
  const repository = new FileRepository(join(directory,'state.json'));
  assert.equal(etag(await repository.read()), '"initial"');
  await repository.update('"initial"',state => ({...state,revision:'new',drafts:[sample()]}));
  await assert.rejects(repository.update('"initial"',state => ({...state,revision:'lost'})), error => error.status === 412);
  await writeFile(`${repository.path}.lock`, '');
  await assert.rejects(repository.update('"new"',state => state), error => error.status === 409);
  await rm(`${repository.path}.lock`);
  assert.equal((await repository.read()).revision,'new');
  await writeFile(repository.path,'{');
  await assert.rejects(repository.read(), error => error.status === 503);
});
test('SharePoint repository sends exact ETag and never follows redirects', async () => {
  const calls = [];
  const repository = new SharePointRepository({siteUrl:'https://tenant.sharepoint.com/sites/Templates',filePath:'/sites/Templates/ServiceOnly/state.json',credential:{getToken:async scope => {assert.equal(scope,'https://tenant.sharepoint.com/.default');return {token:'test-token'};}},fetcher:async (url,init) => {
    calls.push({url,init});
    return init.method === 'GET' ? new Response(JSON.stringify(emptyState()),{headers:{etag:'"sp-version"'}}) : new Response(null,{status:204});
  }});
  await repository.update('"initial"',state => ({...state,revision:'updated'}));
  assert.equal(calls[1].init.headers['If-Match'],'"sp-version"');
  assert.equal(calls[1].init.headers['X-HTTP-Method'],'PUT');
  assert.equal(calls[1].init.redirect,'error');
  assert.equal(JSON.parse(calls[1].init.body).revision,'updated');
});
test('SharePoint refuses missing version and unsafe site/path', async () => {
  const options = {siteUrl:'https://tenant.sharepoint.com/sites/Templates',filePath:'/sites/Templates/ServiceOnly/state.json',credential:{getToken:async () => ({token:'test'})},fetcher:async () => new Response(JSON.stringify(emptyState()))};
  await assert.rejects(new SharePointRepository(options).read(), error => error.status === 503);
  for (const siteUrl of ['http://tenant.sharepoint.com/sites/Templates','https://attacker.example/sites/Templates','https://tenant.sharepoint.com@evil.example/sites/Templates']) assert.throws(() => new SharePointRepository({...options,siteUrl}));
  assert.throws(() => new SharePointRepository({...options,filePath:'/sites/Other/file.json'}));
});
test('Entra authenticator verifies signatures, tenant, audience, client, scope and delegated user', async () => {
  const {publicKey,privateKey} = await generateKeyPair('RS256');
  const config = {tenantId:'11111111-1111-1111-1111-111111111111',clientId:'22222222-2222-2222-2222-222222222222',apiAudience:'33333333-3333-3333-3333-333333333333'};
  const authenticate = createAuthenticator(config,publicKey);
  const token = async (extra, options = {}) => new SignJWT({ver:'2.0',oid:'user-1',tid:config.tenantId,azp:config.clientId,scp:'Templates.Read',roles:['Template.Editor'],...extra}).setProtectedHeader({alg:'RS256'}).setIssuer(options.issuer || `https://login.microsoftonline.com/${config.tenantId}/v2.0`).setAudience(options.audience || config.apiAudience).setIssuedAt().setNotBefore('0s').setExpirationTime(options.expiration || '2m').sign(options.key || privateKey);
  assert.deepEqual(await authenticate({headers:{authorization:`Bearer ${await token({})}`}}),{id:'user-1',roles:['Template.Editor']});
  for (const extra of [{tid:'wrong'},{azp:'wrong'},{scp:'Mail.Send'},{idtyp:'app'},{ver:'1.0'}]) await assert.rejects(authenticate({headers:{authorization:`Bearer ${await token(extra)}`}}), error => error.status === 403);
  for (const options of [{issuer:'https://evil.example/v2.0'}, {audience:'wrong-audience'}, {expiration:'-5m'}, {key:(await generateKeyPair('RS256')).privateKey}]) await assert.rejects(authenticate({headers:{authorization:`Bearer ${await token({},options)}`}}), error => error.status === 401);
  await assert.rejects(authenticate({headers:{authorization:`Bearer ${await token({scp:undefined})}`}}), error => error.status === 401);
  await assert.rejects(authenticate({headers:{authorization:'Bearer invalid'}}), error => error.status === 401);
  await assert.rejects(authenticate({headers:{}}), error => error.status === 401);
});

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(),'company-service-'));
  const dist = join(directory,'dist'); await mkdir(dist); await writeFile(join(dist,'taskpane.html'),'<html>ready</html>');
  const repository = new FileRepository(join(directory,'private','state.json'));
  const identities = {reader:{id:'reader',roles:[]},editor:{id:'editor',roles:['Template.Editor']},publisher:{id:'publisher',roles:['Template.Publisher']}};
  const server = createCompanyServer({repository,distDir:dist,config:{tenantId:'tenant',clientId:'client',scope:'api://api/Templates.Read',publicOrigin:'https://templates.example.com'},authenticate:async request => {
    const identity = identities[request.headers.authorization]; if (!identity) throw new HttpError(401,'登入'); return identity;
  }});
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(async () => {server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(directory,{recursive:true,force:true});});
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path,who='reader',method='GET',data,version) => fetch(base+path,{method,headers:{Authorization:who,...(data === undefined ? {} : {'Content-Type':'application/json'}),...(version ? {'If-Match':version} : {})},...(data === undefined ? {} : {body:JSON.stringify(data)})});
  return {call,repository,base};
}
test('HTTP publication lifecycle: draft isolation, version conflict, publish, withdrawal, rollback', async t => {
  const {call} = await fixture(t);
  assert.equal((await call('/api/admin')).status,403);
  assert.equal((await call('/api/catalog','')).status,401);
  const initial = await call('/api/admin','editor'); let version = initial.headers.get('etag');
  const draft = await call('/api/admin/drafts/service-note','editor','PUT',sample(),version);
  assert.equal(draft.status,200); version = draft.headers.get('etag');
  assert.equal((await (await call('/api/catalog')).json()).templates.length,0);
  assert.equal((await call('/api/admin/publish/service-note','editor','POST',{},version)).status,403);
  assert.equal((await call('/api/admin/publish/service-note','publisher','POST',{},'"initial"')).status,412);
  const published = await call('/api/admin/publish/service-note','publisher','POST',{},version);
  assert.equal(published.status,200); version = published.headers.get('etag');
  const first = (await (await call('/api/catalog')).json()).templates[0];
  assert.notEqual(first.version,'draft');
  const withdrawn = await call('/api/admin/withdraw/service-note','publisher','POST',{},version);
  assert.equal(withdrawn.status,200); version = withdrawn.headers.get('etag');
  assert.equal((await (await call('/api/catalog')).json()).templates.length,0);
  const rollback = await call('/api/admin/rollback/service-note','publisher','POST',{version:first.version},version);
  assert.equal(rollback.status,200);
  const restored = (await (await call('/api/catalog')).json()).templates[0];
  assert.equal(restored.bodyHtml,first.bodyHtml);
  assert.notEqual(restored.version,first.version);
  const admin = await rollback.json();
  assert.equal(admin.history.length,4);
  assert.equal(admin.history.some(entry => Object.hasOwn(entry,'snapshot')),false);
});
test('HTTP mutations require revision, reject unsafe HTML and never expose repository/static secrets', async t => {
  const {call,base} = await fixture(t);
  assert.equal((await call('/api/admin/drafts/service-note','editor','PUT',sample())).status,428);
  assert.equal((await call('/api/admin/drafts/service-note','editor','PUT',{...sample(),bodyHtml:'<script>x</script>'},'"initial"')).status,400);
  assert.equal((await call('/private/state.json')).status,404);
  assert.equal((await call('/.env')).status,404);
  assert.equal((await call('/server/index.mjs')).status,404);
  const config = await (await call('/api/config','')).json();
  assert.deepEqual(Object.keys(config),['enabled','tenantId','clientId','scope']);
  assert.match(await (await call('/taskpane.html')).text(),/ready/);
  const origin = await fetch(base+'/api/admin/drafts/service-note',{method:'PUT',headers:{Authorization:'editor','If-Match':'"initial"','Content-Type':'application/json',Origin:'https://evil.example'},body:JSON.stringify(sample())});
  assert.equal(origin.status,403);
});
test('production configuration requires explicit Entra IDs and keeps state outside dist', () => {
  const env = {ENTRA_TENANT_ID:'11111111-1111-1111-1111-111111111111',ENTRA_CLIENT_ID:'22222222-2222-2222-2222-222222222222',ENTRA_API_AUDIENCE:'33333333-3333-3333-3333-333333333333',PUBLIC_ORIGIN:'https://templates.example.com'};
  assert.equal(readConfig(env).scope,`api://${env.ENTRA_API_AUDIENCE}/Templates.Read`);
  assert.throws(() => readConfig({...env,PUBLIC_ORIGIN:'http://templates.example.com'}));
  assert.throws(() => readConfig({...env,PUBLIC_ORIGIN:'https://localhost:3443'}));
  assert.throws(() => readConfig({...env,ENTRA_TENANT_ID:undefined}));
  assert.throws(() => readConfig({...env,CATALOG_FILE:'dist/catalog.json'}));
});
