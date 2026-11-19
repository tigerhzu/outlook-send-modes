import { sampleSettings } from '../sample-settings';
import { expect,test } from '@playwright/test';
import { installMockOffice,readDraft,type TestDraft } from './mock-office';

test.beforeEach(async({page})=>{
  await installMockOffice(page);
  await page.addInitScript(settings=>{if(!localStorage.getItem('send-modes.v1.test-user%40example.test'))localStorage.setItem('send-modes.v1.test-user%40example.test',JSON.stringify(settings));},sampleSettings());
  await page.goto('/taskpane.html');
  await expect(page.getByRole('button',{name:'設定',exact:true})).toBeVisible();
});

async function setupModes(page:Parameters<typeof installMockOffice>[0]) {
  for(const [name,to,cc] of [['加班','johnny@example.test','purple@example.test'],['居家','hank@example.test','johnny@example.test; purple@example.test']]) {
    await page.getByRole('button',{name:`編輯${name}`,exact:true}).click();
    await page.getByLabel('To Email',{exact:true}).fill(to);
    await page.getByLabel('CC Email',{exact:true}).fill(cc);
    await page.getByRole('button',{name:'Save',exact:true}).click();
    await expect(page.getByRole('status')).toContainText('已儲存');
  }
  await expect(page.getByRole('button',{name:'設定',exact:true})).toBeVisible();
}

test('fake Office acceptance: setup, persisted defaults, both modes, edited cells, confirmation and no send',async({page},testInfo)=>{
  await expect(page.getByRole('button',{name:'套用加班',exact:true})).toBeDisabled();
  await expect(page.getByRole('article').filter({has:page.getByRole('heading',{name:'加班',exact:true})})).toContainText('填寫 To Email');
  await setupModes(page);
  await page.reload();
  await expect(page.getByRole('button',{name:'套用加班',exact:true})).toBeEnabled();
  await page.screenshot({path:testInfo.outputPath('mode-picker-mock-host.png'),fullPage:true});
  await page.getByRole('button',{name:'套用加班',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('已填入目前草稿');
  let draft=await readDraft(page);
  expect(draft.to.map(x=>x.emailAddress)).toEqual(['johnny@example.test']);
  expect(draft.cc.map(x=>x.emailAddress)).toEqual(['purple@example.test']);
  expect(draft.subject).toBe('加班申請');
  expect(draft.bodyHtml).toContain('<table');expect(draft.bodyHtml).toContain('測試簽名');expect(draft.bodyHtml).toContain('測試回覆歷史');
  await page.evaluate(()=>{
    const draft=(window as unknown as {__testDraft:TestDraft}).__testDraft;
    draft.bodyHtml=draft.bodyHtml.replace('&nbsp;','2026-11-13');
  });
  await page.getByRole('button',{name:'套用加班',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('保留目前模板');
  draft=await readDraft(page);expect(draft.bodyHtml).toContain('2026-11-13');expect(draft.bodyHtml.match(/<table/g)).toHaveLength(1);
  await page.getByRole('button',{name:'套用居家',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('既有模板區塊將被取代');
  await page.getByText('查看目前模板內容',{exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('2026-11-13');
  await page.getByRole('button',{name:'取消',exact:true}).click();
  expect((await readDraft(page)).subject).toBe('加班申請');
  await page.getByRole('button',{name:'套用居家',exact:true}).click();
  await page.getByRole('button',{name:'確認替換',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('已填入目前草稿');
  draft=await readDraft(page);expect(draft.to.map(x=>x.emailAddress)).toEqual(['hank@example.test']);
  expect(draft.cc.map(x=>x.emailAddress)).toEqual(['johnny@example.test','purple@example.test']);
  expect(draft.bodyHtml).toContain('聯絡方式');expect(draft.bodyHtml.match(/<table/g)).toHaveLength(1);
  expect(draft.bodyHtml).toContain('測試簽名');expect(draft.bodyHtml).toContain('測試回覆歷史');expect(draft.sendCalls).toBe(0);
  await page.getByRole('button',{name:'編輯加班',exact:true}).click();
  await expect(page.getByLabel('主旨',{exact:true})).toHaveValue('加班申請');
  await expect(page.getByRole('textbox',{name:'內文',exact:true})).not.toContainText('2026-11-13');
});

test('mode editor creates, replaces recipients, formats tables, saves after reopen and deletes modes',async({page},testInfo)=>{
  await setupModes(page);
  await page.getByRole('button',{name:'設定',exact:true}).click();
  await page.getByRole('button',{name:'更多操作',exact:true}).click();
  await page.getByRole('button',{name:'新增模式',exact:true}).click();
  await page.getByLabel('模式名稱',{exact:true}).fill('週報');
  await page.getByLabel('主旨',{exact:true}).fill('本週工作報告');
  await page.getByLabel('To Email',{exact:true}).fill('hank@example.test; johnny@example.test');
  await page.getByLabel('CC Email',{exact:true}).fill('purple@example.test');
  await page.getByRole('button',{name:'更多格式',exact:true}).click();
  await page.getByRole('button',{name:'HTML',exact:true}).click();
  await page.getByLabel('內文 HTML 原始碼',{exact:true}).fill('<p><strong>本週成果</strong></p><table><tr><td>項目</td><td>內容</td></tr></table>');
  await page.getByRole('button',{name:'編輯',exact:true}).click();
  const editor=page.getByRole('textbox',{name:'內文',exact:true});
  await expect(editor.locator('strong')).toHaveText('本週成果');
  await editor.locator('td').first().click();
  await page.getByRole('button',{name:'更多格式',exact:true}).click();
  await page.getByRole('button',{name:'加列',exact:true}).click();
  await expect(editor.locator('tr')).toHaveCount(2);
  await page.screenshot({path:testInfo.outputPath('mode-editor-mock-host.png'),fullPage:true});
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('已儲存');
  await page.reload();
  await page.getByRole('button',{name:'編輯週報',exact:true}).click();
  await expect(page.getByLabel('主旨',{exact:true})).toHaveValue('本週工作報告');
  await expect(page.getByLabel('To Email',{exact:true})).toHaveValue('hank@example.test');
  await expect(page.getByRole('textbox',{name:'內文',exact:true}).locator('tr')).toHaveCount(2);
  await page.getByLabel('To Email',{exact:true}).fill('hank@example.test');
  await page.getByRole('button',{name:'更多操作',exact:true}).click();
  await page.getByRole('button',{name:'刪除「週報」模式',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'刪除模式',exact:true}).click();
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('已儲存');
  await page.reload();
  await expect(page.getByRole('button',{name:'套用週報',exact:true})).toHaveCount(0);
  expect((await readDraft(page)).writes).toHaveLength(0);
});

test('partial host failure stays visible and retry does not insert another table',async({page})=>{
  await setupModes(page);
  await page.evaluate(()=>{(window as unknown as {__testDraft:TestDraft}).__testDraft.failNext='cc';});
  await page.getByRole('button',{name:'套用加班',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('套用未完整完成');
  await expect(page.getByRole('alert')).toContainText('CC 副本');
  expect((await readDraft(page)).subject).toBe('');
  await page.getByRole('button',{name:'套用加班',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('已填入目前草稿');
  const draft=await readDraft(page);expect(draft.bodyHtml.match(/<table/g)).toHaveLength(1);expect(draft.sendCalls).toBe(0);
});

test('missing marker is blocked without silently adding another table',async({page})=>{
  await setupModes(page);
  await page.getByRole('button',{name:'套用加班',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('已填入目前草稿');
  await page.evaluate(()=>{const d=(window as unknown as {__testDraft:TestDraft}).__testDraft;d.bodyHtml=d.bodyHtml.replace(/ (?:id|class)="send-mode-[^"]+"/g,'');});
  const previous=(await readDraft(page)).bodyHtml;
  await page.getByRole('button',{name:'套用居家',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('找不到先前模板');
  expect((await readDraft(page)).bodyHtml).toBe(previous);
});

test('compact editor fits 320px and 960px without horizontal page overflow',async({page},testInfo)=>{
  await setupModes(page);
  await page.setViewportSize({width:320,height:700});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.getByRole('button',{name:'設定',exact:true}).click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('compact-editor-320-mock.png'),fullPage:true});
  await page.setViewportSize({width:960,height:900});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('compact-editor-960-mock.png'),fullPage:true});
});

test('direct name and Email editing needs no contact or rename menu; Escape closes more',async({page})=>{
  await setupModes(page);
  await page.getByRole('button',{name:'設定',exact:true}).click();
  await expect(page.getByLabel('模式名稱',{exact:true})).toHaveValue('加班');
  await expect(page.getByRole('button',{name:'HTML',exact:true})).toHaveCount(0);
  await page.getByLabel('主旨',{exact:true}).fill('Keep this edit');
  const more=page.getByRole('button',{name:'更多操作',exact:true});
  await more.click();
  await expect(page.getByRole('button',{name:'聯絡人',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'重新命名',exact:true})).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(more).toBeFocused(); await expect(more).toHaveAttribute('aria-expanded','false');
  await page.getByLabel('To Email',{exact:true}).fill('new@example.test');
  await page.getByLabel('模式名稱',{exact:true}).fill('Overtime');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await page.getByRole('button',{name:'編輯Overtime',exact:true}).click();
  await expect(page.getByLabel('主旨',{exact:true})).toHaveValue('Keep this edit');
  await expect(page.getByLabel('To Email',{exact:true})).toHaveValue('new@example.test');
});

test('invalid addresses keep edits; pasted lists persist, apply, deduplicate and allow clearing CC',async({page})=>{
  await page.getByRole('button',{name:'編輯加班',exact:true}).click();
  await page.getByLabel('To Email',{exact:true}).fill('not-an-email');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('To Email 格式不正確');
  await expect(page.getByLabel('To Email',{exact:true})).toHaveValue('not-an-email');
  expect((await readDraft(page)).writes).toHaveLength(0);
  await page.getByLabel('To Email',{exact:true}).fill('one@example.test; TWO@example.test; one@example.test');
  await page.getByLabel('CC Email',{exact:true}).fill('two@example.test，three@example.test');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await page.reload();
  await page.getByRole('button',{name:'套用加班',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('已填入目前草稿');
  expect((await readDraft(page)).to.map(r=>r.emailAddress)).toEqual(['one@example.test','TWO@example.test']);
  expect((await readDraft(page)).cc.map(r=>r.emailAddress)).toEqual(['three@example.test']);
  await page.getByRole('button',{name:'編輯加班',exact:true}).click();
  await page.getByRole('button',{name:'移除 CC 第 2 位',exact:true}).click();
  await page.getByRole('button',{name:'移除 CC 第 1 位',exact:true}).click();
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await page.getByRole('button',{name:'套用加班',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'確認替換',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('已填入目前草稿');
  expect((await readDraft(page)).cc).toEqual([]);
  expect((await readDraft(page)).bodyHtml.match(/<table/g)).toHaveLength(1);
});

test('Save persists and exits; storage failure leaves the editor and entered values intact',async({page})=>{
  await page.getByRole('button',{name:'設定',exact:true}).click();
  await page.getByLabel('主旨',{exact:true}).fill('Changed subject');
  await page.evaluate(()=>{Storage.prototype.setItem=function(){throw new DOMException('Storage full','QuotaExceededError');};});
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Storage full');
  await expect(page.getByLabel('主旨',{exact:true})).toHaveValue('Changed subject');
  await expect(page.getByRole('heading',{name:'編輯模式',exact:true})).toBeVisible();
});

test('signature rich paste, Save exits, reload, append at bottom and repeat keeps one signature',async({page},testInfo)=>{
  await page.getByRole('button',{name:'簽章',exact:true}).click();
  const editor=page.getByRole('textbox',{name:'簽章內容',exact:true});
  await editor.click();
  await editor.evaluate(el=>{
    const clipboard=new DataTransfer();
    clipboard.setData('text/html','<p><b>Best regards,</b><br>Example Person at Example Company</p><a href="https://example.test/">Website</a><br><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=" alt="Test logo">');
    el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:clipboard,bubbles:true,cancelable:true}));
  });
  await expect(editor.getByRole('link',{name:'Website'})).toHaveAttribute('href','https://example.test/');
  await expect(editor.getByRole('img',{name:'Test logo'})).toHaveCount(1);
  await page.screenshot({path:testInfo.outputPath('signature-editor-mock-host.png'),fullPage:true});
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await expect(page.getByRole('button',{name:'設定',exact:true})).toBeVisible();
  expect((await readDraft(page)).writes).toHaveLength(0);
  await page.reload();
  await page.getByRole('button',{name:'簽章',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('已加入簽章');
  const draft=await readDraft(page);
  expect(draft.bodyHtml.indexOf('Best regards')).toBeGreaterThan(draft.bodyHtml.indexOf('測試回覆歷史'));
  expect(draft.bodyHtml).toContain('cid:company-logo');
  expect(draft.bodyHtml).toContain('href="https://example.test/"');
  expect(draft.images).toHaveLength(1); expect(draft.images[0].isInline).toBe(true);
  expect(draft.bodyHtml).toContain(`cid:${draft.images[0].name}`);
  await page.getByRole('button',{name:'簽章',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('保留目前內容');
  expect((await readDraft(page)).writes).toEqual(draft.writes);
  expect((await readDraft(page)).sendCalls).toBe(0);
  await page.getByRole('button',{name:'編輯簽章',exact:true}).click();
  await expect(editor.getByRole('img',{name:'Test logo'})).toHaveCount(1);
  await page.setViewportSize({width:320,height:700});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});

test('signature image upload and unsaved exit keep the saved signature unchanged',async({page})=>{
  await page.getByRole('button',{name:'編輯簽章',exact:true}).click();
  const editor=page.getByRole('textbox',{name:'簽章內容',exact:true});
  await editor.fill('Saved signature');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await page.getByRole('button',{name:'編輯簽章',exact:true}).click();
  await editor.fill('Unsaved signature');
  await page.getByLabel('簽章圖片',{exact:true}).setInputFiles({name:'logo.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')});
  await expect(editor.getByRole('img',{name:'logo.png'})).toHaveCount(1);
  await page.getByRole('button',{name:'返回',exact:true}).click();
  await page.getByRole('button',{name:'取消',exact:true}).click();
  await expect(editor).toContainText('Unsaved signature');
  await page.getByRole('button',{name:'返回',exact:true}).click();
  await page.getByRole('button',{name:'捨棄變更',exact:true}).click();
  await page.getByRole('button',{name:'編輯簽章',exact:true}).click();
  await expect(editor).toContainText('Saved signature');
  await expect(editor.locator('img')).toHaveCount(0);
  expect((await readDraft(page)).writes).toHaveLength(0);
});

test('old backup upgrades overlapping presets, preserves custom addresses and signature, then persists once',async({page})=>{
  await setupModes(page);
  await page.getByRole('button',{name:'編輯加班',exact:true}).click();
  const old={version:1,contacts:[{id:'a',name:'Old name',email:'legacy@example.test'},{id:'b',name:'Old CC',email:'copy@example.test'}],modes:[{id:'overtime',name:'加班',to:['a'],cc:['b'],subject:'Old subject',bodyHtml:'<p>Old body</p>'},{id:'custom',name:'保留模式',to:['a'],cc:['b'],subject:'Custom subject',bodyHtml:'<p>Custom body</p>'}],signatureHtml:'<p>Old signature</p>'};
  await page.getByLabel('匯入設定檔案',{exact:true}).setInputFiles({name:'old.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(old))});
  await page.getByRole('dialog').getByRole('button',{name:'匯入',exact:true}).click();
  await expect(page.getByLabel('To Email',{exact:true})).toHaveValue('purpleliu@freedom.net.tw');
  await expect(page.getByLabel('主旨',{exact:true})).toHaveValue('加班申請');
  await page.getByRole('button',{name:'Save',exact:true}).click();await page.reload();
  await expect(page.getByRole('article')).toHaveCount(5);
  const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(key=>key.startsWith('send-modes.v1.'))!)!));
  expect(stored.version).toBe(2);expect(stored.presetRevision).toBe(1);expect(stored).not.toHaveProperty('contacts');
  expect(stored.signatureHtml).toBe('<p>Old signature</p>');
  expect(stored.modes.find((mode:{id:string})=>mode.id==='custom').to).toEqual(['legacy@example.test']);
  await page.getByRole('button',{name:'套用保留模式',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('已填入目前草稿');
  expect((await readDraft(page)).to[0].emailAddress).toBe('legacy@example.test');
});

test('plus adds editable people or favorites; saved modes keep copies when favorites change',async({page},testInfo)=>{
  await page.getByRole('button',{name:'常用聯絡人',exact:true}).click();
  await page.getByRole('button',{name:'＋新增常用',exact:true}).click();
  await page.getByLabel('常用姓名 1',{exact:true}).fill('Alex');
  await page.getByLabel('常用 Email 1',{exact:true}).fill('invalid');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('有效的常用 Email');
  await page.getByLabel('常用 Email 1',{exact:true}).fill('alex@example.test');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await page.reload();
  await page.getByRole('button',{name:'編輯加班',exact:true}).click();
  await page.getByLabel('To Email',{exact:true}).fill('first@example.test');
  await page.getByRole('button',{name:'新增 To',exact:true}).click();
  await page.getByRole('button',{name:'新增一人',exact:true}).click();
  await expect(page.getByLabel('To Email 2',{exact:true})).toBeFocused();
  await page.getByLabel('To Email 2',{exact:true}).fill('second@example.test');
  await page.getByRole('button',{name:'新增 CC',exact:true}).click();
  await page.screenshot({path:testInfo.outputPath('add-recipient-mock.png'),fullPage:true});
  await page.getByRole('button',{name:'Alex alex@example.test',exact:true}).click();
  await expect(page.getByLabel('CC Email',{exact:true})).toHaveValue('alex@example.test');
  await page.getByRole('button',{name:'新增 CC',exact:true}).click();
  await expect(page.getByRole('button',{name:'Alex alex@example.test',exact:true})).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button',{name:'新增 CC',exact:true})).toBeFocused();
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await page.getByRole('button',{name:'常用聯絡人',exact:true}).click();
  await page.getByLabel('常用 Email 1',{exact:true}).fill('changed@example.test');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await page.getByRole('button',{name:'常用聯絡人',exact:true}).click();
  await page.getByRole('button',{name:'刪除常用 1',exact:true}).click();
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await page.reload();
  await page.getByRole('button',{name:'套用加班',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('已填入目前草稿');
  expect((await readDraft(page)).to.map(r=>r.emailAddress)).toEqual(['first@example.test','second@example.test']);
  expect((await readDraft(page)).cc.map(r=>r.emailAddress)).toEqual(['alex@example.test']);
});

test('manage favorites from plus preserves unsaved mode edits; multiline paste becomes separate people',async({page})=>{
  await page.getByRole('button',{name:'編輯加班',exact:true}).click();
  await page.getByLabel('主旨',{exact:true}).fill('Pending subject');
  await page.getByLabel('To Email',{exact:true}).evaluate(el=>{
    const clipboardData=new DataTransfer();clipboardData.setData('text/plain','a@example.test\nb@example.test;c@example.test');
    el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData}));
  });
  await expect(page.getByLabel('To Email 3',{exact:true})).toHaveValue('c@example.test');
  await page.getByRole('button',{name:'移除 To 第 2 位',exact:true}).click();
  await expect(page.getByLabel('To Email 2',{exact:true})).toHaveValue('c@example.test');
  await page.getByRole('button',{name:'新增 CC',exact:true}).click();
  await page.getByRole('button',{name:'管理常用',exact:true}).click();
  await page.getByRole('button',{name:'＋新增常用',exact:true}).click();
  await page.getByLabel('常用 Email 1',{exact:true}).fill('saved@example.test');
  await page.getByRole('button',{name:'返回',exact:true}).click();
  await expect(page.getByLabel('主旨',{exact:true})).toHaveValue('Pending subject');
  await expect(page.getByLabel('To Email 2',{exact:true})).toHaveValue('c@example.test');
  await page.getByRole('button',{name:'新增 CC',exact:true}).click();
  await page.getByRole('button',{name:'saved@example.test',exact:true}).click();
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await page.reload();
  await page.getByRole('button',{name:'編輯加班',exact:true}).click();
  await expect(page.getByLabel('CC Email',{exact:true})).toHaveValue('saved@example.test');
});

test('Outlook pasted image uses original CID bytes, survives Save/reload and attaches without remote URLs',async({page})=>{
  await page.getByRole('button',{name:'編輯簽章',exact:true}).click();
  const editor=page.getByRole('textbox',{name:'簽章內容',exact:true});
  await editor.click();
  await editor.evaluate(el=>{
    const clipboardData=new DataTransfer();
    clipboardData.setData('text/html','<p>Example signature</p><img src="https://outlook.office.com/protected-image" originalsrc="cid:mock-logo-cid" alt="Pasted logo"><p>After image</p>');
    el.dispatchEvent(new ClipboardEvent('paste',{clipboardData,bubbles:true,cancelable:true}));
  });
  const img=editor.locator('img');
  await expect(img).toHaveAttribute('src',/^data:image\/png;base64,/);
  await expect.poll(()=>img.evaluate((el:HTMLImageElement)=>el.complete && el.naturalWidth>0)).toBe(true);
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await page.reload();
  await page.getByRole('button',{name:'編輯簽章',exact:true}).click();
  await expect(img).toHaveAttribute('src',/^data:image\/png;base64,/);
  await expect.poll(()=>img.evaluate((el:HTMLImageElement)=>el.complete && el.naturalWidth>0)).toBe(true);
  await page.getByRole('button',{name:'返回',exact:true}).click();
  await page.getByRole('button',{name:'簽章',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('已加入簽章');
  expect((await readDraft(page)).images[0].source).not.toMatch(/^https:/);
  expect((await readDraft(page)).bodyHtml).toContain('After image');
});

test('unresolvable Outlook images fail visibly and keep the previous signature intact',async({page})=>{
  await page.getByRole('button',{name:'編輯簽章',exact:true}).click();
  const editor=page.getByRole('textbox',{name:'簽章內容',exact:true});
  await editor.fill('Previous signature');
  await editor.evaluate(el=>{
    const clipboardData=new DataTransfer();clipboardData.setData('text/html','<p>Incomplete new signature</p><img src="cid:unknown-image">');
    el.dispatchEvent(new ClipboardEvent('paste',{clipboardData,bubbles:true,cancelable:true}));
  });
  await expect(page.getByRole('alert')).toContainText('無法取得簽章圖片');
  await expect(editor).toHaveText('Previous signature');
  await expect(editor.locator('img')).toHaveCount(0);
  expect((await readDraft(page)).writes).toHaveLength(0);
});
