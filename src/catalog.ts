import { sanitizeTemplate } from './model';

export interface CatalogField {
  key: string;
  label: string;
  type: 'text' | 'date' | 'number' | 'select';
  required: boolean;
  defaultValue?: string;
  options?: string[];
}
export interface CatalogTemplate {
  id: string; name: string; category: string; tags: string[]; language: string;
  version: string; updatedAt: string; subject: string; bodyHtml: string; bodyText: string;
  fields: CatalogField[]; owner: string; audience: string[];
}
export interface Catalog { schemaVersion: 1; revision: string; templates: CatalogTemplate[] }
export type CatalogValues = Record<string, string>;

const tokenPattern = /\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const fail = (detail: string): never => { throw new Error(`公司範本格式無效：${detail}`); };
function string(value: unknown, max: number, label: string, required = true): string {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim()) || /\u0000/.test(value)) return fail(label);
  return value;
}
function identifier(value: unknown, label: string): string {
  const result = string(value, 80, label);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(result)) return fail(label);
  return result;
}
function strings(value: unknown, maxCount: number, label: string): string[] {
  if (!Array.isArray(value) || value.length > maxCount) return fail(label);
  const list = value.map(item => string(item, 200, label));
  if (new Set(list).size !== list.length) return fail(`${label}重複`);
  return list;
}
function checkMarkers(source: string, fields: Set<string>): void {
  const rest = source.replace(tokenPattern, (_token, key: string) => {
    if (!fields.has(key)) fail(`未定義欄位 ${key}`);
    return '';
  });
  if (/\{\{|\}\}/.test(rest)) fail('欄位請使用 {{field_name}}');
}
function safeHtml(source: string, fields: Set<string>): string {
  checkMarkers(source, fields);
  const document = new DOMParser().parseFromString(source, 'text/html');
  // Validate before sanitizing so a marker is never silently removed from an attribute.
  for (const element of document.querySelectorAll('*')) {
    for (const attribute of element.attributes) {
      if (/\{\{|\}\}/.test(attribute.value) || /\{\{|\}\}/.test(attribute.name)) fail('變數只能放在內文文字，不能放在 HTML 屬性');
    }
  }
  const walker = document.createTreeWalker(document, NodeFilter.SHOW_COMMENT);
  while (walker.nextNode()) if (/\{\{|\}\}/.test(walker.currentNode.nodeValue || '')) fail('變數不能放在 HTML 註解');
  const clean = sanitizeTemplate(source);
  checkMarkers(clean, fields);
  if (!new DOMParser().parseFromString(clean, 'text/html').body.textContent?.trim()) fail('內文不可空白');
  return clean;
}
function checkFieldValue(field: CatalogField, value: string, required: boolean): void {
  if (value.length > 10_000 || /\u0000/.test(value)) throw new Error(`${field.label}內容過長或格式無效。`);
  if (!value.trim()) {
    if (required && field.required) throw new Error(`請填寫${field.label}。`);
    return;
  }
  if (field.type === 'date') {
    const date = new Date(`${value}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error(`${field.label}請使用有效日期。`);
  }
  if (field.type === 'number' && (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) || !Number.isFinite(Number(value)))) throw new Error(`${field.label}請填寫有效數字。`);
  if (field.type === 'select' && !field.options?.includes(value)) throw new Error(`請選擇有效的${field.label}。`);
}

/** Treat the API response as untrusted data. Never merge this into personal settings. */
export function parseCatalog(input: unknown): Catalog {
  if (!record(input) || input.schemaVersion !== 1 || !Array.isArray(input.templates) || input.templates.length > 200) return fail('版本或清單');
  if (JSON.stringify(input).length > 4_000_000) return fail('清單超過 4 MB');
  const revision = identifier(input.revision, '發布版本');
  const ids = new Set<string>();
  const templates = input.templates.map((raw): CatalogTemplate => {
    if (!record(raw)) return fail('範本');
    if (['to', 'cc', 'bcc'].some(key => key in raw)) return fail('公司範本不可設定收件者');
    if (raw.status !== undefined && raw.status !== 'published') return fail('含有未發布範本');
    const id = identifier(raw.id, '範本 ID');
    if (ids.has(id)) return fail('範本 ID 重複');
    ids.add(id);
    if (!Array.isArray(raw.fields) || raw.fields.length > 40) return fail('欄位');
    const fieldKeys = new Set<string>();
    const fields = raw.fields.map((item): CatalogField => {
      if (!record(item)) return fail('欄位');
      const key = string(item.key, 50, '欄位 ID');
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key) || ['constructor', 'prototype', '__proto__'].includes(key) || fieldKeys.has(key)) return fail('欄位 ID 無效或重複');
      fieldKeys.add(key);
      const label = string(item.label, 100, '欄位名稱');
      if (!['text', 'date', 'number', 'select'].includes(String(item.type)) || typeof item.required !== 'boolean') return fail('欄位型態');
      const type = item.type as CatalogField['type'];
      const options = item.options === undefined ? undefined : strings(item.options, 50, '選項');
      if ((type === 'select' && !options?.length) || (type !== 'select' && options !== undefined)) return fail('欄位選項');
      const defaultValue = item.defaultValue === undefined ? undefined : string(item.defaultValue, 2_000, '預設值', false);
      const field: CatalogField = {key, label, type, required: item.required, ...(options ? {options} : {}), ...(defaultValue !== undefined ? {defaultValue} : {})};
      if (defaultValue) checkFieldValue(field, defaultValue, false);
      return field;
    });
    const subject = string(raw.subject, 255, '主旨', false);
    if (/[\r\n]/.test(subject)) return fail('主旨不可換行');
    const bodyText = string(raw.bodyText, 100_000, '純文字內文');
    const bodyHtml = safeHtml(string(raw.bodyHtml, 100_000, 'HTML 內文'), fieldKeys);
    checkMarkers(subject, fieldKeys); checkMarkers(bodyText, fieldKeys);
    const updatedAt = string(raw.updatedAt, 40, '更新時間');
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(updatedAt) || !Number.isFinite(Date.parse(updatedAt)) || new Date(updatedAt).toISOString().slice(0, 19) !== updatedAt.slice(0, 19)) return fail('更新時間');
    return {
      id, name: string(raw.name, 100, '名稱'), category: string(raw.category, 100, '分類', false),
      tags: strings(raw.tags, 30, '標籤').map(tag=>string(tag,50,'標籤')), language: string(raw.language, 35, '語言'), version: identifier(raw.version, '範本版本'),
      updatedAt, subject, bodyHtml, bodyText, fields, owner: string(raw.owner, 200, '維護人'), audience: strings(raw.audience, 50, '適用對象').map(role=>string(role,100,'適用對象')),
    };
  });
  return {schemaVersion: 1, revision, templates};
}

export function fieldDefaults(template: CatalogTemplate): CatalogValues {
  return Object.fromEntries(template.fields.map(field => [field.key, field.defaultValue || '']));
}
const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/\r\n|\r|\n/g, '<br>');

/** One replacement pass; text entered by the user is never interpreted as another token. */
export function renderCatalogTemplate(template: CatalogTemplate, values: CatalogValues): {html: string; text: string; subject: string} {
  if (!record(values)) throw new Error('欄位資料無效。');
  const resolved: CatalogValues = Object.create(null) as CatalogValues;
  const keys = new Set(template.fields.map(field => field.key));
  if (Object.keys(values).some(key => !keys.has(key))) throw new Error('含有未知欄位，請重新選擇範本。');
  for (const field of template.fields) {
    const value = Object.hasOwn(values, field.key) ? values[field.key] : field.defaultValue || '';
    if (typeof value !== 'string') throw new Error(`${field.label}格式無效。`);
    checkFieldValue(field, value, true); resolved[field.key] = value;
  }
  const replace = (source: string, html: boolean) => source.replace(tokenPattern, (_token, key: string) => {
    if (!Object.hasOwn(resolved, key)) throw new Error('範本欄位已變更，請重新選擇範本。');
    return html ? escapeHtml(resolved[key]) : resolved[key];
  });
  const html = replace(template.bodyHtml, true), text = replace(template.bodyText, false), subject = replace(template.subject, false);
  if (html.length > 990_000 || text.length > 990_000) throw new Error('填寫後內容過長，請減少文字。');
  if (subject.length > 255 || /[\r\n]/.test(subject)) throw new Error('填寫後主旨須在 255 字元內，且不可換行。');
  return {html, text, subject};
}
