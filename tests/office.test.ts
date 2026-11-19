import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { composeAvailable,initializeOffice,OfficeDraftPort,officeCall,STATE_KEY,SIGNATURE_STATE_KEY,COMPANY_STATE_KEY } from '../src/office';
import type { TemplateState } from '../src/draft';
import type { Recipient } from '../src/types';

type Callback<T>=(result:Office.AsyncResult<T>)=>void;
const success=<T>(callback:Callback<T>,value:T)=>callback({status:'succeeded',value} as unknown as Office.AsyncResult<T>);
const failure=<T>(callback:Callback<T>,message:string,code=9001)=>callback({status:'failed',error:{message,code}} as unknown as Office.AsyncResult<T>);

function createHost() {
  const data:{to:Recipient[];cc:Recipient[];subject:string;bodyHtml:string;bodyType:string;props:Record<string,unknown>}={
    to:[{displayName:'Existing To',emailAddress:'existing@example.test'}],cc:[{displayName:'Existing CC',emailAddress:'cc@example.test'}],
    subject:'Existing subject',bodyHtml:'<p>Signature</p>',bodyType:'html',props:{},
  };
  const properties={
    get:vi.fn((key:string)=>data.props[key]),
    remove:vi.fn((key:string)=>{delete data.props[key];}),
    set:vi.fn((key:string,value:unknown)=>{data.props[key]=value;}),
    saveAsync:vi.fn((callback:Callback<void>)=>success(callback,undefined)),
  };
  const recipient=(field:'to'|'cc')=>({
    getAsync:vi.fn((callback:Callback<Recipient[]>)=>success(callback,structuredClone(data[field]))),
    setAsync:vi.fn((value:Recipient[],callback:Callback<void>)=>{data[field]=structuredClone(value);success(callback,undefined);}),
    addAsync:vi.fn((value:Recipient[],callback:Callback<void>)=>{data[field].push(...structuredClone(value));success(callback,undefined);}),
  });
  const item={
    itemType:'message',to:recipient('to'),cc:recipient('cc'),
    subject:{
      getAsync:vi.fn((callback:Callback<string>)=>success(callback,data.subject)),
      setAsync:vi.fn((value:string,callback:Callback<void>)=>{data.subject=value;success(callback,undefined);}),
    },
    body:{
      getTypeAsync:vi.fn((callback:Callback<string>)=>success(callback,data.bodyType)),
      getAsync:vi.fn((_type:string,_options:{bodyMode:string},callback:Callback<string>)=>success(callback,data.bodyHtml)),
      prependAsync:vi.fn((html:string,_options:{coercionType:string},callback:Callback<void>)=>{data.bodyHtml=html+data.bodyHtml;success(callback,undefined);}),
      setAsync:vi.fn((html:string,_options:{coercionType:string;bodyMode:string},callback:Callback<void>)=>{data.bodyHtml=html;success(callback,undefined);}),
    },
    loadCustomPropertiesAsync:vi.fn((callback:Callback<typeof properties>)=>success(callback,properties)),
    addFileAttachmentFromBase64Async:vi.fn((_data:string,_name:string,_options:{isInline:boolean},callback:Callback<string>)=>success(callback,'inline-id')),
    addFileAttachmentAsync:vi.fn((_url:string,_name:string,_options:{isInline:boolean},callback:Callback<string>)=>success(callback,'inline-id')),
    getAttachmentsAsync:vi.fn((callback:Callback<Office.AttachmentDetailsCompose[]>)=>success(callback,[{id:'image-id',name:'logo.png',size:100,isInline:true,contentId:'test-logo'} as Office.AttachmentDetailsCompose])),
    getAttachmentContentAsync:vi.fn((_id:string,callback:Callback<Office.AttachmentContent>)=>success(callback,{content:'aGVsbG8=',format:'base64'} as Office.AttachmentContent)),
  };
  const handlers:Record<string,()=>void>={};
  const mailbox={
    item:item as unknown,
    userProfile:{emailAddress:'test@example.test'},
    addHandlerAsync:vi.fn((event:string,handler:()=>void,callback:Callback<void>)=>{handlers[event]=handler;success(callback,undefined);}),
  };
  const office={
    AsyncResultStatus:{Succeeded:'succeeded',Failed:'failed'},HostType:{Outlook:'Outlook'},EventType:{ItemChanged:'itemChanged'},
    CoercionType:{Html:'html',Text:'text'},MailboxEnums:{ItemType:{Message:'message'},BodyMode:{HostConfig:'hostConfig'}},
    onReady:vi.fn(async()=>({host:'Outlook'})),
    context:{mailbox,requirements:{isSetSupported:vi.fn((_name:string,_version:string)=>true)}},
  };
  return {office,item,data,properties,handlers};
}

let host:ReturnType<typeof createHost>;
beforeEach(()=>{host=createHost();vi.stubGlobal('Office',host.office);});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});

describe('Office callback bridge (mocked Office.js, not a real Outlook host)',()=>{
  it('adopts one legacy company block into the shared state and preserves signature tracking',async()=>{
    const state:TemplateState={version:1,token:'company-template-test',modeId:'company:overtime',presetHash:'hash',phase:'applied'};
    host.data.props[COMPANY_STATE_KEY]=JSON.stringify(state); host.data.props[SIGNATURE_STATE_KEY]='signature';
    const port=new OfficeDraftPort(); expect(await port.readState()).toEqual(state);
    await port.saveState({...state,modeId:'overtime'});
    expect(host.data.props[COMPANY_STATE_KEY]).toBeUndefined();
    expect(host.data.props[SIGNATURE_STATE_KEY]).toBe('signature');
    expect((await new OfficeDraftPort().readState())?.modeId).toBe('overtime');
  });
  it('fails closed on two tracked blocks or an unfinished legacy company insertion',async()=>{
    host.data.props[STATE_KEY]='current';host.data.props[COMPANY_STATE_KEY]='legacy';
    await expect(new OfficeDraftPort().readState()).rejects.toThrow(/兩套/);
    delete host.data.props[STATE_KEY];
    host.data.props[COMPANY_STATE_KEY]=JSON.stringify({version:1,token:'company-template-test',modeId:'company:overtime',presetHash:'hash',phase:'prepared'});
    await expect(new OfficeDraftPort().readState()).rejects.toThrow(/未確認完成/);
  });
  it('saves independent signature tracking without replacing the template state',async()=>{
    host.data.props[STATE_KEY]='keep-template-state';
    const port=new OfficeDraftPort();
    expect(await port.readSignatureState()).toBeUndefined();
    const state={version:1,token:'send-signature-test',phase:'prepared'} as const;
    await port.saveSignatureState(state);
    expect(host.data.props[STATE_KEY]).toBe('keep-template-state');
    expect(JSON.parse(String(host.data.props[SIGNATURE_STATE_KEY]))).toEqual(state);
    expect(await new OfficeDraftPort().readSignatureState()).toEqual(state);
  });
  it('rejects corrupt signature tracking and refuses unsupported image APIs before attaching',async()=>{
    host.data.props[SIGNATURE_STATE_KEY]='{"version":99}';
    await expect(new OfficeDraftPort().readSignatureState()).rejects.toThrow(/簽章追蹤設定/);
    host.office.context.requirements.isSetSupported.mockReturnValue(false);
    expect(()=>new OfficeDraftPort().checkSignatureImages([{name:'image.png',source:'data:image/png;base64,aGVsbG8='}])).toThrow(/不支援簽章圖片/);
    expect(host.item.addFileAttachmentAsync).not.toHaveBeenCalled();
  });
  it('attaches embedded and HTTPS signature images inline with the exact CID filename',async()=>{
    const port=new OfficeDraftPort();
    await port.addSignatureImage({name:'inline.png',source:'data:image/png;base64,aGVsbG8='});
    expect(host.item.addFileAttachmentFromBase64Async).toHaveBeenCalledWith('aGVsbG8=','inline.png',{isInline:true},expect.any(Function));
    await port.addSignatureImage({name:'remote.png',source:'https://example.test/logo.png'});
    expect(host.item.addFileAttachmentAsync).toHaveBeenCalledWith('https://example.test/logo.png','remote.png',{isInline:true},expect.any(Function));
    await expect(port.addSignatureImage({name:'bad.png',source:'file:///private.png'})).rejects.toThrow(/來源無效/);
  });
  it('resolves pasted CID images only by exact content ID in the current draft',async()=>{
    const port=new OfficeDraftPort();
    expect(await port.readInlineImage('cid:test-logo')).toBe('data:image/png;base64,aGVsbG8=');
    expect(host.item.getAttachmentContentAsync).toHaveBeenCalledWith('image-id',expect.any(Function));
    await expect(port.readInlineImage('cid:different-logo')).rejects.toThrow(/找不到/);
    host.item.getAttachmentContentAsync.mockClear();
    host.handlers.itemChanged?.();
    host.office.context.mailbox.item=createHost().item;
    await expect(port.readInlineImage('cid:test-logo')).rejects.toThrow(/草稿已切換/);
    expect(host.item.getAttachmentContentAsync).not.toHaveBeenCalled();
  });
  it('reads HTML using HostConfig and maps the resolved recipient list',async()=>{
    const snapshot=await new OfficeDraftPort().snapshot();
    expect(host.item.body.getAsync).toHaveBeenCalledWith('html',{bodyMode:'hostConfig'},expect.any(Function));
    expect(snapshot).toEqual({to:host.data.to,cc:host.data.cc,subject:'Existing subject',bodyType:'html',bodyHtml:'<p>Signature</p>'});
  });
  it('supports the base requirement set without optional pinning or BodyMode enum',async()=>{
    host.office.context.requirements.isSetSupported.mockImplementation((_name:string,version:string)=>version==='1.3');
    delete (host.office.MailboxEnums as Partial<typeof host.office.MailboxEnums>).BodyMode;
    await initializeOffice(()=>{});
    expect(host.office.context.mailbox.addHandlerAsync).not.toHaveBeenCalled();
    const port=new OfficeDraftPort();expect(await port.bodyFormat()).toBe('html');await port.snapshot();await port.setBody('<p>safe</p>');
    expect(host.item.body.getAsync).toHaveBeenCalledWith('html',{},expect.any(Function));
    expect(host.item.body.setAsync).toHaveBeenCalledWith('<p>safe</p>',{coercionType:'html'},expect.any(Function));
  });
  it('uses HTML coercion for insertion and HostConfig for managed body replacement',async()=>{
    const port=new OfficeDraftPort();
    await port.prepend('<p>Template</p>');await port.setBody('<p>Replacement and signature</p>');
    expect(host.item.body.prependAsync).toHaveBeenCalledWith('<p>Template</p>',{coercionType:'html'},expect.any(Function));
    expect(host.item.body.setAsync).toHaveBeenCalledWith('<p>Replacement and signature</p>',{coercionType:'html',bodyMode:'hostConfig'},expect.any(Function));
  });
  it('sets complete recipient lists and supports an empty list to clear CC',async()=>{
    const port=new OfficeDraftPort();const next=[{displayName:'New one',emailAddress:'one@example.test'},{displayName:'New two',emailAddress:'two@example.test'}];
    await port.setTo(next);await port.setCc([]);await port.setSubject('New subject');
    expect(host.item.to.setAsync).toHaveBeenCalledWith(next,expect.any(Function));
    expect(host.item.cc.setAsync).toHaveBeenCalledWith([],expect.any(Function));
    expect(host.data.to).toEqual(next);expect(host.data.cc).toEqual([]);expect(host.data.subject).toBe('New subject');
  });
  it('reads a plain-text item with text coercion without requesting HTML',async()=>{
    host.data.bodyType='text';const snapshot=await new OfficeDraftPort().snapshot();
    expect(snapshot.bodyType).toBe('text');expect(snapshot.bodyHtml).toBe('');expect(snapshot.bodyText).toBe(host.data.bodyHtml);expect(host.item.body.getAsync).toHaveBeenCalledWith('text',{bodyMode:'hostConfig'},expect.any(Function));
  });
  it('reads and saves a versioned tracking state as a custom property JSON string',async()=>{
    const state:TemplateState={version:1,token:'send-mode-abc-123',modeId:'overtime',presetHash:'hash',phase:'applied'};
    host.data.props[STATE_KEY]=JSON.stringify(state);const port=new OfficeDraftPort();
    await expect(port.readState()).resolves.toEqual(state);
    const prepared={...state,phase:'prepared'} as const;await port.saveState(prepared);
    expect(host.properties.set).toHaveBeenCalledWith(STATE_KEY,JSON.stringify(prepared));
    expect(host.properties.saveAsync).toHaveBeenCalledOnce();
  });
  it('treats a missing tracking property as a fresh draft',async()=>{
    await expect(new OfficeDraftPort().readState()).resolves.toBeUndefined();
  });
  it.each([
    ['broken JSON','{broken'],
    ['JSON null','null'],
    ['unknown version',JSON.stringify({version:2,token:'send-mode-abc',modeId:'x',presetHash:'h',phase:'applied'})],
    ['unsafe marker',JSON.stringify({version:1,token:'<unsafe>',modeId:'x',presetHash:'h',phase:'applied'})],
    ['unknown phase',JSON.stringify({version:1,token:'send-mode-abc',modeId:'x',presetHash:'h',phase:'unknown'})],
  ])('rejects %s without treating the draft as fresh',async(_name,value)=>{
    host.data.props[STATE_KEY]=value;await expect(new OfficeDraftPort().readState()).rejects.toThrow(/模板追蹤設定/);
    expect(host.item.body.prependAsync).not.toHaveBeenCalled();
  });
  it('surfaces custom property save failures',async()=>{
    const port=new OfficeDraftPort();await port.readState();
    host.properties.saveAsync.mockImplementation(callback=>failure(callback,'Could not save',500));
    await expect(port.saveState({version:1,token:'send-mode-abc',modeId:'x',presetHash:'h',phase:'prepared'})).rejects.toThrow(/儲存模板追蹤設定失敗.*Could not save.*500/);
  });
  it('cannot save tracking state before the item properties have been loaded',async()=>{
    await expect(new OfficeDraftPort().saveState({version:1,token:'send-mode-abc',modeId:'x',presetHash:'h',phase:'prepared'})).rejects.toThrow(/尚未讀取/);
  });
  it('times out at 15 seconds and ignores late host success callbacks',async()=>{
    vi.useFakeTimers();let late:Callback<string>|undefined;const onTimeout=vi.fn();
    const promise=officeCall<string>('測試操作',callback=>{late=callback;},onTimeout);
    const rejected=expect(promise).rejects.toThrow(/測試操作逾時/);
    await vi.advanceTimersByTimeAsync(14_999);expect(onTimeout).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);await rejected;expect(onTimeout).toHaveBeenCalledOnce();
    success(late!,'late result');await expect(promise).rejects.toThrow(/逾時/);
    expect(onTimeout).toHaveBeenCalledOnce();
  });
  it('propagates API error code and synchronous exceptions without leaving pending timers',async()=>{
    vi.useFakeTimers();
    await expect(officeCall<void>('寫入',callback=>failure(callback,'Denied',403))).rejects.toThrow(/Denied.*403/);
    await expect(officeCall<void>('寫入',()=>{throw new Error('synchronous failure');})).rejects.toThrow('synchronous failure');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('quarantines a timed-out item across newly constructed ports',async()=>{
    vi.useFakeTimers();host.item.subject.setAsync.mockImplementation(()=>{});
    const port=new OfficeDraftPort();const promise=port.setSubject('Maybe written later');
    const rejected=expect(promise).rejects.toThrow(/逾時/);
    await vi.advanceTimersByTimeAsync(15_000);await rejected;
    expect(port.isCurrent()).toBe(false);const retry=new OfficeDraftPort();expect(retry.isCurrent()).toBe(false);
    await expect(retry.setTo([])).rejects.toThrow(/草稿已切換/);expect(host.item.to.setAsync).not.toHaveBeenCalled();
    host.office.context.mailbox.item=createHost().item;expect(new OfficeDraftPort().isCurrent()).toBe(true);
  });
  it('registers ItemChanged and invalidates old ports even if the item object is reused',async()=>{
    const onChange=vi.fn();const before=new OfficeDraftPort();await initializeOffice(onChange);
    expect(host.office.context.requirements.isSetSupported).toHaveBeenCalledWith('Mailbox','1.3');
    expect(host.office.context.mailbox.addHandlerAsync).toHaveBeenCalledWith('itemChanged',expect.any(Function),expect.any(Function));
    expect(before.isCurrent()).toBe(true);host.handlers.itemChanged();
    expect(onChange).toHaveBeenCalledOnce();expect(before.isCurrent()).toBe(false);
    host.office.context.mailbox.item=createHost().item;expect(new OfficeDraftPort().isCurrent()).toBe(true);
  });
  it('rejects a non-Outlook host and unsupported requirement set',async()=>{
    host.office.onReady.mockResolvedValue({host:'Word'});await expect(initializeOffice(()=>{})).rejects.toThrow(/新版 Outlook/);
    host.office.onReady.mockResolvedValue({host:'Outlook'});host.office.context.requirements.isSetSupported.mockReturnValue(false);
    await expect(initializeOffice(()=>{})).rejects.toThrow(/未支援必要草稿 API/);
    expect(host.office.context.mailbox.addHandlerAsync).not.toHaveBeenCalled();
  });
  it('refuses absent, reading, and non-message items',()=>{
    host.office.context.mailbox.item=null;expect(composeAvailable()).toBe(false);expect(()=>new OfficeDraftPort()).toThrow(/撰寫/);
    host.office.context.mailbox.item={...host.item,subject:'Read subject'};expect(composeAvailable()).toBe(false);
    host.office.context.mailbox.item={...host.item,itemType:'appointment'};expect(composeAvailable()).toBe(false);
    vi.stubGlobal('Office',undefined);expect(composeAvailable()).toBe(false);
  });
});

it('reads old Outlook image URLs by exact attachment ID and never by filename or arbitrary URL',async()=>{
  const port=new OfficeDraftPort();
  expect(await port.readInlineImage('https://outlook.office.com/owa/service.svc/s/GetAttachmentThumbnail?id=image-id')).toBe('data:image/png;base64,aGVsbG8=');
  expect(await port.readInlineImage('attachment:image-id')).toBe('data:image/png;base64,aGVsbG8=');
  expect(await port.readInlineImage('cid:%3Ctest-logo%3E')).toBe('data:image/png;base64,aGVsbG8=');
  host.item.getAttachmentContentAsync.mockClear();
  await expect(port.readInlineImage('https://other.example.test/?id=image-id')).rejects.toThrow();
  await expect(port.readInlineImage('https://outlook.office.com/?id=logo.png')).rejects.toThrow();
  expect(host.item.getAttachmentContentAsync).not.toHaveBeenCalled();
});
it('rejects ambiguous inline matches rather than selecting a wrong image',async()=>{
  host.item.getAttachmentsAsync.mockImplementation(cb=>success(cb,[{id:'one',contentId:'duplicate',name:'a.png',size:100,isInline:true},{id:'two',contentId:'duplicate',name:'b.png',size:100,isInline:true}] as Office.AttachmentDetailsCompose[]));
  await expect(new OfficeDraftPort().readInlineImage('cid:duplicate')).rejects.toThrow(/找不到/);
  expect(host.item.getAttachmentContentAsync).not.toHaveBeenCalled();
});
