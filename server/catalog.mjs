import { parseFragment, serialize } from 'parse5';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const fail = (status, message) => { throw new HttpError(status, message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, max, label, required = false) => {
  if (typeof value !== 'string' || value.length > max || /\u0000/.test(value) || (required && !value.trim())) fail(400, `${label}格式無效。`);
  return value;
};
const list = (value, max, label) => { if (!Array.isArray(value) || value.length > max) fail(400, `${label}格式無效。`); return value; };
const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/;
const keyPattern = /^[a-zA-Z][a-zA-Z0-9_]{0,49}$/;
const validId = value => typeof value === 'string' && idPattern.test(value);
const allowedTags = new Set(['p','div','span','br','b','strong','i','em','u','s','ul','ol','li','table','colgroup','col','thead','tbody','tfoot','tr','td','th','h1','h2','h3','blockquote']);
const allowedAttrs = new Set(['style','colspan','rowspan','role','width','cellpadding','cellspacing','border']);
const allowedStyles = new Set(['color','background','background-color','font-family','font-size','font-weight','font-style','line-height','text-decoration','text-align','vertical-align','border','border-top','border-bottom','border-left','border-right','border-collapse','border-spacing','padding','width','height','table-layout','overflow-wrap','word-wrap']);

/** Company publishing is restrictive: reject active content instead of silently publishing a different template. */
export function validateHtml(html, fields) {
  const fragment = parseFragment(html);
  const keys = new Set(fields.map(field => field.key));
  const placeholders = value => {
    for (const match of value.matchAll(/\{\{([^{}]+)\}\}/g)) if (!keys.has(match[1])) fail(400, `範本欄位未定義：${match[1]}`);
    if (/\{\{|\}\}/.test(value.replace(/\{\{[^{}]+\}\}/g, ''))) fail(400, '範本變數格式無效。');
  };
  const walk = node => {
    if (node.nodeName === '#comment') fail(400, '公司範本不可包含 HTML 註解。');
    if (node.nodeName === '#text') placeholders(node.value);
    if (node.tagName) {
      if (!allowedTags.has(node.tagName) || node.namespaceURI !== 'http://www.w3.org/1999/xhtml') fail(400, `範本不支援 ${node.tagName} 元素。`);
      for (const attr of node.attrs) {
        if (!allowedAttrs.has(attr.name) || attr.namespace || /\{\{|\}\}/.test(attr.value)) fail(400, '範本屬性不安全，變數僅能放在文字內容。');
        if (attr.name === 'style') {
          for (const rule of attr.value.split(';').filter(rule => rule.trim())) {
            const split = rule.indexOf(':');
            const prop = rule.slice(0, split).trim().toLowerCase();
            const value = rule.slice(split + 1).trim();
            if (split < 0 || !allowedStyles.has(prop) || !value || /url\s*\(|expression|var\s*\(|@|[<>\\]|\/\*|\*\//i.test(value) || /[a-z-]+\s*\(/i.test(value.replace(/\b(?:rgb|rgba|hsl|hsla)\([\d\s.,%+-]+\)/gi, ''))) fail(400, '範本樣式不安全。');
          }
        } else if (/[^\w\s.%:#-]/.test(attr.value)) fail(400, '範本屬性格式無效。');
      }
    }
    for (const child of node.childNodes || []) walk(child);
  };
  walk(fragment);
  return {html: serialize(fragment), placeholders};
}

export function validateTemplate(input) {
  if (!object(input)) fail(400, '範本格式無效。');
  if (!validId(input.id)) fail(400, '範本 ID 格式無效。');
  for (const forbidden of ['to','cc','bcc']) if (Object.hasOwn(input, forbidden)) fail(400, '公司範本不可指定收件者。');
  const fields = list(input.fields, 40, '欄位').map(field => {
    if (!object(field) || typeof field.key !== 'string' || !keyPattern.test(field.key) || ['constructor','prototype','__proto__'].includes(field.key) || !['text','date','number','select'].includes(field.type) || typeof field.required !== 'boolean') fail(400, '欄位定義無效。');
    const clean = {key: field.key, label: text(field.label, 100, '欄位名稱', true), type: field.type, required: field.required};
    if (field.defaultValue !== undefined) clean.defaultValue = text(field.defaultValue, 2000, '欄位預設值');
    if (field.type === 'select') {
      clean.options = list(field.options, 50, '選項').map(option => text(option, 200, '選項', true));
      if (!clean.options.length || new Set(clean.options).size !== clean.options.length || (clean.defaultValue && !clean.options.includes(clean.defaultValue))) fail(400, '選項或預設值無效。');
    } else if (field.options !== undefined) fail(400, '只有選單欄位可設定選項。');
    if (clean.defaultValue && clean.type === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(clean.defaultValue) || !Number.isFinite(Date.parse(clean.defaultValue)) || new Date(clean.defaultValue).toISOString().slice(0,10) !== clean.defaultValue)) fail(400, '日期預設值無效。');
    if (clean.defaultValue && clean.type === 'number' && (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(clean.defaultValue) || !Number.isFinite(Number(clean.defaultValue)))) fail(400, '數字預設值無效。');
    return clean;
  });
  if (new Set(fields.map(field => field.key)).size !== fields.length) fail(400, '欄位名稱不可重複。');
  const subject = text(input.subject, 255, '主旨');
  if (/[\r\n]/.test(subject)) fail(400, '主旨不可換行。');
  const bodyText = text(input.bodyText, 100_000, '純文字內文', true);
  const {html, placeholders} = validateHtml(text(input.bodyHtml, 100_000, 'HTML 內文', true), fields);
  if (!html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim()) fail(400, '範本內文不可空白。');
  placeholders(subject); placeholders(bodyText);
  const version = text(input.version, 80, '版本', true);
  if (!idPattern.test(version)) fail(400, '版本格式無效。');
  const updatedAt = text(input.updatedAt, 40, '更新時間', true);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(updatedAt) || !Number.isFinite(Date.parse(updatedAt))) fail(400, '更新時間格式無效。');
  const language = text(input.language, 35, '語言', true);
  if (!/^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/.test(language)) fail(400, '語言格式無效。');
  const audience = list(input.audience, 50, '適用對象').map(role => text(role, 100, '適用對象', true));
  const tags = list(input.tags, 30, '標籤').map(tag => text(tag, 50, '標籤', true));
  return {id:input.id, name:text(input.name, 100, '名稱', true), category:text(input.category, 100, '分類'), tags:[...new Set(tags)], language, version, updatedAt, subject, bodyHtml:html, bodyText, fields, owner:text(input.owner, 200, '維護人', true), audience:[...new Set(audience)]};
}

export const emptyState = () => ({schemaVersion:1, revision:'initial', drafts:[], published:[], history:[]});
export function validateState(input) {
  if (!object(input) || input.schemaVersion !== 1 || !validId(input.revision)) fail(503, '範本庫格式無效。');
  const result = {schemaVersion:1, revision:input.revision};
  for (const name of ['drafts','published']) {
    result[name] = list(input[name], 200, '範本庫').map(validateTemplate);
    if (new Set(result[name].map(template => template.id)).size !== result[name].length) fail(503, '範本 ID 重複。');
  }
  result.history = list(input.history, 200, '版本紀錄').map(entry => {
    if (!object(entry) || !validId(entry.revision) || !['save','publish','withdraw','rollback'].includes(entry.action) || !validId(entry.templateId) || typeof entry.at !== 'string' || !Number.isFinite(Date.parse(entry.at)) || typeof entry.actor !== 'string') fail(503, '版本紀錄無效。');
    return {...entry, ...(entry.snapshot ? {snapshot:validateTemplate(entry.snapshot)} : {})};
  });
  if (Buffer.byteLength(JSON.stringify({schemaVersion:1,revision:result.revision,templates:result.published})) > 4_000_000) fail(413, '已發布範本總量不可超過 4 MB。');
  return result;
}
export const etag = state => `"${state.revision}"`;
export const adminView = state => ({revision:state.revision, drafts:state.drafts, published:state.published, history:state.history.map(({snapshot,...entry}) => ({...entry, ...(snapshot ? {version:snapshot.version} : {})}))});
export function catalogView(state, identity) {
  const roles = new Set(identity.roles || []);
  return {schemaVersion:1, revision:state.revision, templates:state.published.filter(template => !template.audience.length || template.audience.some(role => roles.has(role)))};
}
