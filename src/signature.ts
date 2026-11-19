import DOMPurify from 'dompurify';
import { parse } from 'parse5';
import type { DefaultTreeAdapterMap } from 'parse5';
import type { DraftPort } from './draft';

export interface SignatureState { version: 1; token: string; phase: 'prepared' | 'applied' }
export interface SignatureImage { name: string; source: string }
export interface SignaturePort extends DraftPort {
  readSignatureState(): Promise<SignatureState | undefined>;
  saveSignatureState(state: SignatureState): Promise<void>;
  checkSignatureImages(images: SignatureImage[]): void;
  addSignatureImage(image: SignatureImage): Promise<void>;
}
export const imageDataPattern = /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/i;
export const isPublicImageUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !/^(localhost|127\.|\[::1\])/i.test(url.hostname);
  } catch { return false; }
};

/** Only the saved signature is sanitized. Never sanitize the existing draft. */
export function sanitizeSignature(html: string): string {
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p','div','span','br','b','strong','i','em','u','s','ul','ol','li','table','thead','tbody','tfoot','tr','td','th','h1','h2','h3','blockquote','a','img','font','hr'],
    ALLOWED_ATTR: ['style','colspan','rowspan','href','src','alt','width','height','border','cellpadding','cellspacing','color','face','size'],
    ALLOW_DATA_ATTR: false,
  });
  const doc = new DOMParser().parseFromString(clean, 'text/html');
  const styles = new Set(['color','background-color','font-family','font-size','font-weight','font-style','text-decoration','text-align','vertical-align','border','border-collapse','border-spacing','padding','padding-top','padding-bottom','padding-left','padding-right','width','height','max-width','margin','margin-top','margin-bottom','margin-left','margin-right','line-height']);
  doc.body.querySelectorAll<HTMLElement>('[style]').forEach(el => {
    const rules = Array.from(el.style).flatMap(prop => {
      const value = el.style.getPropertyValue(prop);
      return styles.has(prop) && !/url\s*\(|expression|var\s*\(|@|[<>]/i.test(value) ? [`${prop}:${value}`] : [];
    });
    if (rules.length) el.setAttribute('style', rules.join(';')); else el.removeAttribute('style');
  });
  doc.body.querySelectorAll('a').forEach(link => {
    if (!/^(https?:\/\/|mailto:|tel:)/i.test(link.getAttribute('href') || '')) link.removeAttribute('href');
  });
  const images = Array.from(doc.body.querySelectorAll('img'));
  if (images.length > 20) throw new Error('簽章最多 20 張圖片。');
  for (const img of images) {
    const src = img.getAttribute('src') || '';
    if (!imageDataPattern.test(src) && !isPublicImageUrl(src)) throw new Error('圖片未完整貼入。請移除失效圖片，再用「圖片」加入原檔。');
    for (const attr of ['width','height']) if (!/^\d{1,4}$/.test(img.getAttribute(attr) || '')) img.removeAttribute(attr);
  }
  if (doc.body.innerHTML.length > 750_000) throw new Error('簽章過大，請縮小圖片後再儲存。');
  return doc.body.innerHTML;
}

export function hasSignatureContent(html = ''): boolean {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return !!doc.body.textContent?.trim() || !!doc.body.querySelector('img');
}

export function prepareSignature(html: string, token: string) {
  if (!/^send-signature-[a-z0-9-]+$/.test(token)) throw new Error('簽章識別碼無效。');
  const doc = new DOMParser().parseFromString(sanitizeSignature(html), 'text/html');
  const images: SignatureImage[] = [];
  doc.body.querySelectorAll('img').forEach((img,index) => {
    const source = img.getAttribute('src')!;
    const extension = source.match(imageDataPattern)?.[1]?.toLowerCase() || new URL(source).pathname.match(/\.(png|jpe?g|gif|webp)$/i)?.[1]?.toLowerCase() || 'png';
    const name = `${token}-${index}.${extension}`;
    images.push({ name, source });
    img.setAttribute('src', `cid:${name}`);
  });
  const rules: string[] = [];
  doc.body.querySelectorAll('[style]').forEach((el,index) => {
    const name = `signature-format-${index}`;
    rules.push(`#${token} .${name}{${el.getAttribute('style')}}`);
    el.removeAttribute('style'); el.setAttribute('class',name);
  });
  return { images, html: `<div id="${token}" class="${token}">${rules.length ? `<style>${rules.join('\n')}</style>` : ''}<br>${doc.body.innerHTML}</div>` };
}

/** Splice at the document body's end without reserializing signature/history HTML. */
export function appendSignature(body: string, signature: string): string {
  const tree = parse(body, { sourceCodeLocationInfo: true });
  let offset = body.length;
  function walk(node: DefaultTreeAdapterMap['node']) {
    if ('tagName' in node && (node.tagName === 'body' || node.tagName === 'html') && node.sourceCodeLocation?.endTag) {
      offset = Math.min(offset, node.sourceCodeLocation.endTag.startOffset);
    }
    if ('childNodes' in node) node.childNodes.forEach(walk);
  }
  walk(tree);
  return body.slice(0,offset) + signature + body.slice(offset);
}

export function alreadyContainsSignature(body: string, signature: string): boolean {
  const text = (html: string) => {
    const doc = new DOMParser().parseFromString(html,'text/html');
    doc.querySelectorAll('style,script').forEach(el=>el.remove());
    return (doc.body.textContent || '').replace(/\s+/g,'');
  };
  const needle = text(signature);
  return needle.length >= 24 && text(body).includes(needle);
}

export function readImageFile(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|gif|webp)$/i.test(file.type)) return Promise.reject(new Error('請使用 PNG、JPG、GIF 或 WebP 圖片。'));
  if (file.size > 500_000) return Promise.reject(new Error('圖片請小於 500 KB。'));
  return new Promise((resolve,reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('無法讀取圖片。'));
    reader.readAsDataURL(file);
  });
}
