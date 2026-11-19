import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.dirname(fileURLToPath(import.meta.url));
const webRoot = fs.realpathSync(path.join(appRoot, 'web'));
const port = Number(process.env.SENDMODES_PORT || 3443);
const instance = process.env.SENDMODES_INSTANCE;
const pfx = fs.readFileSync(process.env.SENDMODES_PFX);
const passphrase = process.env.SENDMODES_PFX_PASSWORD;
delete process.env.SENDMODES_PFX_PASSWORD;
if (!instance || !passphrase || !Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error('Invalid local server configuration');
}
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const hosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]);
function handle(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!hosts.has((req.headers.host || '').toLowerCase())) { res.writeHead(421).end(); return; }
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }).end(); return; }
  let urlPath;
  try { urlPath = decodeURIComponent(req.url.split('?')[0]); }
  catch { res.writeHead(400).end(); return; }
  if (urlPath === '/health') {
    res.setHeader('Content-Type', 'application/json');
    res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ app: 'outlook-send-modes', instance, version: '1.6.2' }));
    return;
  }
  if (urlPath === '/') urlPath = '/taskpane.html';
  if (urlPath.includes('\\') || urlPath.includes('\0')) { res.writeHead(400).end(); return; }
  try {
    const file = fs.realpathSync(path.resolve(webRoot, '.' + urlPath));
    if (!file.startsWith(webRoot + path.sep) || !fs.statSync(file).isFile()) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    res.setHeader('Content-Length', fs.statSync(file).size);
    if (req.method === 'HEAD') { res.end(); return; }
    const stream = fs.createReadStream(file);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  } catch { res.writeHead(404).end(); }
}
const servers = ['127.0.0.1', '::1'].map(host => {
  const server = https.createServer({ pfx, passphrase, minVersion: 'TLSv1.2' }, handle);
  server.on('error', err => {
    process.stderr.write(`Local HTTPS service failed: ${err.code || 'unknown'}\n`);
    process.exit(1);
  });
  server.listen({ host, port, ipv6Only: host === '::1' });
  return server;
});
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
  for (const server of servers) server.close();
  setTimeout(() => process.exit(0), 1000).unref();
});
