import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { parseFragment } from 'parse5';
import { emptyState, validateState, validateTemplate } from '../server/catalog.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDefault = resolve(repositoryRoot, 'outlook-templates');
const inside = (parent, child) => {const path = relative(parent, child); return !path || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));};
const token = /\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Semantic text fallback keeps the original words and field tokens in reading order. */
export function htmlToText(html) {
  const read = node => {
    if (node.nodeName === '#text') return node.value.replace(/\s+/g, ' ');
    if (node.tagName === 'br') return '\n';
    const text = (node.childNodes || []).map(read).join('');
    if (['td', 'th'].includes(node.tagName)) return `${text}\t`;
    if (['tr', 'table', 'p', 'div', 'li', 'h1', 'h2', 'h3', 'blockquote'].includes(node.tagName)) return `${text}\n`;
    return text;
  };
  return read(parseFragment(html)).split('\n').map(line => line.trim()).filter(Boolean).join('\n');
}

function mapField(field, suffix = '', prefix = '') {
  if (!object(field) || typeof field.key !== 'string' || typeof field.label !== 'string' || typeof field.default !== 'string') throw new Error('來源欄位格式無效。');
  // Legacy placeholders and slash-form dates are intentional defaults, so don't infer new requirements.
  return {key: `${field.key}${suffix}`, label: `${prefix}${field.label}`, type: 'text', required: false, defaultValue: field.default};
}

function convertTemplate(source, html, owner, updatedAt) {
  if (!object(source) || !['fields', 'list'].includes(source.layout)) throw new Error('來源範本版型無效。');
  const fields = [];
  for (const name of ['subjectFields', 'introFields', 'fields']) {
    if (source[name] !== undefined && !Array.isArray(source[name])) throw new Error('來源欄位清單無效。');
    for (const raw of source[name] || []) {
      const field = mapField(raw), existing = fields.find(item => item.key === field.key);
      if (existing && JSON.stringify(existing) !== JSON.stringify(field)) throw new Error('來源欄位 ID 重複且定義不同。');
      if (!existing) fields.push(field);
    }
  }
  if (source.layout === 'list') {
    if (!Number.isInteger(source.defaultRows) || source.defaultRows < 1 || source.defaultRows > 20 || !Array.isArray(source.columns)) throw new Error('來源工作清單列數或欄位無效。');
    const parts = html.match(/^([\s\S]*?)<!--ROW START-->([\s\S]*?)<!--ROW END-->([\s\S]*)$/);
    if (!parts || (html.match(/<!--ROW START-->/g) || []).length !== 1 || (html.match(/<!--ROW END-->/g) || []).length !== 1) throw new Error('來源工作清單標記無效。');
    if (!object(source.rowBackground) || !/^#[a-fA-F0-9]{6}$/.test(source.rowBackground.odd) || !/^#[a-fA-F0-9]{6}$/.test(source.rowBackground.even)) throw new Error('來源工作清單底色無效。');
    const columns = source.columns.map(column => mapField(column));
    const columnKeys = new Set(columns.map(field => field.key));
    const rows = [];
    for (let row = 1; row <= source.defaultRows; row++) {
      fields.push(...source.columns.map(column => mapField(column, `_row${row}`, `第 ${row} 列・`)));
      rows.push(parts[2].replace(token, (placeholder, key) => {
        if (key === 'row_n') return String(row);
        if (key === 'row_bg') return row % 2 ? source.rowBackground.odd : source.rowBackground.even;
        return columnKeys.has(key) ? `{{${key}_row${row}}}` : placeholder;
      }));
    }
    html = parts[1] + rows.join('') + parts[3];
  }
  // Comments are not email content and are forbidden by the central publishing validator.
  html = html.replace(/<!--[\s\S]*?-->/g, '');
  return validateTemplate({
    id: source.id, name: source.name, category: '公司範本', tags: [], language: 'zh-TW', version: 'imported-draft', updatedAt,
    subject: source.subject, bodyHtml: html, bodyText: htmlToText(html), fields, owner, audience: [],
  });
}

/** Read-only conversion. To/CC/BCC source fields are deliberately never copied. */
export async function importLegacyTemplates({sourceDir = sourceDefault, owner, now = new Date()} = {}) {
  if (typeof owner !== 'string' || !owner.trim() || owner.length > 200) throw new Error('請以 --owner 指定範本維護人。');
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('匯入時間無效。');
  const root = await realpath(resolve(sourceDir));
  const source = JSON.parse(await readFile(resolve(root, 'templates.json'), 'utf8'));
  if (!object(source) || !Array.isArray(source.templates) || !source.templates.length || source.templates.length > 200) throw new Error('來源範本清單無效。');
  const drafts = [];
  for (const template of source.templates) {
    if (!object(template) || typeof template.file !== 'string' || !/\.html$/i.test(template.file) || isAbsolute(template.file)) throw new Error('來源 HTML 路徑無效。');
    const requested = resolve(root, template.file);
    if (!inside(root, requested)) throw new Error('來源 HTML 必須位於範本目錄內。');
    const path = await realpath(requested);
    if (!inside(root, path)) throw new Error('來源 HTML 不可透過連結離開範本目錄。');
    drafts.push(convertTemplate(template, await readFile(path, 'utf8'), owner.trim(), now.toISOString()));
  }
  return validateState({...emptyState(), revision: `import-${randomUUID()}`, drafts});
}

async function canonicalFuturePath(path) {
  try { return await realpath(path); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const parent = dirname(path);
    if (parent === path) throw error;
    return resolve(await canonicalFuturePath(parent), relative(parent, path));
  }
}

/** Exclusive creation only. It cannot replace a live file-backed repository. */
export async function writeImportedState(target, state, {distDir = process.env.DIST_DIR || resolve(repositoryRoot, 'dist')} = {}) {
  if (typeof target !== 'string' || !target.trim()) throw new Error('請指定新的範本庫路徑。');
  const path = resolve(target);
  const checked = await canonicalFuturePath(path);
  const forbidden = await Promise.all([resolve(distDir), resolve(repositoryRoot, 'dist'), resolve(repositoryRoot, 'public')].map(canonicalFuturePath));
  if (forbidden.some(root => inside(root, checked)) || checked.split(/[\\/]/).some(part => /^(dist|public)$/i.test(part))) throw new Error('範本庫必須放在 dist／public 以外的非公開目錄。');
  const clean = validateState(state);
  if (clean.published.length || clean.history.length) throw new Error('匯入只能建立尚未發布的新範本庫。');
  await mkdir(dirname(path), {recursive: true});
  await writeFile(path, JSON.stringify(clean, null, 2), {encoding: 'utf8', flag: 'wx', mode: 0o600});
  return path;
}

export async function main(args = process.argv.slice(2)) {
  const [target, ...options] = args;
  if (!target || target.startsWith('--') || options.length % 2) throw new Error('用法：node scripts/company-import.mjs <新的非公開 catalog-state.json> --owner <維護人> [--source <範本目錄>]');
  const flags = new Map();
  for (let i = 0; i < options.length; i += 2) {
    if (!['--owner', '--source'].includes(options[i]) || flags.has(options[i])) throw new Error('匯入參數無效。');
    flags.set(options[i], options[i + 1]);
  }
  const state = await importLegacyTemplates({owner: flags.get('--owner'), ...(flags.has('--source') ? {sourceDir: flags.get('--source')} : {})});
  await writeImportedState(target, state);
  console.log(`已建立 ${state.drafts.length} 份公司範本草稿；未發布，亦未匯入 To／CC／BCC。請由管理者預覽、審核後發布。`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {console.error(`匯入失敗：${error.code === 'EEXIST' ? '目標檔案已存在，不會覆寫。' : error.message}`); process.exitCode = 1;});
}
