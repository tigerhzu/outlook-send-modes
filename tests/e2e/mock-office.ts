import type { Page } from '@playwright/test';

export interface TestDraft {
  to: {displayName:string;emailAddress:string}[];
  cc: {displayName:string;emailAddress:string}[];
  subject:string;
  bodyHtml:string;
  bodyType:string;
  properties:Record<string,unknown>;
  writes:string[];
  failNext:string;
  sendCalls:number;
  images:{source:string;name:string;isInline:boolean}[];
  normalizeBodyAfterSave?:boolean;
  reassignSignatureCids?:boolean;
}

/** Test-only injected host. This does not validate Microsoft Outlook integration. */
export async function installMockOffice(page:Page) {
  await page.route('https://appsforoffice.microsoft.com/**',route=>route.fulfill({status:200,contentType:'application/javascript',body:'/* Office.js is replaced by a test-only fake host. */'}));
  await page.addInitScript(()=>{
    type Recipient={displayName:string;emailAddress:string};
    type Result={status:string;value?:unknown;error?:{message:string;code:number}};
    type Callback=(result:Result)=>void;
    const win=window as unknown as {Office:unknown;__testDraft:TestDraft};
    const saved=sessionStorage.getItem('test-draft');
    const data:TestDraft=saved ? JSON.parse(saved) : {to:[],cc:[],subject:'',bodyHtml:'<p id="signature"><img src="cid:company-logo">測試簽名</p><blockquote>測試回覆歷史</blockquote>',bodyType:'html',properties:{},writes:[],failNext:'',sendCalls:0,images:[]};
    win.__testDraft=data;
    const persist=()=>sessionStorage.setItem('test-draft',JSON.stringify(data));
    const ok=(callback:Callback,value?:unknown)=>queueMicrotask(()=>callback({status:'succeeded',value}));
    const write=(field:string,callback:Callback,action:()=>void)=>{
      if(data.failNext===field) {data.failNext='';queueMicrotask(()=>callback({status:'failed',error:{message:`測試 ${field} 寫入失敗`,code:9001}}));return;}
      action();
      const tracked=data.properties.sendModesTemplateV1;
      if(data.reassignSignatureCids && ['body','properties','to','cc','subject'].includes(field) && (field!=='properties' || (typeof tracked==='string' && JSON.parse(tracked).phase==='applied'))) {
        data.bodyHtml=data.bodyHtml.replace(/cid:company-logo(?:-\d+)?/g,`cid:company-logo-${data.writes.length}`);
      }
      if(data.normalizeBodyAfterSave && ['properties','to','cc','subject'].includes(field)) {
        const state=data.properties.sendModesTemplateV1;
        if(typeof state==='string' && JSON.parse(state).phase==='applied') {
          data.bodyHtml=data.bodyHtml.replace(/ (id|class)="((?:x_)*send-mode-[^"]+)"/g,' $1="x_$2"')+'<!-- Outlook normalization -->';
        }
      }
      data.writes.push(field);persist();ok(callback);
    };
    const recipient=(field:'to'|'cc')=>({
      getAsync:(callback:Callback)=>ok(callback,structuredClone(data[field])),
      setAsync:(value:Recipient[],callback:Callback)=>write(field,callback,()=>{data[field]=structuredClone(value);}),
      addAsync:(value:Recipient[],callback:Callback)=>write(field,callback,()=>{data[field].push(...structuredClone(value));}),
    });
    const item={
      itemType:'message',to:recipient('to'),cc:recipient('cc'),
      subject:{getAsync:(callback:Callback)=>ok(callback,data.subject),setAsync:(value:string,callback:Callback)=>write('subject',callback,()=>{data.subject=value;})},
      body:{
        getTypeAsync:(callback:Callback)=>ok(callback,data.bodyType),
        getAsync:(_type:string,_options:unknown,callback:Callback)=>ok(callback,data.bodyHtml),
        prependAsync:(value:string,_options:unknown,callback:Callback)=>write('prepend',callback,()=>{data.bodyHtml=value+data.bodyHtml;}),
        setAsync:(value:string,_options:unknown,callback:Callback)=>write('body',callback,()=>{data.bodyHtml=value;}),
      },
      loadCustomPropertiesAsync:(callback:Callback)=>ok(callback,{
        get:(key:string)=>data.properties[key],
        remove:(key:string)=>{delete data.properties[key];},
        set:(key:string,value:unknown)=>{data.properties[key]=value;},
        saveAsync:(callback:Callback)=>write('properties',callback,()=>{}),
      }),
      addFileAttachmentFromBase64Async:(source:string,name:string,options:{isInline:boolean},callback:Callback)=>write('image',callback,()=>{data.images.push({source,name,isInline:options.isInline});}),
      addFileAttachmentAsync:(source:string,name:string,options:{isInline:boolean},callback:Callback)=>write('image',callback,()=>{data.images.push({source,name,isInline:options.isInline});}),
      getAttachmentsAsync:(callback:Callback)=>{
        const cid=data.bodyHtml.match(/cid:(company-logo(?:-\d+)?)/)?.[1];
        ok(callback,[{id:'inline-logo-id',contentId:'mock-logo-cid',name:'logo.png',isInline:true,size:68},...(cid?[{id:`body-${cid}`,contentId:cid,name:'logo.png',isInline:true,size:68}]:[])]);
      },
      getAttachmentContentAsync:(id:string,callback:Callback)=>id==='inline-logo-id' || (id.startsWith('body-company-logo') && data.bodyHtml.includes(`cid:${id.slice(5)}`)) ? ok(callback,{format:'base64',content:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='}) : callback({status:'failed',error:{message:'Unknown image',code:9001}}),
      sendAsync:()=>{data.sendCalls++;throw new Error('Tests prohibit sending mail');},
    };
    win.Office={
      onReady:async()=>({host:'Outlook'}),HostType:{Outlook:'Outlook'},AsyncResultStatus:{Succeeded:'succeeded',Failed:'failed'},
      CoercionType:{Html:'html',Text:'text'},EventType:{ItemChanged:'itemChanged'},
      MailboxEnums:{ItemType:{Message:'message'},BodyMode:{HostConfig:'hostConfig'}},
      context:{requirements:{isSetSupported:()=>true},mailbox:{item,userProfile:{emailAddress:'test-user@example.test'},addHandlerAsync:(_event:string,_handler:unknown,callback:Callback)=>ok(callback)}},
    };
  });
}

export async function readDraft(page:Page):Promise<TestDraft> {
  return page.evaluate(()=>(window as unknown as {__testDraft:TestDraft}).__testDraft);
}
