import { expect, test, type Page } from '@playwright/test';
import { installMockOffice, readDraft, type TestDraft } from './mock-office';
import type { Catalog, CatalogTemplate } from '../../src/catalog';

const template = (id = 'service-notice', name = '服務通知', category = '服務'): CatalogTemplate => ({
  id, name, category, tags: ['維護'], language: 'zh-TW', version: '1', updatedAt: '2026-11-16T00:00:00.000Z',
  subject: '{{customer}}服務通知', bodyHtml: '<p>{{customer}} 您好：</p><table><tbody><tr><th>日期</th><td>{{day}}</td></tr></tbody></table><p>{{details}}</p>',
  bodyText: '{{customer}} 您好：\n日期：{{day}}\n{{details}}', owner: 'IT', audience: [],
  fields: [
    {key: 'customer', label: '稱呼', type: 'text', required: true},
    {key: 'day', label: '服務日期', type: 'date', required: true},
    {key: 'details', label: '說明', type: 'text', required: false, defaultValue: '請確認服務時間。'},
  ],
});
interface ServiceState {catalog: Catalog; failCatalog: boolean; calls: {path: string; method: string; body: string | null; authorization: string | undefined}[]}
const region = (page: Page) => page.getByRole('region', {name: '公司範本', exact: true});

async function startCompany(page: Page): Promise<ServiceState> {
  const state: ServiceState = {catalog: {schemaVersion: 1, revision: 'r1', templates: [template(), template('it-notice', '內部公告', '內部')]}, failCatalog: false, calls: []};
  await installMockOffice(page);
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    state.calls.push({path, method: request.method(), body: request.postData(), authorization: request.headers().authorization});
    if (path === '/api/config') return route.fulfill({contentType: 'application/json', body: JSON.stringify({enabled: true, tenantId: '11111111-1111-4111-8111-111111111111', clientId: '22222222-2222-4222-8222-222222222222', scope: 'api://33333333-3333-4333-8333-333333333333/Templates.Read'})});
    if (!request.headers().authorization) return route.fulfill({status: 401, contentType: 'application/json', body: '{}'});
    if (path === '/api/catalog') return route.fulfill({status: state.failCatalog ? 503 : 200, contentType: 'application/json', headers: {'Cache-Control': 'no-store'}, body: JSON.stringify(state.failCatalog ? {} : state.catalog)});
    if (path.startsWith('/api/admin')) return route.fulfill({status: 403, contentType: 'application/json', body: '{}'});
    return route.fulfill({status: 404, contentType: 'application/json', body: '{}'});
  });
  await page.goto('/taskpane.html');
  await expect(region(page).getByRole('button', {name: '公司帳號登入'})).toBeVisible();
  await page.evaluate(() => {
    type DialogMessage = {message: string; origin: string};
    type DialogResult = {status: string; value: {close: () => void; addEventHandler: (type: string, callback: (event: DialogMessage) => void) => void}};
    const office = (window as unknown as {Office: {EventType: Record<string, string>; context: {ui?: unknown}}}).Office;
    office.EventType.DialogMessageReceived = 'dialogMessageReceived';
    office.EventType.DialogEventReceived = 'dialogEventReceived';
    office.context.ui = {displayDialogAsync: (url: string, _options: unknown, callback: (result: DialogResult) => void) => {
      const channel = new URLSearchParams(new URL(url).hash.slice(1)).get('channel');
      callback({status: 'succeeded', value: {close: () => {}, addEventHandler: (type, handler) => {
        if (type === 'dialogMessageReceived') queueMicrotask(() => handler({origin: location.origin, message: JSON.stringify({channel, accessToken: 'test-only-company-token', expiresAt: Date.now() + 3_600_000})}));
      }}});
    }};
    const draft = (window as unknown as {__testDraft: TestDraft}).__testDraft;
    draft.to = [{displayName: 'Existing To', emailAddress: 'existing-to@example.test'}];
    draft.cc = [{displayName: 'Existing CC', emailAddress: 'existing-cc@example.test'}];
    draft.subject = '原本主旨';
  });
  await region(page).getByRole('button', {name: '公司帳號登入'}).click();
  await expect(region(page).getByRole('button', {name: /服務通知/})).toBeVisible();
  return state;
}

async function fillTemplate(page: Page, name = '服務通知') {
  await region(page).getByRole('button', {name: new RegExp(name)}).click();
  await expect(region(page).getByRole('button', {name: '插入草稿'})).toBeDisabled();
  await region(page).getByLabel('稱呼', {exact: true}).fill('王先生');
  await region(page).getByLabel('服務日期', {exact: true}).fill('2026-11-20');
  await expect(region(page).getByRole('button', {name: '插入草稿'})).toBeEnabled();
}

test('company search, local fields and escaped preview preserve recipients and default subject', async ({page}) => {
  const service = await startCompany(page);
  await region(page).getByLabel('搜尋公司範本').fill('維護');
  await expect(region(page).locator('.company-choice')).toHaveCount(2);
  await region(page).getByLabel('篩選範本分類').selectOption('服務');
  await expect(region(page).locator('.company-choice')).toHaveCount(1);
  await fillTemplate(page);
  await region(page).getByLabel('說明', {exact: true}).fill('<img src=x onerror=alert(1)>\n{{customer}}');
  const preview = region(page).getByLabel('範本預覽');
  await expect(preview).toContainText('<img src=x onerror=alert(1)>');
  await expect(preview).toContainText('{{customer}}');
  await expect(preview.locator('img, script, iframe')).toHaveCount(0);
  await expect(region(page).getByRole('checkbox', {name: '套用主旨'})).not.toBeChecked();
  for (const width of [380, 320]) {
    await page.setViewportSize({width, height: 1000});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.screenshot({path: 'docs/evidence/company/company-catalog-mock.png', fullPage: true});
  const before = await readDraft(page);
  await region(page).getByRole('button', {name: '插入草稿'}).click();
  await expect(page.getByRole('status').filter({hasText: '已填入目前草稿'})).toBeVisible();
  const after = await readDraft(page);
  expect(after.to).toEqual(before.to); expect(after.cc).toEqual(before.cc); expect(after.subject).toBe('原本主旨');
  expect(after.writes).not.toContain('to'); expect(after.writes).not.toContain('cc'); expect(after.writes).not.toContain('subject');
  expect(after.bodyHtml).toContain('測試簽名'); expect(after.bodyHtml).toContain('測試回覆歷史'); expect(after.bodyHtml).toContain('王先生');
  expect(after.bodyHtml).toContain('&lt;img'); expect(after.sendCalls).toBe(0);
  expect(service.calls.filter(call => call.path === '/api/catalog').length).toBeGreaterThanOrEqual(2);
  expect(service.calls.every(call => call.method === 'GET' && call.body === null)).toBe(true);
  const storage = await page.evaluate(() => ({local: {...localStorage}, session: {...sessionStorage}}));
  expect(JSON.stringify(storage.local)).not.toContain('test-only-company-token');
  expect(JSON.stringify(storage.local)).not.toContain('王先生');
  expect(JSON.stringify(storage.session)).not.toContain('test-only-company-token');
});

test('subject is applied only after opt-in and confirmation', async ({page}) => {
  await startCompany(page); await fillTemplate(page);
  await region(page).getByRole('checkbox', {name: '套用主旨'}).check();
  await region(page).getByRole('button', {name: '插入草稿'}).click();
  await expect(page.getByRole('dialog')).toContainText('主旨');
  expect((await readDraft(page)).writes).toEqual([]);
  await page.getByRole('dialog').getByRole('button', {name: '確認替換', exact: true}).click();
  await expect(page.getByRole('status').filter({hasText: '已填入目前草稿'})).toBeVisible();
  const after = await readDraft(page);
  expect(after.subject).toBe('王先生服務通知'); expect(after.writes).toContain('subject');
  expect(after.writes).not.toContain('to'); expect(after.writes).not.toContain('cc'); expect(after.sendCalls).toBe(0);
});

test('a version change after preview rejects insertion before any draft writes', async ({page}) => {
  const service = await startCompany(page); await fillTemplate(page);
  service.catalog = {...service.catalog, revision: 'r2', templates: service.catalog.templates.map(item => item.id === 'service-notice' ? {...item, version: '2', bodyHtml: '<p>{{customer}} 新版本內容</p>'} : item)};
  await region(page).getByRole('button', {name: '插入草稿'}).click();
  await expect(region(page).getByRole('status')).toContainText('範本已更新');
  expect((await readDraft(page)).writes).toEqual([]);
  await region(page).getByRole('button', {name: /服務通知/}).click();
  await expect(region(page).getByLabel('稱呼', {exact: true})).toHaveValue('');
  await expect(region(page).getByRole('button', {name: '插入草稿'})).toBeDisabled();
});

test('refresh withdraws a selected template and failed refresh never reuses its cache', async ({page}) => {
  const service = await startCompany(page); await fillTemplate(page);
  service.catalog = {...service.catalog, revision: 'r2', templates: service.catalog.templates.filter(item => item.id !== 'service-notice')};
  await region(page).getByRole('button', {name: '重新整理', exact: true}).click();
  await expect(region(page).getByRole('status')).toContainText('下架');
  await expect(region(page).getByRole('button', {name: /服務通知/})).toHaveCount(0);
  await expect(region(page).getByRole('button', {name: /內部公告/})).toBeVisible();
  service.failCatalog = true;
  await region(page).getByRole('button', {name: '重新整理', exact: true}).click();
  await expect(region(page).getByRole('alert')).toContainText('無法使用');
  await expect(region(page).locator('.company-choice')).toHaveCount(0);
  await expect(region(page).getByRole('button', {name: '插入草稿'})).toHaveCount(0);
  expect((await readDraft(page)).writes).toEqual([]);
});

test('read-only user cannot load company administration through the API', async ({page}) => {
  const service = await startCompany(page);
  await page.getByRole('button', {name: '管理公司範本', exact: true}).click();
  const admin = page.getByRole('region', {name: '管理公司範本', exact: true});
  await expect(admin.getByRole('alert')).toContainText('沒有操作權限');
  await expect(admin.getByRole('button', {name: '新增範本'})).toHaveCount(0);
  await expect(admin.getByRole('button', {name: '發布已存草稿'})).toHaveCount(0);
  expect(service.calls.some(call => call.path === '/api/admin' && call.authorization === 'Bearer test-only-company-token')).toBe(true);
  expect((await readDraft(page)).writes).toEqual([]);
});
