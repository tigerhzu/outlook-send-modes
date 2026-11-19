import DOMPurify from 'dompurify';
import type { FavoriteRecipient, Mode, Recipient, Settings } from './types';
import { sanitizeSignature } from './signature';
import { companyDefaults, companyTemplates, renderCompanyTemplate } from './company-templates';
import { stabilizeTemplateTables } from './template-layout';

export function defaultSettings(): Settings {
  return {
    version: 2,
    presetRevision: 1,
    modes: companyTemplates.map(template => {
      const rendered = renderCompanyTemplate(template, companyDefaults(template));
      return {
        id: template.id === 'wfh-request' ? 'remote' : template.id,
        name: template.id === 'overtime' ? '加班' : template.id === 'wfh-request' ? '居家' : template.name,
        to: rendered.to.map(person => person.emailAddress), cc: rendered.cc.map(person => person.emailAddress),
        subject: rendered.subject.trim(), bodyHtml: sanitizeTemplate(rendered.html),
      };
    }),
  };
}

/** Upgrade the former two built-ins once; future edits/deletions remain user-owned. */
export function upgradeSettings(settings: Settings): Settings {
  if (settings.presetRevision === 1) return settings;
  if (import.meta.env.VITE_COMPANY_DEPLOYMENT==='1') return {...settings,presetRevision:1};
  const defaults = defaultSettings();
  const replaced = new Set([...defaults.modes.map(mode => mode.id), 'wfh-request']);
  const modes = [...defaults.modes, ...settings.modes.filter(mode => !replaced.has(mode.id) && !companyTemplates.some(template => mode.id === `company:${template.id}`))];
  return validateSettings({...settings, modes, presetRevision: 1});
}

/** Only sanitize user templates, NEVER the existing Outlook body/signature/history. */
export function sanitizeTemplate(html: string): string {
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p','div','span','br','b','strong','i','em','u','s','ul','ol','li','table','colgroup','col','thead','tbody','tfoot','tr','td','th','h1','h2','h3','blockquote'],
    ALLOWED_ATTR: ['style','colspan','rowspan','role','width','cellpadding','cellspacing','border'], ALLOW_DATA_ATTR: false,
  });
  const doc = new DOMParser().parseFromString(clean, 'text/html');
  stabilizeTemplateTables(doc.body);
  const safeStyles = new Set(['color','background','background-color','font-family','font-size','font-weight','font-style','line-height','text-decoration','text-align','vertical-align','border','border-top','border-bottom','border-left','border-right','border-collapse','border-spacing','padding','width','height','table-layout','overflow-wrap','word-wrap']);
  doc.body.querySelectorAll<HTMLElement>('[style]').forEach(el => {
    const rules: string[] = [];
    // Read approved properties explicitly: CSSOM may expand shorthand declarations
    // (padding, border, vertical-align) into longhands when enumerating a style.
    for (const prop of safeStyles) {
      const value = el.style.getPropertyValue(prop);
      if (value && !/url\s*\(|image(?:-set)?\s*\(|expression|var\s*\(|@|[<>\\]/i.test(value)) rules.push(`${prop}:${value}`);
    }
    if (rules.length) el.setAttribute('style', rules.join(';')); else el.removeAttribute('style');
  });
  return doc.body.innerHTML;
}

export const isEmail = (value: string): boolean => /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(value) && value.length <= 254;

/** Free text stays in the editor; saved modes contain addresses, never contact IDs. */
export const splitEmails = (text: string): string[] => text.split(/[;,\n，；]+/).map(value=>value.trim()).filter(Boolean);
const uniqueEmails = (values: string[]): string[] => {
  const seen = new Set<string>();
  return values.filter(value=>{const key=value.toLowerCase();if(seen.has(key))return false;seen.add(key);return true;});
};

export function validateSettings(input: unknown): Settings {
  if (!input || typeof input !== 'object') throw new Error('設定檔格式錯誤。');
  // Version 1 used contact IDs. Read it in place; the store only writes on Save.
  const data = input as {version:number;presetRevision?:1;contacts?:{id:string;name:string;email:string}[];modes:Mode[];signatureHtml?:string;favorites?:FavoriteRecipient[]};
  if (data.presetRevision !== undefined && data.presetRevision !== 1) throw new Error('不支援此範本版本。');
  if (![1,2].includes(data.version) || !Array.isArray(data.modes)) throw new Error('不支援此設定檔版本。');
  if (data.modes.length > 100) throw new Error('最多可儲存 100 個模式。');
  const str = (v: unknown, max: number) => typeof v === 'string' && v.length <= max;
  const legacy = new Map<string,string>();
  if(data.version === 1) {
    if(!Array.isArray(data.contacts) || data.contacts.length > 500) throw new Error('舊版聯絡人清單無效。');
    for(const c of data.contacts) {
      if(!c || !str(c.id,100) || !c.id || legacy.has(c.id) || !str(c.name,200) || !c.name.trim() || !str(c.email,254)) throw new Error('舊版聯絡人識別碼或 Email 格式錯誤。');
      const email=c.email.trim();
      if(email && !isEmail(email)) throw new Error('舊版 Email 格式不正確。');
      legacy.set(c.id,email);
    }
  }
  const modeIds = new Set<string>();
  const modes = data.modes.map(m => {
    if (!m || !str(m.id,100) || !m.id || modeIds.has(m.id) || !str(m.name,100) || !m.name.trim() || !str(m.subject,255) || !str(m.bodyHtml,100_000)) throw new Error('模式名稱、主旨或內文格式錯誤／超過大小限制。');
    modeIds.add(m.id);
    const addresses = (list: unknown, field: string): string[] => {
      if(!Array.isArray(list) || list.length > 100 || list.some(value=>typeof value !== 'string')) throw new Error(`${m.name} 的 ${field} 清單無效，最多 100 位。`);
      const emails = list.map(value=>{
        if(data.version===1) {
          if(!legacy.has(value)) throw new Error(`${m.name} 的舊版收件人清單無效。`);
          return legacy.get(value)!;
        }
        const email=value.trim();
        if(email && !isEmail(email)) throw new Error(`${m.name} 的 ${field} Email 格式不正確：${email}`);
        return email;
      });
      // Preserve blank legacy recipients as blockers, especially CC; never drop one silently.
      return uniqueEmails(emails);
    };
    return {id:m.id,name:m.name.trim(),to:addresses(m.to,'To'),cc:addresses(m.cc,'CC'),subject:m.subject,bodyHtml:sanitizeTemplate(m.bodyHtml)};
  });
  if (data.signatureHtml !== undefined && !str(data.signatureHtml,750_000)) throw new Error('簽章過大，請縮小圖片後再儲存。');
  const favoriteIds=new Set<string>();
  let favorites: FavoriteRecipient[] | undefined;
  if(data.favorites !== undefined) {
    if(!Array.isArray(data.favorites) || data.favorites.length>500) throw new Error('常用地址最多 500 位。');
    favorites=data.favorites.map(person=>{
      if(!person || !str(person.id,100) || !person.id || favoriteIds.has(person.id) || !str(person.name,200) || !str(person.email,254) || !isEmail(person.email.trim())) throw new Error('請填寫有效的常用 Email。');
      favoriteIds.add(person.id);
      return {id:person.id,name:person.name.trim(),email:person.email.trim()};
    });
    const emails=new Set<string>();
    favorites=favorites.filter(person=>{const key=person.email.toLowerCase();if(emails.has(key))return false;emails.add(key);return true;});
  }
  return {version:2,modes,...(data.presetRevision === 1 ? {presetRevision:1 as const} : {}),...(data.signatureHtml !== undefined ? {signatureHtml:sanitizeSignature(data.signatureHtml)} : {}),...(favorites !== undefined ? {favorites} : {})};
}

export function missingRecipients(mode: Mode): string[] {
  const missing: string[] = [];
  if(!mode.to.length || mode.to.some(email=>!isEmail(email.trim()))) missing.push('To');
  if(mode.cc.some(email=>!isEmail(email.trim()))) missing.push('CC');
  return missing;
}

export function resolveRecipients(mode: Mode): {to:Recipient[];cc:Recipient[]} {
  const missing = missingRecipients(mode);
  if (missing.length) throw new Error(`請填寫有效 Email：${missing.join('、')}。`);
  const seen = new Set<string>();
  const resolve = (emails:string[]) => emails.flatMap(email => {
    const emailAddress = email.trim();
    const key = emailAddress.toLowerCase();
    if (seen.has(key)) return [];
    seen.add(key); return [{displayName:emailAddress,emailAddress}];
  });
  return {to:resolve(mode.to),cc:resolve(mode.cc)};
}
