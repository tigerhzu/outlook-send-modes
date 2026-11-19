import { readFile, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sourcePath = fileURLToPath(new URL('../manifest.xml', import.meta.url));
const defaultOutputPath = fileURLToPath(new URL('../manifest.production.xml', import.meta.url));
const developmentOrigin = 'https://localhost:3443';

export function productionOrigin(input) {
  if (typeof input !== 'string' || input !== input.trim() || !/^https:\/\/[^/\\?#\s]+\/?$/i.test(input)) {
    throw new Error('請提供無路徑、帳密、query 的正式 HTTPS origin。');
  }
  let url;
  try { url = new URL(input); }
  catch { throw new Error('正式 HTTPS origin 格式錯誤。'); }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('請提供無路徑、帳密、query 的正式 HTTPS origin。');
  }
  const hostname = url.hostname.replace(/\.$/, '').toLowerCase();
  const ipHostname = hostname.replace(/^\[|\]$/g, '');
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || isIP(ipHostname)) {
    throw new Error('正式 manifest 請使用公司可存取、具有受信任憑證的 DNS 網域，不使用 localhost 或 IP 位址。');
  }
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(hostname)) {
    throw new Error('請使用完整的公司 HTTPS 網域。');
  }
  return url.origin;
}

export function createProductionManifest(source, input) {
  const origin = productionOrigin(input);
  if (typeof source !== 'string' || !source.includes(developmentOrigin)) {
    throw new Error('來源 manifest 沒有預期的開發網址，未產生正式檔。');
  }
  const output = source.replaceAll(developmentOrigin, origin);
  // XML namespaces legitimately use http; check only navigable URL values.
  const resourceUrls = [...output.matchAll(/(?:DefaultValue="|<AppDomain>)(https?:\/\/[^"<]+)/g)].map(match => match[1]);
  if (!resourceUrls.length || resourceUrls.some(value => !value.startsWith(`${origin}/`) && value !== origin)) {
    throw new Error('Manifest 仍含未轉換的資源網址，請先檢查來源檔。');
  }
  return output;
}

async function main(args) {
  if (args.length !== 1 && !(args.length === 3 && args[1] === '--output')) {
    throw new Error('用法：npm run manifest:production -- https://addin.company.example [--output manifest.production.xml]');
  }
  const outputPath = args.length === 3 ? resolve(args[2]) : defaultOutputPath;
  if (outputPath.toLowerCase() === sourcePath.toLowerCase()) {
    throw new Error('正式 manifest 不得覆蓋開發用 manifest.xml。');
  }
  const manifest = createProductionManifest(await readFile(sourcePath, 'utf8'), args[0]);
  await writeFile(outputPath, manifest, 'utf8');
  console.log(`已產生 ${outputPath}。部署網站後，請驗證此 XML 並交由 Microsoft 365 管理員部署。此命令不會部署網站或連線租戶。`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
