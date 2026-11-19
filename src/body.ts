import { parse } from 'parse5';
import type { DefaultTreeAdapterMap } from 'parse5';
import { stabilizeTemplateTables } from './template-layout';

type Node = DefaultTreeAdapterMap['node'];
export interface ManagedBlock { start: number; end: number; html: string; text: string }
export function findManagedBlock(html:string, token:string, label: '模板' | '簽章' = '模板'): ManagedBlock | null {
  const tree = parse(html,{sourceCodeLocationInfo:true});
  const matches: DefaultTreeAdapterMap['element'][] = [];
  function walk(node:Node) {
    // Outlook may namespace HTML identifiers on read-back. Match only the exact
    // per-draft token after known x_ prefixes; never use substring matching.
    const matchesToken = (value:string) => value.replace(/^(?:x_)+/,'')===token;
    if ('attrs' in node && node.attrs.some(a=>
      (a.name==='id' && matchesToken(a.value)) ||
      (a.name==='class' && a.value.split(/\s+/).some(matchesToken)))) matches.push(node);
    if ('childNodes' in node) node.childNodes.forEach(walk);
  }
  walk(tree);
  if (!matches.length) return null;
  if (matches.length !== 1) throw new Error(`${label}標記重複，已停止以保護郵件內容。請在新的草稿套用。`);
  const node = matches[0];
  const loc = node.sourceCodeLocation;
  if (node.tagName !== 'div' || !loc?.startTag || !loc.endTag) throw new Error(`${label}邊界已變更，無法安全替換。請保留本封資料，在新的草稿套用。`);
  const block = html.slice(loc.startOffset,loc.endOffset);
  const preview = new DOMParser().parseFromString(block.replace(/<\/(p|div|tr|li)>/gi,'</$1>\n'), 'text/html');
  preview.querySelectorAll('style,script').forEach(node=>node.remove());
  const text = preview.body.textContent || '';
  return {start:loc.startOffset,end:loc.endOffset,html:block,text:text.trim()};
}
export function wrapTemplate(html:string, token:string): string {
  if (!/^(?:send-mode|company-template)-[a-z0-9-]+$/.test(token)) throw new Error('模板識別碼無效。');
  // Body APIs require internal CSS. Keep inline declarations as an editing
  // fallback too; unique per-block classes avoid dependence on an ancestor ID.
  const doc = new DOMParser().parseFromString(html,'text/html');
  stabilizeTemplateTables(doc.body);
  const rules:string[]=[];
  doc.body.querySelectorAll('[style]').forEach((node,index)=>{
    const name=`${token}-format-${index}`;
    rules.push(`.${name},.x_${name},.x_x_${name}{${node.getAttribute('style')}}`);
    node.setAttribute('class',name);
  });
  // Legacy table attributes also keep usable borders if the host drops CSS.
  doc.body.querySelectorAll('table').forEach(table=>{
    if (!table.hasAttribute('border')) table.setAttribute('border','1');
    if (!table.hasAttribute('cellpadding')) table.setAttribute('cellpadding','8');
    if (!table.hasAttribute('cellspacing')) table.setAttribute('cellspacing','0');
  });
  return `<div id="${token}" class="${token}">${rules.length ? `<style>${rules.join('\n')}</style>` : ''}${doc.body.innerHTML}</div>`;
}
export function replaceManagedBlock(body:string, block:ManagedBlock, html:string): string {
  // Splice source offsets: do not parse/serialize or sanitize any original message content.
  return body.slice(0,block.start) + html + body.slice(block.end);
}
/** Compare content, links, inline images and tables while tolerating host HTML normalization. */
export function contentEvidence(html:string, imageIdentity = (source:string|null)=>source):string {
  const doc=new DOMParser().parseFromString(html,'text/html');
  doc.querySelectorAll('style,script').forEach(node=>node.remove());
  return JSON.stringify({
    text:(doc.body.textContent || '').replace(/\s+/g,''),
    images:Array.from(doc.body.querySelectorAll('img')).map(node=>[imageIdentity(node.getAttribute('src')),node.getAttribute('alt') || '']),
    links:Array.from(doc.body.querySelectorAll('a[href]')).map(node=>node.getAttribute('href')),
    tables:doc.body.querySelectorAll('table').length,
    cells:doc.body.querySelectorAll('td,th').length,
  });
}

/** Content guard for the recipient/subject phase ONLY, when no more body writes
 * can occur. Ignore host formatting/serialization changes, not text or media edits.
 * Never use this to authorize replacing a body from an older HTML snapshot. */
export function bodyEditEvidence(html: string, imageIdentity = (source:string|null)=>source): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('style,script,meta,link').forEach(node=>node.remove());
  const blockTags = new Set(['p','div','pre','blockquote','li','ul','ol','table','tr','td','th','h1','h2','h3','h4','h5','h6']);
  const readText = (node: globalThis.Node): string => {
    if (node.nodeType === 3) return node.parentElement?.closest('pre') ? node.textContent || '' : (node.textContent || '').replace(/[\t\r\n\f ]+/g,' ');
    if (node.nodeType !== 1) return '';
    const tag = (node as Element).localName;
    if (tag === 'br' || tag === 'hr') return '\n';
    if (tag === 'img') return '\uFFFC';
    const text = Array.from(node.childNodes).map(readText).join('');
    return blockTags.has(tag) ? `\n${text}\n` : text;
  };
  const text = (node: globalThis.Node) => readText(node).replace(/[\t\r\f\v \u00a0]+/g,' ')
    .split('\n').map(line=>line.trim()).filter(Boolean).join('\n');
  return JSON.stringify({
    text: text(doc.body),
    images: Array.from(doc.body.querySelectorAll('img')).map(node=>[imageIdentity(node.getAttribute('src')),node.getAttribute('alt') || '']),
    links: Array.from(doc.body.querySelectorAll('a[href]')).map(node=>[node.getAttribute('href'),text(node)]),
    tables: Array.from(doc.body.querySelectorAll('table')).map(table=>Array.from(table.rows).map(row=>
      Array.from(row.cells).map(cell=>[cell.rowSpan,cell.colSpan,text(cell)]))),
  });
}

export async function templateHash(html:string):Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(html));
  return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
