import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { emptyState, validateState, etag, fail } from './catalog.mjs';

export const MAX_STATE_BYTES = 30_000_000;
export function parseState(text) {
  if (Buffer.byteLength(text) > MAX_STATE_BYTES) fail(503, '範本庫超過大小限制。');
  try { return validateState(JSON.parse(text)); } catch { fail(503, '範本庫資料無法驗證，已停止讀寫。'); }
}

/** Single shared persistent disk; the exclusive lock also protects concurrent Node processes. */
export class FileRepository {
  constructor(path) { this.path = resolve(path); }
  async read() {
    try { return parseState(await readFile(this.path, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return emptyState(); throw error; }
  }
  async update(expected, transform) {
    await mkdir(dirname(this.path), {recursive:true});
    let lock;
    try { lock = await open(`${this.path}.lock`, 'wx', 0o600); }
    catch (error) { if (error.code === 'EEXIST') fail(409, '其他管理者正在儲存，請重新整理後再試。'); throw error; }
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      const current = await this.read();
      if (expected !== etag(current)) fail(412, '範本庫已有新版本，請重新整理後再儲存。');
      const next = validateState(await transform(structuredClone(current)));
      const serialized = JSON.stringify(next);
      if (Buffer.byteLength(serialized) > MAX_STATE_BYTES) fail(413, '範本庫超過大小限制。');
      const output = await open(temporary, 'wx', 0o600);
      try { await output.writeFile(serialized, 'utf8'); await output.sync(); } finally { await output.close(); }
      await rename(temporary, this.path);
      return next;
    } finally {
      await unlink(temporary).catch(() => {});
      await lock.close();
      await unlink(`${this.path}.lock`);
    }
  }
}

/** The document is service-only. End users always read filtered published data through our API. */
export class SharePointRepository {
  constructor({siteUrl, filePath, credential, fetcher = fetch}) {
    const site = new URL(siteUrl);
    if (site.protocol !== 'https:' || !/^[a-z0-9-]+\.sharepoint\.com$/i.test(site.hostname) || site.port || site.username || site.password || site.search || site.hash) throw new Error('SHAREPOINT_SITE_URL 必須為 SharePoint Online 網站 HTTPS 網址。');
    if (typeof filePath !== 'string' || !filePath.startsWith(`${site.pathname.replace(/\/$/, '')}/`) || /[?#\r\n]|(?:^|\/)\.\.?(?:\/|$)/.test(filePath)) throw new Error('SHAREPOINT_FILE_PATH 必須位於指定網站內。');
    const argument = encodeURIComponent(filePath.replace(/'/g, "''")).replace(/'/g, '%27');
    this.url = `${site.href.replace(/\/$/, '')}/_api/web/GetFileByServerRelativePath(decodedurl='${argument}')/$value`;
    this.scope = `${site.origin}/.default`;
    this.credential = credential;
    this.fetcher = fetcher;
  }
  async request(method, body, version) {
    const token = await this.credential.getToken(this.scope);
    if (!token?.token) fail(503, '無法連線至公司範本庫。');
    const response = await this.fetcher(this.url, {method:method === 'GET' ? 'GET' : 'POST', redirect:'error', signal:AbortSignal.timeout(15_000), headers:{Authorization:`Bearer ${token.token}`, Accept:'application/json;odata=nometadata', ...(method !== 'GET' ? {'Content-Type':'application/json','X-HTTP-Method':'PUT','If-Match':version} : {})}, ...(body === undefined ? {} : {body})});
    if (response.status === 412) fail(412, 'SharePoint 範本庫已更新，請重新整理後再試。');
    if (!response.ok) fail(503, '無法讀寫 SharePoint 範本庫，請通知管理者。');
    return response;
  }
  async readWithVersion() {
    const response = await this.request('GET');
    const version = response.headers.get('etag');
    if (!version || version === '*') fail(503, 'SharePoint 未提供版本識別，已停止更新。');
    const length = Number(response.headers.get('content-length'));
    if (length > MAX_STATE_BYTES) fail(503, '範本庫超過大小限制。');
    const chunks = []; let total = 0;
    for await (const chunk of response.body) { total += chunk.length; if (total > MAX_STATE_BYTES) fail(503, '範本庫超過大小限制。'); chunks.push(chunk); }
    return {state:parseState(Buffer.concat(chunks).toString('utf8')), version};
  }
  async read() { return (await this.readWithVersion()).state; }
  async update(expected, transform) {
    const {state:current, version} = await this.readWithVersion();
    if (expected !== etag(current)) fail(412, '範本庫已有新版本，請重新整理後再儲存。');
    const next = validateState(await transform(structuredClone(current)));
    const serialized = JSON.stringify(next);
    if (Buffer.byteLength(serialized) > MAX_STATE_BYTES) fail(413, '範本庫超過大小限制。');
    await this.request('PUT', serialized, version);
    return next;
  }
}
