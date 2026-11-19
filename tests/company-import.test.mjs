import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { dirname, basename, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseFragment } from 'parse5';
import { importLegacyTemplates, writeImportedState, htmlToText } from '../scripts/company-import.mjs';
import { validateState } from '../server/catalog.mjs';

const createdAt = new Date('2026-11-16T00:00:00.000Z');
const load = () => importLegacyTemplates({owner: 'IT', now: createdAt});
const walk = (node, tag) => [...(node.tagName === tag ? [node] : []), ...(node.childNodes || []).flatMap(child => walk(child, tag))];
const text = node => node.nodeName === '#text' ? node.value : (node.childNodes || []).map(text).join('');
async function temporary(t) {
  const directory = await mkdtemp(join(tmpdir(), 'company-import-'));
  t.after(async () => {
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('company-import-')) throw new Error('Unsafe test cleanup path');
    await rm(directory, {recursive: true, force: true});
  });
  return directory;
}

test('approved source templates become four private drafts with no recipients or publication', async () => {
  const source = JSON.parse(await readFile('outlook-templates/templates.json', 'utf8'));
  const imported = await load();
  assert.equal(imported.drafts.length, 4); assert.deepEqual(imported.published, []); assert.deepEqual(imported.history, []);
  assert.deepEqual(imported.drafts.map(template => template.id), source.templates.map(template => template.id));
  assert.deepEqual(validateState(imported), imported);
  for (const template of imported.drafts) {
    assert.equal(template.owner, 'IT'); assert.equal(template.updatedAt, createdAt.toISOString());
    for (const key of ['to', 'cc', 'bcc']) assert.equal(Object.hasOwn(template, key), false);
    assert.equal(walk(parseFragment(template.bodyHtml), 'table').length, 2);
    assert.match(template.bodyHtml, /background:#1f4e79;color:#ffffff/);
    assert.equal(template.bodyHtml.includes('<!--'), false);
    assert.match(template.bodyText, /Hi /);
    assert(template.fields.every(field => field.type === 'text' && field.required === false));
    const originals = source.templates.find(item => item.id === template.id);
    assert.equal(template.subject, originals.subject);
    for (const field of [...(originals.subjectFields || []), ...(originals.introFields || []), ...(originals.fields || [])]) {
      const mapped = template.fields.find(item => item.key === field.key);
      assert.equal(mapped.label, field.label); assert.equal(mapped.defaultValue, field.default);
    }
  }
  const serialized = JSON.stringify(imported);
  for (const template of source.templates) for (const person of [...template.to, ...template.cc]) assert.equal(serialized.includes(person.email), false);
});

test('work list keeps four numbered rows, exact text and alternating approved colors', async () => {
  const imported = await load();
  const template = imported.drafts.find(item => item.id === 'wfh-tasklist');
  assert.equal(template.fields.length, 13);
  const root = parseFragment(template.bodyHtml), inner = walk(root, 'table')[1], rows = walk(inner, 'tr');
  assert.equal(rows.length, 5);
  for (let row = 1; row <= 4; row++) {
    const cells = walk(rows[row], 'td');
    assert.equal(text(cells[0]), String(row));
    assert.match(cells[0].attrs.find(attr => attr.name === 'style').value, row % 2 ? /background:#ffffff/ : /background:#f8fafc/);
    for (const [index, key] of ['case', 'client', 'work'].entries()) assert.equal(text(cells[index + 1]), `{{${key}_row${row}}}`);
    assert.equal(template.fields.find(field => field.key === `case_row${row}`).defaultValue, '#');
  }
  const original = await readFile('outlook-templates/templates/wfh-tasklist.html', 'utf8');
  assert.equal(htmlToText(original).split('\n')[0], template.bodyText.split('\n')[0]);
  assert.match(template.bodyText, /下班前會再回報完成狀況，以上，謝謝。/);
  assert.equal(/row_bg|row_n|ROW START|ROW END/.test(template.bodyHtml), false);
});

test('imported drafts pass the actual client parser and render every preserved default', async () => {
  const {JSDOM} = await import('jsdom');
  const dom = new JSDOM('');
  const originals = new Map();
  for (const key of ['window', 'document', 'DOMParser', 'NodeFilter']) {originals.set(key, globalThis[key]); globalThis[key] = dom.window[key];}
  const {createServer} = await import('vite');
  const server = await createServer({configFile: false, server: {middlewareMode: true}, appType: 'custom'});
  try {
    const {parseCatalog, renderCatalogTemplate, fieldDefaults} = await server.ssrLoadModule('/src/catalog.ts');
    const state = await load(), catalog = parseCatalog({schemaVersion: 1, revision: state.revision, templates: state.drafts});
    assert.equal(catalog.templates.length, 4);
    for (const template of catalog.templates) {
      const rendered = renderCatalogTemplate(template, fieldDefaults(template));
      assert.equal(/\{\{|\}\}/.test(rendered.html), false);
      assert.equal(/\{\{|\}\}/.test(rendered.text), false);
      assert.match(rendered.html, /<table/);
    }
  } finally {
    await server.close(); dom.window.close();
    for (const [key, value] of originals) if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
  }
});

test('exclusive output refuses overwrites, public paths and any published input', async t => {
  const directory = await temporary(t), state = await load(), target = join(directory, 'private', 'catalog-state.json');
  await writeImportedState(target, state);
  const before = await readFile(target, 'utf8');
  await assert.rejects(writeImportedState(target, state), error => error.code === 'EEXIST');
  assert.equal(await readFile(target, 'utf8'), before);
  await assert.rejects(writeImportedState(join(directory, 'dist', 'state.json'), state), /非公開/);
  await assert.rejects(writeImportedState(join(directory, 'public', 'state.json'), state), /非公開/);
  await assert.rejects(writeImportedState(join(directory, 'web', 'state.json'), state, {distDir: join(directory, 'web')}), /非公開/);
  await assert.rejects(writeImportedState(join(directory, 'private', 'published.json'), {...state, published: [state.drafts[0]]}), /未發布/);
});

test('source traversal and unsafe markup fail before output creation', async t => {
  const directory = await temporary(t), source = join(directory, 'source'); await mkdir(source);
  await writeFile(join(directory, 'outside.html'), '<p>外部資料</p>');
  const manifest = {templates: [{id: 'bad', name: 'Bad', subject: '', layout: 'fields', fields: [], file: '../outside.html'}]};
  await writeFile(join(source, 'templates.json'), JSON.stringify(manifest));
  await assert.rejects(importLegacyTemplates({sourceDir: source, owner: 'IT'}), /位於範本目錄/);
  manifest.templates[0].file = 'bad.html'; await writeFile(join(source, 'templates.json'), JSON.stringify(manifest));
  await writeFile(join(source, 'bad.html'), '<p onclick="alert(1)">危險內容</p>');
  await assert.rejects(importLegacyTemplates({sourceDir: source, owner: 'IT'}), /屬性不安全/);
  await assert.rejects(importLegacyTemplates({sourceDir: source}), /--owner/);
});
