import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { companyDefaults, companyTemplates, renderCompanyTemplate } from '../src/company-templates';

describe('approved company source substitution',()=>{
  for (const template of companyTemplates) it(`${template.id}: preserves source bytes except declared substitutions`,()=>{
    const values = companyDefaults(template);
    const source = readFileSync(resolve('outlook-templates',template.file),'utf8');
    let expected = source;
    if (template.layout === 'list') expected = expected.replace(/<!--ROW START-->([\s\S]*?)<!--ROW END-->/,(_match,row: string)=>values.rows.map((data,index)=>row.replace(/\{\{(\w+)\}\}/g,(_token,key: string)=>key === 'row_n' ? String(index+1) : key === 'row_bg' ? (index%2 ? '#f8fafc' : '#ffffff') : data[key])).join(''));
    expected = expected.replace(/\{\{(\w+)\}\}/g,(_match,key: string)=>values.fields[key]);
    const rendered = renderCompanyTemplate(template,values);
    // Vite raw text normalizes CRLF, so compare logical source lines.
    expect(rendered.html.replace(/\r\n/g,'\n')).toBe(expected.replace(/\r\n/g,'\n'));
    const document = new DOMParser().parseFromString(rendered.html,'text/html');
    expect(document.querySelector('table')?.getAttribute('width')).toBe('640');
    expect(document.querySelector('td[style*="background:#1f4e79"]')?.getAttribute('style')).toContain('color:#ffffff');
    expect(rendered.html).not.toContain('ROW START');
  });
  it('escapes user text once, preserves literal tokens and line breaks, leaves explicitly cleared defaults empty',()=>{
    const template = companyTemplates[0], values = companyDefaults(template);
    values.fields.work = '<b>test</b> & "quote"\r\n{{date}}'; values.fields.date = '';
    const html = renderCompanyTemplate(template,values).html;
    expect(html).toContain('&lt;b&gt;test&lt;/b&gt; &amp; &quot;quote&quot;<br>{{date}}');
    expect(html).not.toContain('具體要做什麼');
    expect(new DOMParser().parseFromString(html,'text/html').querySelectorAll('table table tr')[1].lastElementChild?.textContent).toBe('');
  });
  it('keeps subject values plain text and rejects multiline or oversized subjects before insertion',()=>{
    const template = companyTemplates[1], values = companyDefaults(template);
    values.fields.subject_date = '<A&B>';
    expect(renderCompanyTemplate(template,values).subject).toBe('申請<A&B>居家上班');
    values.fields.subject_date = '\n'; expect(()=>renderCompanyTemplate(template,values)).toThrow(/不可換行/);
    values.fields.subject_date = 'a'.repeat(256); expect(()=>renderCompanyTemplate(template,values)).toThrow(/255/);
  });
  it('renumbers rows and alternates the approved backgrounds after deleting a row; rejects zero rows',()=>{
    const template = companyTemplates[2], values = companyDefaults(template);
    values.rows[1].work = '刪除此列'; values.rows.splice(1,1);
    const html = renderCompanyTemplate(template,values).html;
    const rows = new DOMParser().parseFromString(html,'text/html').querySelectorAll('table table tr');
    expect(rows.length).toBe(4);
    expect(Array.from(rows).slice(1).map(row=>row.firstElementChild?.textContent)).toEqual(['1','2','3']);
    expect(rows[2].firstElementChild?.getAttribute('style')).toContain('background:#f8fafc');
    expect(html).not.toContain('刪除此列'); values.rows = [];
    expect(()=>renderCompanyTemplate(template,values)).toThrow(/至少/);
  });
});
