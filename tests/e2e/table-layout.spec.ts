import { expect, test } from '@playwright/test';
import { installMockOffice, readDraft } from './mock-office';

test('applied tables retain columns during long text editing and stylesheet loss (mock)',async({page})=>{
  await installMockOffice(page);await page.goto('/taskpane.html');
  await page.getByRole('button',{name:'套用加班',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('已填入目前草稿');
  const draft=await readDraft(page);
  // Separate document models a compose editor, not the Outlook rendering engine.
  await page.setContent(`<div contenteditable="true" id="compose">${draft.bodyHtml}</div>`);
  const measurements=await page.evaluate(()=>{
    document.querySelectorAll('style').forEach(style=>style.remove());
    const table=document.querySelector<HTMLTableElement>('#compose table table')!;
    const label=table.rows[1].cells[0];
    const value=table.rows[1].cells[1];
    const before=[table.getBoundingClientRect().width,label.getBoundingClientRect().width];
    value.textContent='CASE1234567890'.repeat(60);
    const after=[table.getBoundingClientRect().width,label.getBoundingClientRect().width];
    return {before,after,overflow:value.scrollWidth-value.clientWidth};
  });
  expect(measurements.after).toEqual(measurements.before);
  expect(measurements.overflow).toBeLessThanOrEqual(1);
  const cell=page.locator('#compose table table tr').nth(2).locator('td').nth(1);
  await cell.click();await page.keyboard.type('09:00');await page.keyboard.press('Enter');await page.keyboard.type('10:00');
  await expect(cell).toContainText('09:00');await expect(cell).toContainText('10:00');
  await expect(page.locator('#compose table')).toHaveCount(2);
});

test('HTML shell provides recovery when the application bundle fails',async({page})=>{
  await page.route('**/src/main.tsx*',route=>route.abort());
  await page.goto('/taskpane.html');
  await expect(page.getByRole('status')).toContainText('聯絡管理者');
  await expect(page.getByRole('button',{name:'重新載入'})).toBeVisible();
});
