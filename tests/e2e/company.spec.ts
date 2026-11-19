import { expect, test } from '@playwright/test';
import { installMockOffice, readDraft, type TestDraft } from './mock-office';
import { readFileSync } from 'node:fs';
const catalog=JSON.parse(readFileSync('outlook-templates/templates.json','utf8')) as {templates:{subject:string;to:{email:string}[];cc:{email:string}[]}[]};

const names=['加班','居家','居家申請（附當日工作清單）','內部 IT 需求／權限申請'];

test.beforeEach(async({page})=>{await installMockOffice(page);await page.goto('/taskpane.html');});

test('four shared cards finish recipient switches despite delayed Outlook HTML normalization',async({page},testInfo)=>{
  await page.evaluate(()=>{const draft=(window as unknown as {__testDraft:TestDraft}).__testDraft;draft.normalizeBodyAfterSave=true;draft.reassignSignatureCids=true;});
  await expect(page.getByRole('article')).toHaveCount(4);
  await expect(page.getByRole('heading',{name:'公司範本',exact:true})).toHaveCount(0);
  await page.screenshot({path:testInfo.outputPath('unified-cards-mock.png'),fullPage:true});
  for(const name of names) {
    await page.getByRole('button',{name:`編輯${name}`,exact:true}).click();
    await expect(page.getByRole('textbox',{name:'內文',exact:true}).locator('table')).toHaveCount(2);
    await expect(page.locator('iframe')).toHaveCount(0);
    await page.getByRole('button',{name:'Save',exact:true}).click();
    await page.getByRole('button',{name:`套用${name}`,exact:true}).click();
    if(name!==names[0]) {
      await expect(page.getByRole('dialog')).toContainText('既有模板區塊將被取代');
      await page.getByRole('button',{name:'確認替換',exact:true}).click();
    }
    await expect(page.getByRole('status')).toContainText('已填入目前草稿');
    const draft=await readDraft(page);
    const template=catalog.templates[names.indexOf(name)];
    expect(draft.to.map(person=>person.emailAddress)).toEqual(template.to.map(person=>person.email));
    expect(draft.cc.map(person=>person.emailAddress)).toEqual(template.cc.map(person=>person.email));
    expect(draft.subject).toBe(template.subject.replace(/\{\{\w+\}\}/g,'').trim());
    expect(draft.bodyHtml.match(/<table/g)).toHaveLength(2);
    expect(draft.bodyHtml).toContain('測試簽名');expect(draft.bodyHtml).toContain('測試回覆歷史');
    expect(draft.properties.sendModesTemplateV1).toBeTruthy();expect(draft.properties.sendModesCompanyV1).toBeUndefined();
    expect(draft.sendCalls).toBe(0);
    await page.evaluate(()=>{const draft=(window as unknown as {__testDraft:TestDraft}).__testDraft;draft.bodyHtml=draft.bodyHtml.replace('</div>','<p>在信裡補上內容</p></div>');});
    await page.getByRole('button',{name:`套用${name}`,exact:true}).click();
    await expect(page.getByRole('status')).toContainText('保留目前模板');
    expect((await readDraft(page)).bodyHtml).toContain('在信裡補上內容');
  }
  expect((await readDraft(page)).writes.filter(field=>field==='prepend')).toHaveLength(1);
});

test('preset editing survives reload, deletion is not re-created, and narrow/wide cards fit',async({page},testInfo)=>{
  for(const width of [320,960]) {
    await page.setViewportSize({width,height:900});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    await page.screenshot({path:testInfo.outputPath(`cards-${width}-mock.png`),fullPage:true});
  }
  await page.getByRole('button',{name:'編輯加班',exact:true}).click();
  await page.setViewportSize({width:320,height:900});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('preset-editor-320-mock.png'),fullPage:true});
  await page.getByLabel('主旨',{exact:true}).fill('我的加班主旨');
  await page.getByLabel('To Email',{exact:true}).fill('saved@example.test');
  await page.getByRole('button',{name:'Save',exact:true}).click();await page.reload();
  await page.getByRole('button',{name:'編輯加班',exact:true}).click();
  await expect(page.getByLabel('主旨',{exact:true})).toHaveValue('我的加班主旨');
  await expect(page.getByLabel('To Email',{exact:true})).toHaveValue('saved@example.test');
  await page.getByRole('button',{name:'更多操作',exact:true}).click();
  await page.getByRole('button',{name:'刪除「加班」模式',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'刪除模式',exact:true}).click();
  await page.getByRole('button',{name:'Save',exact:true}).click();await page.reload();
  await expect(page.getByRole('article')).toHaveCount(3);
});
