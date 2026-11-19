import assert from 'node:assert/strict';
import fs from 'node:fs';
import https from 'node:https';
import { X509Certificate } from 'node:crypto';
const certificate = new X509Certificate(fs.readFileSync(process.env.SENDMODES_TEST_CERT));
const ca = certificate.toString();
const port = Number(process.env.SENDMODES_TEST_PORT);
function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: 'localhost', servername: 'localhost', port, path, ca, ...options }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end();
  });
}
// The deployed URL is always localhost; test its actual IPv4 and IPv6 transports with TLS hostname validation enabled.
for (const family of [4, 6]) assert.equal((await request('/health', { family })).status, 200);
assert.equal(certificate.checkHost('localhost'), 'localhost');
assert.equal(certificate.checkIP('127.0.0.1'), '127.0.0.1');
assert.equal(certificate.checkIP('::1'), '::1');
const page = await request('/taskpane.html');
assert.equal(page.status, 200);
assert.match(page.body, /office\.js/);
assert.equal(page.headers['cache-control'], 'no-store');
for (const asset of page.body.matchAll(/(?:src|href)="(\.\/assets\/[^\"]+)"/g)) {
  assert.equal((await request(asset[1].substring(1))).status, 200);
}
assert.equal((await request('/icons/mail-felt-64.png')).status, 200);
assert.equal((await request('/support.html')).status, 200);
assert.equal((await request('/taskpane.html', { method: 'HEAD' })).body, '');
assert.equal((await request('/health', { method: 'POST' })).status, 405);
assert.equal((await request('/health', { headers: { Host: 'attacker.invalid' } })).status, 421);
for (const file of ['/../server.mjs', '/%2e%2e/server.mjs', '/node.exe', '/localhost.pfx', '/assets/']) {
  assert.equal((await request(file)).status, 404, file);
}
assert.equal((await request('/%00')).status, 400);
assert.equal((await request('/%ZZ')).status, 400);
assert.equal((await request('/..%5cserver.mjs')).status, 400);
console.log('HTTPS: trusted TLS, IPv4/IPv6, assets, methods, host allowlist, traversal and private-file denial passed.');
