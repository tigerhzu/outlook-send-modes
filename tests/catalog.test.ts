import { describe, expect, it } from 'vitest';
import { fieldDefaults, parseCatalog, renderCatalogTemplate, type Catalog, type CatalogTemplate } from '../src/catalog';

const template = (): CatalogTemplate => ({
  id: 'service-notice', name: '服務通知', category: '服務', tags: ['通知'], language: 'zh-TW',
  version: '1', updatedAt: '2026-11-16T00:00:00.000Z', subject: '{{customer}}服務通知',
  bodyHtml: '<p>{{customer}} 您好：</p><p>{{details}}</p>', bodyText: '{{customer}} 您好：\n{{details}}',
  fields: [{key: 'customer', label: '客戶名稱', type: 'text', required: true}, {key: 'details', label: '內容', type: 'text', required: false, defaultValue: '服務說明'}],
  owner: 'IT', audience: [],
});
const catalog = (): Catalog => ({schemaVersion: 1, revision: 'revision-1', templates: [template()]});

describe('published company catalog validation', () => {
  it('returns validated data and keeps company ownership separate from recipient settings', () => {
    const result = parseCatalog(catalog());
    expect(result.templates[0].fields[0]).toEqual(template().fields[0]);
    expect(fieldDefaults(result.templates[0])).toEqual({customer: '', details: '服務說明'});
    for (const field of ['to', 'cc', 'bcc']) expect(() => parseCatalog({...catalog(), templates: [{...template(), [field]: []}]})).toThrow(/收件者/);
  });
  it('rejects unsupported versions, draft payloads, duplicate IDs and invalid metadata', () => {
    expect(() => parseCatalog({...catalog(), schemaVersion: 2})).toThrow(/版本/);
    expect(() => parseCatalog({...catalog(), templates: [template(), template()]})).toThrow(/ID 重複/);
    expect(() => parseCatalog({...catalog(), templates: [{...template(), status: 'draft'}]})).toThrow(/未發布/);
    expect(() => parseCatalog({...catalog(), revision: ''})).toThrow(/發布版本/);
    expect(() => parseCatalog({...catalog(), templates: [{...template(), updatedAt: 'yesterday'}]})).toThrow(/更新時間/);
    expect(() => parseCatalog({...catalog(), templates: [{...template(), updatedAt: '2026-02-30T00:00:00Z'}]})).toThrow(/更新時間/);
    expect(() => parseCatalog({...catalog(), templates: [{...template(), tags: ['a', 'a']}]})).toThrow(/重複/);
    expect(() => parseCatalog({...catalog(), templates: [{...template(), bodyHtml: 'a'.repeat(100_001)}]})).toThrow(/HTML/);
  });
  it('removes active content and unsafe CSS from HTML before any preview', () => {
    const input = catalog();
    input.templates[0].bodyHtml = '<p onclick="alert(1)" style="color:red;background-image:url(https://evil.invalid)">{{customer}}</p><script>alert(1)</script><iframe src="https://evil.invalid"></iframe><img src="https://evil.invalid/a.png"><a href="javascript:alert(1)">文字</a>';
    const html = parseCatalog(input).templates[0].bodyHtml;
    expect(html).toContain('color:red');
    expect(html).not.toMatch(/onclick|script|iframe|<img|javascript|url\(/i);
    expect(html).toContain('文字');
  });
  it('rejects variable markers in attributes including encoded markers, comments and CSS', () => {
    for (const html of ['<p title="{{customer}}">內容</p>', '<p title="&#123;&#123;customer&#125;&#125;">內容</p>', '<p style="color:{{customer}}">內容</p>', '<!--{{customer}}--><p>內容</p>']) {
      const input = catalog(); input.templates[0].bodyHtml = html;
      expect(() => parseCatalog(input)).toThrow(/變數/);
    }
  });
  it('rejects unknown or malformed markers and duplicate/reserved field keys', () => {
    for (const value of ['{{missing}}', '{{ customer }}', '{{customer}', '{{customer}}}}']) {
      const input = catalog(); input.templates[0].bodyHtml = `<p>${value}</p>`;
      expect(() => parseCatalog(input)).toThrow(/欄位/);
    }
    const input = catalog(); input.templates[0].fields.push({...input.templates[0].fields[0]});
    expect(() => parseCatalog(input)).toThrow(/重複/);
    input.templates[0].fields[2].key = 'constructor';
    expect(() => parseCatalog(input)).toThrow(/無效/);
  });
});

describe('local company field rendering', () => {
  it('escapes HTML exactly once, preserves literal tokens and never changes plain text into HTML', () => {
    const selected = parseCatalog(catalog()).templates[0];
    const rendered = renderCatalogTemplate(selected, {customer: '<A&B>', details: '<img src=x onerror=alert(1)>\n{{customer}}'});
    expect(rendered.html).toContain('&lt;A&amp;B&gt;');
    expect(rendered.html).toContain('&lt;img src=x onerror=alert(1)&gt;<br>{{customer}}');
    expect(new DOMParser().parseFromString(rendered.html, 'text/html').querySelector('img')).toBeNull();
    expect(rendered.text).toBe('<A&B> 您好：\n<img src=x onerror=alert(1)>\n{{customer}}');
    expect(rendered.subject).toBe('<A&B>服務通知');
  });
  it('blocks missing required values and unexpected values', () => {
    const selected = parseCatalog(catalog()).templates[0];
    expect(() => renderCatalogTemplate(selected, fieldDefaults(selected))).toThrow(/客戶名稱/);
    expect(() => renderCatalogTemplate(selected, {customer: ' ', details: ''})).toThrow(/客戶名稱/);
    expect(() => renderCatalogTemplate(selected, {customer: 'A', unexpected: 'B'})).toThrow(/未知欄位/);
    expect(() => renderCatalogTemplate(selected, {customer: 12} as unknown as Record<string, string>)).toThrow(/格式/);
    expect(renderCatalogTemplate(selected, {customer: 'A', details: ''}).text).toBe('A 您好：\n');
  });
  it('validates dates, numbers, enum selections and defaults before insertion', () => {
    const input = catalog();
    input.templates[0].fields.push({key: 'day', label: '日期', type: 'date', required: true}, {key: 'amount', label: '金額', type: 'number', required: true}, {key: 'service', label: '服務', type: 'select', required: true, options: ['A', 'B']});
    const selected = parseCatalog(input).templates[0];
    const values = {customer: '測試', details: '', day: '2024-02-29', amount: '-12.50', service: 'A'};
    expect(() => renderCatalogTemplate(selected, values)).not.toThrow();
    for (const day of ['2026-02-29', '2026-13-01', '2026-2-1']) expect(() => renderCatalogTemplate(selected, {...values, day})).toThrow(/日期/);
    for (const amount of ['NaN', 'Infinity', '0x10', '1e999']) expect(() => renderCatalogTemplate(selected, {...values, amount})).toThrow(/金額/);
    expect(() => renderCatalogTemplate(selected, {...values, service: 'C'})).toThrow(/服務/);
    input.templates[0].fields[2].defaultValue = 'tomorrow';
    expect(() => parseCatalog(input)).toThrow(/日期/);
  });
  it('rejects multiline/oversized rendered subject before draft work', () => {
    const selected = parseCatalog(catalog()).templates[0];
    expect(() => renderCatalogTemplate(selected, {customer: 'A\nB'})).toThrow(/不可換行/);
    expect(() => renderCatalogTemplate(selected, {customer: 'A'.repeat(256)})).toThrow(/255/);
  });
});
