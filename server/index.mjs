import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isIP } from 'node:net';
import { createAuthenticator } from './auth.mjs';
import { FileRepository, SharePointRepository } from './repository.mjs';
import { createCompanyServer } from './service.mjs';

const guid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function readConfig(env = process.env) {
  for (const name of ['ENTRA_TENANT_ID','ENTRA_CLIENT_ID','ENTRA_API_AUDIENCE']) if (!guid.test(env[name] || '')) throw new Error(`${name} 必須是 Entra GUID。`);
  const origin = new URL(env.PUBLIC_ORIGIN || '');
  if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password || isIP(origin.hostname.replace(/^\[|\]$/g,'')) || /(^|\.)localhost\.?$/i.test(origin.hostname)) throw new Error('PUBLIC_ORIGIN 必須是公司 HTTPS DNS origin，不含路徑或本機位址。');
  const scope = `api://${env.ENTRA_API_AUDIENCE}/Templates.Read`;
  const port = Number(env.PORT || 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 無效。');
  const provider = env.CATALOG_PROVIDER || 'file';
  if (!['file','sharepoint'].includes(provider)) throw new Error('CATALOG_PROVIDER 必須為 file 或 sharepoint。');
  const distDir = resolve(env.DIST_DIR || 'dist');
  const dataPath = resolve(env.CATALOG_FILE || '.runtime/company/catalog-state.json');
  const rel = relative(distDir, dataPath);
  if (!rel || (!rel.startsWith('..') && !isAbsolute(rel))) throw new Error('範本庫不可放在公開網站目錄內。');
  return {tenantId:env.ENTRA_TENANT_ID, clientId:env.ENTRA_CLIENT_ID, apiAudience:env.ENTRA_API_AUDIENCE, scope, publicOrigin:origin.origin, port, host:env.HOST || '127.0.0.1', provider, distDir, dataPath};
}
export async function start(env = process.env) {
  const config = readConfig(env);
  let repository;
  if (config.provider === 'file') repository = new FileRepository(config.dataPath);
  else {
    if (!guid.test(env.SHAREPOINT_CLIENT_ID || '') || !env.SHAREPOINT_CERT_PATH) throw new Error('請設定 SharePoint 應用程式 ID 與 PEM 憑證路徑。');
    const {ClientCertificateCredential} = await import('@azure/identity');
    const credential = new ClientCertificateCredential(config.tenantId, env.SHAREPOINT_CLIENT_ID, {certificatePath:env.SHAREPOINT_CERT_PATH, ...(env.SHAREPOINT_CERT_PASSWORD ? {certificatePassword:env.SHAREPOINT_CERT_PASSWORD} : {})});
    repository = new SharePointRepository({siteUrl:env.SHAREPOINT_SITE_URL, filePath:env.SHAREPOINT_FILE_PATH, credential});
  }
  await repository.read();
  const server = createCompanyServer({repository, authenticate:createAuthenticator(config), config, distDir:config.distDir});
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.port, config.host, resolve); });
  return server;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  start().then(() => console.log('公司範本服務已啟動。請由公司 HTTPS 反向代理提供服務。')).catch(error => { console.error(`啟動失敗：${error.message}`); process.exitCode = 1; });
}
