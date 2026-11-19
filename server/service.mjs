import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, relative, extname, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { adminView, catalogView, validateTemplate, etag, fail, HttpError } from './catalog.mjs';
import { requireRole } from './auth.mjs';

const mimeTypes = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon','.woff2':'font/woff2'};
const inside = (root, file) => { const rel = relative(root, file); return rel && !rel.startsWith('..') && !isAbsolute(rel); };
function send(response, status, value, headers = {}) {
  response.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',...headers});
  response.end(JSON.stringify(value));
}
async function readJson(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) fail(415, '請使用 JSON 格式。');
  if (Number(request.headers['content-length']) > 500_000) fail(413, '範本過大。');
  const chunks = []; let size = 0;
  for await (const chunk of request) { size += chunk.length; if (size > 500_000) fail(413, '範本過大。'); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail(400, 'JSON 格式無效。'); }
}

export function createCompanyServer({repository, authenticate, config, distDir}) {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://server.invalid');
      const path = url.pathname;
      if (request.method === 'GET' && path === '/healthz') return send(response, 200, {status:'ok'});
      if (request.method === 'GET' && path === '/api/config') return send(response, 200, {enabled:true, tenantId:config.tenantId, clientId:config.clientId, scope:config.scope});
      if (path.startsWith('/api/')) {
        const identity = await authenticate(request);
        if (request.method === 'GET' && path === '/api/catalog') {
          const state = await repository.read();
          return send(response, 200, catalogView(state, identity), {ETag:etag(state), Vary:'Authorization'});
        }
        if (request.method === 'GET' && path === '/api/admin') {
          requireRole(identity, 'Template.Editor', 'Template.Publisher');
          const state = await repository.read();
          return send(response, 200, {...adminView(state), roles:identity.roles}, {ETag:etag(state), Vary:'Authorization'});
        }
        const route = path.match(/^\/api\/admin\/(drafts|publish|withdraw|rollback)\/([a-zA-Z0-9][a-zA-Z0-9._-]{0,79})$/);
        if (!route || request.method !== (route[1] === 'drafts' ? 'PUT' : 'POST')) fail(404, '找不到這項操作。');
        const [, action, id] = route;
        requireRole(identity, ...(action === 'drafts' ? ['Template.Editor','Template.Publisher'] : ['Template.Publisher']));
        if (request.headers.origin && request.headers.origin !== config.publicOrigin) fail(403, '來源不符。');
        const expected = request.headers['if-match'];
        if (typeof expected !== 'string' || !/^"[a-zA-Z0-9._-]+"$/.test(expected)) fail(428, '請先重新整理範本庫再儲存。');
        const data = await readJson(request);
        const next = await repository.update(expected, state => {
          const revision = randomUUID(); const at = new Date().toISOString();
          let snapshot;
          if (action === 'drafts') {
            snapshot = validateTemplate(data);
            if (snapshot.id !== id) fail(400, '範本 ID 不符。');
            snapshot.updatedAt = at;
            state.drafts = [...state.drafts.filter(template => template.id !== id), snapshot];
          } else if (action === 'publish') {
            const draft = state.drafts.find(template => template.id === id);
            if (!draft) fail(404, '找不到草稿範本。');
            snapshot = {...validateTemplate(draft), version:revision, updatedAt:at};
            state.published = [...state.published.filter(template => template.id !== id), snapshot];
            state.drafts = state.drafts.filter(template => template.id !== id);
          } else if (action === 'withdraw') {
            snapshot = state.published.find(template => template.id === id);
            if (!snapshot) fail(404, '範本目前未發布。');
            state.published = state.published.filter(template => template.id !== id);
          } else {
            if (!data || typeof data.version !== 'string') fail(400, '請指定要回復的版本。');
            const previous = [...state.history].reverse().find(entry => entry.templateId === id && ['publish','rollback'].includes(entry.action) && entry.snapshot?.version === data.version);
            if (!previous) fail(404, '找不到可回復的版本。');
            snapshot = {...validateTemplate(previous.snapshot), version:revision, updatedAt:at};
            state.published = [...state.published.filter(template => template.id !== id), snapshot];
          }
          state.revision = revision;
          state.history = [...state.history, {revision, at, action:action === 'drafts' ? 'save' : action, templateId:id, actor:identity.id, ...(snapshot ? {snapshot} : {}), ...(action === 'rollback' ? {restoredFrom:data.version} : {})}].slice(-200);
          return state;
        });
        return send(response, 200, {...adminView(next), roles:identity.roles}, {ETag:etag(next), Vary:'Authorization'});
      }
      if (!['GET','HEAD'].includes(request.method)) fail(405, '不支援此操作。');
      let decoded;
      try { decoded = decodeURIComponent(path); } catch { fail(400, '網址無效。'); }
      if (decoded.includes('\\') || decoded.includes('\0') || decoded.split('/').some(part => part.startsWith('.'))) fail(404, '找不到頁面。');
      const root = await realpath(distDir);
      const target = resolve(root, `.${decoded === '/' ? '/taskpane.html' : decoded}`);
      if (!inside(root, target) || !mimeTypes[extname(target)]) fail(404, '找不到頁面。');
      let file;
      try { file = await realpath(target); if (!inside(root, file) || !(await stat(file)).isFile()) fail(404, '找不到頁面。'); }
      catch (error) { if (error instanceof HttpError) throw error; fail(404, '找不到頁面。'); }
      const content = await readFile(file);
      response.writeHead(200, {'Content-Type':mimeTypes[extname(file)], 'Content-Length':content.length, 'Cache-Control':extname(file) === '.html' ? 'no-store' : 'public, max-age=3600', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer', 'Content-Security-Policy':"object-src 'none'; base-uri 'self'"});
      response.end(request.method === 'HEAD' ? undefined : content);
    } catch (error) {
      if (response.headersSent) { response.destroy(); return; }
      const status = error instanceof HttpError ? error.status : 503;
      send(response, status, {error:error instanceof HttpError ? error.message : '公司範本服務暫時無法使用，請稍後再試。'}, status === 401 ? {'WWW-Authenticate':'Bearer'} : {});
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  return server;
}
