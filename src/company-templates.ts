import catalog from '../outlook-templates/templates.json';
import type { Recipient } from './types';

export interface CompanyField { key: string; label: string; default: string; placeholder: string }
export interface CompanyTemplate {
  id: string; name: string; subject: string; file: string;
  to: {name: string; email: string}[]; cc: {name: string; email: string}[];
  layout: string; fields?: CompanyField[]; introFields?: CompanyField[]; subjectFields?: CompanyField[];
  columns?: CompanyField[]; defaultRows?: number; rowBackground?: {odd: string; even: string};
}
export interface CompanyValues { fields: Record<string, string>; rows: Record<string, string>[] }
export interface RenderedCompanyTemplate { id: string; html: string; subject: string; to: Recipient[]; cc: Recipient[] }
export const companyTemplates: readonly CompanyTemplate[] = import.meta.env.VITE_COMPANY_DEPLOYMENT==='1' ? [] : catalog.templates;
const sources = (import.meta.env.VITE_COMPANY_DEPLOYMENT==='1' ? {} : import.meta.glob('../outlook-templates/templates/*.html', {query: '?raw', import: 'default', eager: true})) as Record<string, string>;
const defaults = (fields: CompanyField[] = []) => Object.fromEntries(fields.map(field => [field.key, field.default]));
export function companyDefaults(template: CompanyTemplate): CompanyValues {
  return {
    fields: defaults([...(template.subjectFields || []), ...(template.introFields || []), ...(template.fields || [])]),
    rows: template.layout === 'list' ? Array.from({length: template.defaultRows || 1}, () => defaults(template.columns)) : [],
  };
}
export const escapeCompanyValue = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\r\n|\r|\n/g, '<br>');

/** Substitute only in the source, never reparse or recursively substitute user values. */
export function renderCompanyTemplate(template: CompanyTemplate, values: CompanyValues): RenderedCompanyTemplate {
  const source = sources[`../outlook-templates/${template.file}`];
  if (source === undefined) throw new Error('找不到公司範本來源。');
  const fields = {...defaults([...(template.subjectFields || []), ...(template.introFields || []), ...(template.fields || [])]), ...values.fields};
  const replace = (input: string, data: Record<string, string>, html: boolean) => input.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_match, key: string) => {
    if (!Object.hasOwn(data, key) || typeof data[key] !== 'string') throw new Error(`範本欄位無效：${key}`);
    return html ? escapeCompanyValue(data[key]) : data[key];
  });
  let html: string;
  if (template.layout === 'list') {
    if (!values.rows.length) throw new Error('工作清單至少保留一列。');
    const parts = source.match(/^([\s\S]*?)<!--ROW START-->([\s\S]*?)<!--ROW END-->([\s\S]*)$/);
    if (!parts || !template.rowBackground) throw new Error('工作清單範本結構無效。');
    html = replace(parts[1], fields, true) + values.rows.map((row, index) => replace(parts[2], {
      ...defaults(template.columns), ...row, row_n: String(index + 1), row_bg: index % 2 ? template.rowBackground!.even : template.rowBackground!.odd,
    }, true)).join('') + replace(parts[3], fields, true);
  } else html = replace(source, fields, true);
  const subject = replace(template.subject, fields, false);
  if (subject.length > 255 || /[\r\n]/.test(subject)) throw new Error('主旨須在 255 字元內，且不可換行。');
  if (html.length > 990_000) throw new Error('範本內容過長，請減少文字或工作列。');
  const recipients = (list: CompanyTemplate['to']) => list.map(person => ({displayName: person.name, emailAddress: person.email}));
  return {id: `company:${template.id}`, html, subject, to: recipients(template.to), cc: recipients(template.cc)};
}
