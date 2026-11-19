import { expect, test, type Page } from '@playwright/test';
import { installMockOffice, readDraft } from './mock-office';
import type { CatalogTemplate } from '../../src/catalog';

const initialTemplate = (id:string,name:string):CatalogTemplate => ({id,name,category:'公司',tags:['通知'],language:'zh-TW',version:'v1',updatedAt:'2026-11-16T00:00:00.000Z',subject:'服務通知',bodyHtml:'<p>{{customer}} 您好</p>',bodyText:'{{customer}} 您好',fields:[{key:'customer',label:'稱呼',type:'text',required:true,defaultValue:'同仁'}],owner:'IT',audience:[]});
interface History {revision:string;at:string;action:string;templateId:string;actor:string;version?:string}
interface MockAdmin {revision:string;roles:string[];drafts:CatalogTemplate[];published:CatalogTemplate[];history:History[]}
interface AdminService {state:MockAdmin;conflict:boolean;requests:{path:string;method:string;body:unknown;ifMatch:string|undefined}[]}
const admin = (page:Page) => page.getByRole('region',{name:'管理公司範本',exact:true});

async function openAdmin(page:Page,roles=['Template.Publisher']):Promise<AdminService> {
  const alpha=initialTemplate('notice-alpha','公司公告'), beta=initialTemplate('notice-beta','維護通知');
  const service:AdminService={state:{revision:'r1',roles,drafts:[],published:[alpha,beta],history:[{revision:'published-alpha',at:alpha.updatedAt,action:'publish',templateId:alpha.id,actor:'user-id',version:alpha.version}]},conflict:false,requests:[]};
  await installMockOffice(page);
  await page.route('**/api/**',async route=>{
    const request=route.request(),path=new URL(request.url()).pathname;
    const raw=request.postData(),body=raw?JSON.parse(raw):null;
    service.requests.push({path,method:request.method(),body,ifMatch:request.headers()['if-match']});
    const reply=(value:unknown,status=200)=>route.fulfill({status,contentType:'application/json',headers:{ETag:`"${service.state.revision}"`},body:JSON.stringify(value)});
    if(path==='/api/config')return reply({enabled:true,tenantId:'11111111-1111-4111-8111-111111111111',clientId:'22222222-2222-4222-8222-222222222222',scope:'api://33333333-3333-4333-8333-333333333333/Templates.Read'});
    if(!request.headers().authorization)return reply({},401);
    if(path==='/api/catalog')return reply({schemaVersion:1,revision:service.state.revision,templates:service.state.published});
    if(path==='/api/admin' && request.method()==='GET')return reply(service.state);
    const match=path.match(/^\/api\/admin\/(drafts|publish|withdraw|rollback)\/(.+)$/);
    if(!match)return reply({},404);
    const [,action,id]=match;
    if(action!=='drafts' && !service.state.roles.includes('Template.Publisher'))return reply({},403);
    if(service.conflict || request.headers()['if-match']!==`"${service.state.revision}"`)return reply({},412);
    service.state.revision=`r${Number(service.state.revision.slice(1))+1}`;
    if(action==='drafts')service.state.drafts=[...service.state.drafts.filter(item=>item.id!==id),body as CatalogTemplate];
    if(action==='publish'){
      const draft=service.state.drafts.find(item=>item.id===id)!;
      service.state.published=[...service.state.published.filter(item=>item.id!==id),{...draft,version:service.state.revision}];
      service.state.drafts=service.state.drafts.filter(item=>item.id!==id);
    }
    if(action==='withdraw')service.state.published=service.state.published.filter(item=>item.id!==id);
    if(action==='rollback')service.state.published=[...service.state.published.filter(item=>item.id!==id),{...alpha,version:service.state.revision}];
    service.state.history.push({revision:service.state.revision,at:new Date().toISOString(),action:action==='drafts'?'save':action,templateId:id,actor:'user-id',...(action==='publish' || action==='rollback'?{version:service.state.revision}:{})});
    return reply(service.state);
  });
  await page.goto('/taskpane.html');
  await expect(page.getByRole('button',{name:'公司帳號登入'})).toBeVisible();
  await page.evaluate(()=>{
    type Message={message:string;origin:string};
    type Dialog={close:()=>void;addEventHandler:(type:string,callback:(message:Message)=>void)=>void};
    const office=(window as unknown as {Office:{EventType:Record<string,string>;context:{ui?:unknown}}}).Office;
    office.EventType.DialogMessageReceived='dialogMessageReceived';office.EventType.DialogEventReceived='dialogEventReceived';
    office.context.ui={displayDialogAsync:(url:string,_options:unknown,callback:(result:{status:string;value:Dialog})=>void)=>{
      const channel=new URLSearchParams(new URL(url).hash.slice(1)).get('channel');
      callback({status:'succeeded',value:{close:()=>{},addEventHandler:(type,handler)=>{if(type==='dialogMessageReceived')queueMicrotask(()=>handler({origin:location.origin,message:JSON.stringify({channel,accessToken:'admin-test-token',expiresAt:Date.now()+3_600_000})}));}}});
    }};
  });
  await page.getByRole('button',{name:'公司帳號登入'}).click();
  await page.getByRole('button',{name:'管理公司範本',exact:true}).click();
  await expect(admin(page).getByRole('button',{name:'新增範本'})).toBeVisible();
  return service;
}

test('admin edits a form and confirms before discarding on select, back, new and refresh',async({page})=>{
  const service=await openAdmin(page);
  await admin(page).getByRole('button',{name:/公司公告/}).click();
  await admin(page).getByLabel('範本名稱',{exact:true}).fill('未存公告');
  const before=service.requests.length;
  for(const label of ['維護通知','返回','新增範本','重新整理']){
    await admin(page).getByRole('button',{name:label==='維護通知'?/維護通知/:label,exact:label!=='維護通知'}).click();
    await expect(page.getByRole('dialog')).toContainText('尚未儲存');
    await page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();
    await expect(admin(page).getByLabel('範本名稱',{exact:true})).toHaveValue('未存公告');
  }
  expect(service.requests.length).toBe(before);
  await admin(page).getByRole('button',{name:/維護通知/}).click();
  await page.getByRole('dialog').getByRole('button',{name:'確認替換',exact:true}).click();
  await expect(admin(page).getByLabel('範本名稱',{exact:true})).toHaveValue('維護通知');
  await admin(page).getByText('分類與權限',{exact:true}).click();
  await expect(admin(page).getByLabel('範本 ID')).toHaveAttribute('readonly','');
  await page.setViewportSize({width:320,height:1000});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await admin(page).screenshot({path:'docs/evidence/company/company-admin-mock.png'});
});

test('publisher saves the form then confirms publishing only the saved draft',async({page})=>{
  const service=await openAdmin(page);
  await admin(page).getByRole('button',{name:/公司公告/}).click();
  await expect(admin(page).getByRole('button',{name:'發布已存草稿'})).toBeDisabled();
  await admin(page).getByLabel('範本名稱',{exact:true}).fill('更新公告');
  await admin(page).getByLabel('欄位 1 顯示名稱').fill('收件者稱呼');
  await admin(page).getByRole('button',{name:'儲存草稿',exact:true}).click();
  await expect(admin(page).getByRole('status')).toContainText('已儲存草稿');
  const save=service.requests.find(item=>item.method==='PUT')!;
  expect(save.ifMatch).toBe('"r1"');
  expect((save.body as CatalogTemplate).name).toBe('更新公告');
  expect((save.body as CatalogTemplate).fields[0].label).toBe('收件者稱呼');
  expect(save.body).not.toHaveProperty('to');expect(save.body).not.toHaveProperty('cc');expect(save.body).not.toHaveProperty('bcc');
  await admin(page).getByRole('button',{name:'發布已存草稿'}).click();
  await expect(page.getByRole('dialog')).toContainText('發布已儲存草稿');
  expect(service.requests.filter(item=>item.path.includes('/publish/'))).toHaveLength(0);
  await page.getByRole('dialog').getByRole('button',{name:'確認替換',exact:true}).click();
  await expect(admin(page).getByRole('status')).toContainText('已發布');
  const publish=service.requests.find(item=>item.path.includes('/publish/'))!;
  expect(publish.ifMatch).toBe('"r2"');expect(publish.body).toEqual({});
  expect(service.state.published.find(item=>item.id==='notice-alpha')?.name).toBe('更新公告');
  expect((await readDraft(page)).writes).toEqual([]);
  expect((await readDraft(page)).sendCalls).toBe(0);
});

test('save conflict retains local changes and blocks publishing stale content',async({page})=>{
  const service=await openAdmin(page);
  await admin(page).getByRole('button',{name:/公司公告/}).click();
  await admin(page).getByLabel('範本名稱',{exact:true}).fill('保留修改');
  service.conflict=true;
  await admin(page).getByRole('button',{name:'儲存草稿',exact:true}).click();
  await expect(admin(page).getByRole('alert')).toContainText('其他人更新');
  await expect(admin(page).getByLabel('範本名稱',{exact:true})).toHaveValue('保留修改');
  await expect(admin(page).getByRole('button',{name:'發布已存草稿'})).toBeDisabled();
  await admin(page).getByRole('button',{name:'重新整理',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();
  await expect(admin(page).getByLabel('範本名稱',{exact:true})).toHaveValue('保留修改');
});

test('editor has save controls without publisher actions',async({page})=>{
  await openAdmin(page,['Template.Editor']);
  await admin(page).getByRole('button',{name:/公司公告/}).click();
  await admin(page).getByLabel('範本名稱',{exact:true}).fill('編輯者草稿');
  await expect(admin(page).getByRole('button',{name:'儲存草稿',exact:true})).toBeEnabled();
  await expect(admin(page).getByRole('button',{name:'發布已存草稿'})).toHaveCount(0);
  await expect(admin(page).getByRole('button',{name:'下架',exact:true})).toHaveCount(0);
  await expect(admin(page).getByRole('button',{name:'回復並發布'})).toHaveCount(0);
});

test('withdrawn templates remain selectable for confirmed version rollback',async({page})=>{
  const service=await openAdmin(page);
  await admin(page).getByRole('button',{name:/公司公告/}).click();
  await admin(page).getByRole('button',{name:'下架',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'確認替換',exact:true}).click();
  await expect(admin(page).getByRole('button',{name:/notice-alpha.*已下架/})).toBeVisible();
  await admin(page).getByLabel('回復版本').selectOption('v1');
  await admin(page).getByRole('button',{name:'回復並發布'}).click();
  await expect(page.getByRole('dialog')).toContainText('回復歷史版本');
  await page.getByRole('dialog').getByRole('button',{name:'確認替換',exact:true}).click();
  await expect(admin(page).getByRole('status')).toContainText('已回復');
  expect(service.requests.find(item=>item.path.includes('/rollback/'))?.body).toEqual({version:'v1'});
  expect(service.state.published.some(item=>item.id==='notice-alpha')).toBe(true);
});
