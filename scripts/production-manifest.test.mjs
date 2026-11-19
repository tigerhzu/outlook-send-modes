import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { createProductionManifest, productionOrigin } from './production-manifest.mjs';

const source = await readFile(new URL('../manifest.xml', import.meta.url), 'utf8');

test('one company origin replaces every desktop resource and preserves scope', () => {
  const result = createProductionManifest(source, 'https://addin.company.example/');
  assert.equal(result.includes('https://localhost:3443'), false);
  assert.ok(result.includes('<AppDomain>https://addin.company.example</AppDomain>'));
  assert.ok(result.includes('<Permissions>ReadWriteItem</Permissions>'));
  assert.equal((result.match(/MessageComposeCommandSurface/g) || []).length, 2);
  assert.equal((result.match(/https:\/\/addin\.company\.example/g) || []).length, (source.match(/https:\/\/localhost:3443/g) || []).length);
  assert.equal(result.match(/<Id>(.*?)<\/Id>/)[1], source.match(/<Id>(.*?)<\/Id>/)[1]);
  assert.equal(/WebApplicationInfo|ReadWriteMailbox|ItemSend/.test(result), false);
});

test('rejects local aliases, credentials, paths and non-HTTPS origins', () => {
  for (const value of ['http://addin.company.example', 'https://localhost', 'https://foo.localhost', 'https://LOCALHOST.', 'https://127.2.3.4', 'https://127.1', 'https://2130706433', 'https://0x7f000001', 'https://[::1]', 'https://192.168.0.2', 'https://addin', 'https://u:p@addin.company.example', 'https://addin.company.example/path', 'https://addin.company.example/path/..', 'https://addin.company.example?', 'https://addin.company.example#', 'https://addin.company.example\\evil', ' https://addin.company.example']) {
    assert.throws(() => productionOrigin(value), undefined, value);
  }
  assert.equal(productionOrigin('https://ADDIN.company.example:8443/'), 'https://addin.company.example:8443');
});

test('fails when source resources are missing or only partly converted', () => {
  assert.throws(() => createProductionManifest('<OfficeApp/>', 'https://addin.company.example'));
  assert.throws(() => createProductionManifest(source.replace('https://localhost:3443/taskpane.html', 'http://other.example/taskpane.html'), 'https://addin.company.example'));
});

test('CLI creates the requested XML without changing source', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'send-modes-manifest-'));
  try {
    const output = join(directory, 'manifest.xml');
    const script = fileURLToPath(new URL('./production-manifest.mjs', import.meta.url));
    const run = spawnSync(process.execPath, [script, 'https://addin.company.example', '--output', output], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(await readFile(output, 'utf8'), createProductionManifest(source, 'https://addin.company.example'));
    const refused = spawnSync(process.execPath, [script, 'https://addin.company.example', '--output', fileURLToPath(new URL('../manifest.xml', import.meta.url))], { encoding: 'utf8' });
    assert.equal(refused.status, 1);
    assert.equal(await readFile(new URL('../manifest.xml', import.meta.url), 'utf8'), source);
  } finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('send-modes-manifest-'));
    await rm(directory, { recursive: true, force: true });
  }
});
