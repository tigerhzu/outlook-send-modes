import type { DraftPort, DraftSnapshot, TemplateState } from './draft';
import type { Recipient } from './types';
import { imageDataPattern, isPublicImageUrl, type SignatureImage, type SignaturePort, type SignatureState } from './signature';

export const STATE_KEY = 'sendModesTemplateV1';
export const SIGNATURE_STATE_KEY = 'sendModesSignatureV1';
export const COMPANY_STATE_KEY = 'sendModesCompanyV1';
let itemRevision = 0;
const timedOutItems = new WeakSet<object>();
function bodyModeOptions(): {bodyMode?:Office.MailboxEnums.BodyMode} {
  const mode=(Office.MailboxEnums as unknown as {BodyMode?:{HostConfig:Office.MailboxEnums.BodyMode}}).BodyMode?.HostConfig;
  return mode ? {bodyMode:mode} : {};
}

export function officeCall<T>(label:string, invoke:(callback:(result:Office.AsyncResult<T>)=>void)=>void, onTimeout?:()=>void):Promise<T> {
  return new Promise((resolve,reject)=>{
    let settled=false;
    const timeout=setTimeout(()=>{
      if (settled) return; settled=true; onTimeout?.();
      reject(new Error(`${label}逾時。Outlook 仍可能完成此操作；請檢查草稿並重新開啟工作窗格。`));
    },15_000);
    try {
      invoke(result=>{
        if (settled) return; settled=true; clearTimeout(timeout);
        if (result.status===Office.AsyncResultStatus.Succeeded) resolve(result.value);
        else reject(new Error(`${label}失敗：${result.error?.message || '未知錯誤'}${result.error?.code ? ` (${result.error.code})` : ''}`));
      });
    } catch(e) {settled=true;clearTimeout(timeout);reject(e);}
  });
}

export function composeAvailable():boolean {
  if (typeof Office==='undefined' || !Office.context?.mailbox?.item) return false;
  const item=Office.context.mailbox.item;
  return item.itemType===Office.MailboxEnums.ItemType.Message && typeof item.subject!=='string' && typeof item.to?.setAsync==='function';
}

export class OfficeDraftPort implements DraftPort, SignaturePort {
  private readonly item:Office.MessageCompose;
  private readonly revision=itemRevision;
  private timedOut=false;
  private properties:Office.CustomProperties | undefined;
  constructor() {
    if (!composeAvailable()) throw new Error('請先在 Outlook 開啟正在撰寫的郵件。');
    this.item=Office.context.mailbox.item as Office.MessageCompose;
  }
  isCurrent():boolean { return !this.timedOut && !timedOutItems.has(this.item) && this.revision===itemRevision && Office.context.mailbox.item===this.item; }
  async bodyFormat():Promise<'html'|'text'> {
    const value=await this.call<Office.CoercionType>('讀取內文格式',cb=>this.item.body.getTypeAsync(cb));
    if(!this.isCurrent())throw new Error('草稿已切換，請重新整理。');
    if(value!==Office.CoercionType.Html && value!==Office.CoercionType.Text)throw new Error('郵件格式不支援。');
    return value===Office.CoercionType.Html?'html':'text';
  }
  private call<T>(label:string,invoke:(cb:(result:Office.AsyncResult<T>)=>void)=>void):Promise<T> {
    if (!this.isCurrent()) return Promise.reject(new Error('草稿已切換，請重新套用。'));
    return officeCall(label,invoke,()=>{this.timedOut=true;timedOutItems.add(this.item);});
  }
  async snapshot():Promise<DraftSnapshot> {
    const [to,cc,subject,bodyType] = await Promise.all([
      this.call<Office.EmailAddressDetails[]>('讀取 To',cb=>this.item.to.getAsync(cb)),
      this.call<Office.EmailAddressDetails[]>('讀取 CC',cb=>this.item.cc.getAsync(cb)),
      this.call<string>('讀取主旨',cb=>this.item.subject.getAsync(cb)),
      this.call<Office.CoercionType>('讀取內文格式',cb=>this.item.body.getTypeAsync(cb)),
    ]);
    const bodyOptions=bodyModeOptions();
    const body=await this.call<string>('讀取內文',cb=>this.item.body.getAsync(bodyType,bodyOptions,cb));
    const bodyHtml=bodyType===Office.CoercionType.Html ? body : '';
    const recipients=(values:Office.EmailAddressDetails[])=>values.map(r=>({displayName:r.displayName,emailAddress:r.emailAddress}));
    return {to:recipients(to),cc:recipients(cc),subject,bodyType,bodyHtml,...(bodyType===Office.CoercionType.Text ? {bodyText:body} : {})};
  }
  async readState():Promise<TemplateState|undefined> {
    this.properties=await this.call<Office.CustomProperties>('讀取模板追蹤設定',cb=>this.item.loadCustomPropertiesAsync(cb));
    const current:unknown=this.properties.get(STATE_KEY);
    const legacy:unknown=this.properties.get(COMPANY_STATE_KEY);
    const present = (value: unknown) => value != null && value !== '';
    if (present(current) && present(legacy)) throw new Error('這封草稿有兩套舊模板追蹤，無法安全合併。請保留原稿，在新的草稿套用。');
    const value = present(current) ? current : legacy;
    if (value==null || value==='') return undefined;
    let state:TemplateState;
    try { state=typeof value==='string' ? JSON.parse(value) : value; } catch { throw new Error('模板追蹤設定無法讀取。為避免重複表格，請使用新的草稿。'); }
    if (!state || typeof state!=='object' || Array.isArray(state) || state.version!==1 || !/^(?:send-mode|company-template)-[a-z0-9-]+$/.test(state.token) || typeof state.modeId!=='string' || typeof state.presetHash!=='string' || !['prepared','applied'].includes(state.phase)) throw new Error('模板追蹤設定格式不支援。請使用新的草稿。');
    if (!present(current) && (state.phase !== 'applied' || !/^company-template-/.test(state.token) || !state.modeId.startsWith('company:'))) throw new Error('舊公司範本追蹤未確認完成，已停止以保護原稿。');
    return state;
  }
  async saveState(state:TemplateState):Promise<void> {
    if (!this.properties) throw new Error('尚未讀取模板追蹤設定。');
    this.properties.set(STATE_KEY,JSON.stringify(state));
    this.properties.remove(COMPANY_STATE_KEY);
    await this.call<void>('儲存模板追蹤設定',cb=>this.properties!.saveAsync(cb));
  }
  async readSignatureState(): Promise<SignatureState | undefined> {
    this.properties = await this.call<Office.CustomProperties>('讀取簽章設定',cb=>this.item.loadCustomPropertiesAsync(cb));
    const value: unknown = this.properties.get(SIGNATURE_STATE_KEY);
    if (value == null || value === '') return undefined;
    let state: SignatureState;
    try { state = typeof value === 'string' ? JSON.parse(value) : value; }
    catch { throw new Error('簽章追蹤設定無法讀取，已停止加入。'); }
    if (!state || state.version !== 1 || !/^send-signature-[a-z0-9-]+$/.test(state.token) || !['prepared','applied'].includes(state.phase)) throw new Error('簽章追蹤設定無效，已停止加入。');
    return state;
  }
  async saveSignatureState(state: SignatureState): Promise<void> {
    if (!this.properties) throw new Error('尚未讀取簽章設定。');
    this.properties.set(SIGNATURE_STATE_KEY,JSON.stringify(state));
    await this.call<void>('儲存簽章設定',cb=>this.properties!.saveAsync(cb));
  }
  checkSignatureImages(images: SignatureImage[]): void {
    if (images.length && (!Office.context.requirements.isSetSupported('Mailbox','1.8') || typeof this.item.addFileAttachmentFromBase64Async !== 'function' || typeof this.item.addFileAttachmentAsync !== 'function')) throw new Error('此 Outlook 版本不支援簽章圖片，請更新 Outlook。');
  }
  async addSignatureImage(image: SignatureImage): Promise<void> {
    const data = image.source.match(imageDataPattern);
    if (data) await this.call<string>('加入簽章圖片',cb=>this.item.addFileAttachmentFromBase64Async(data[2],image.name,{isInline:true},cb));
    else if (isPublicImageUrl(image.source)) await this.call<string>('加入簽章圖片',cb=>this.item.addFileAttachmentAsync(image.source,image.name,{isInline:true},cb));
    else throw new Error('簽章圖片來源無效。');
  }
  async readInlineImage(source: string): Promise<string> {
    if (!Office.context.requirements.isSetSupported('Mailbox','1.8')) throw new Error('圖片未隨剪貼簿帶入，請用「圖片」加入原檔。');
    let cid='',id='';
    if(/^cid:/i.test(source)) {try {cid=decodeURIComponent(source.slice(4));} catch {cid=source.slice(4);} cid=cid.replace(/^<|>$/g,'');}
    else if(source.startsWith('attachment:')) id=source.slice(11);
    else {
      try {
        const url=new URL(source);
        if(url.protocol!=='https:' || !/(^|\.)(outlook\.office\.com|outlook\.office365\.com|outlook\.live\.com|office\.net|outlook\.cloud\.microsoft)$/i.test(url.hostname)) throw new Error();
        id=url.searchParams.get('id') || url.searchParams.get('attachmentId') || '';
        cid=(url.searchParams.get('cid') || url.searchParams.get('contentId') || '').replace(/^<|>$/g,'');
      } catch {throw new Error('無法辨識 Outlook 圖片來源。');}
    }
    if(!cid && !id) throw new Error('無法辨識 Outlook 圖片來源。');
    const attachments = await this.call<Office.AttachmentDetailsCompose[]>('讀取簽章圖片',cb=>this.item.getAttachmentsAsync(cb));
    const matches = attachments.filter(attachment=>attachment.isInline && ((!!cid && attachment.contentId?.replace(/^<|>$/g,'') === cid) || (!!id && attachment.id===id)));
    if (matches.length !== 1) throw new Error('找不到貼上圖片的原檔，請用「圖片」加入。');
    const attachment = matches[0];
    const extension = attachment.name.split('.').pop()?.toLowerCase();
    const declaredType=(attachment as Office.AttachmentDetailsCompose & {contentType?:string}).contentType;
    const mime = /^image\/(png|jpeg|gif|webp)$/i.test(declaredType || '') ? declaredType : ({png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp'} as Record<string,string>)[extension || ''];
    if (!mime || attachment.size > 500_000) throw new Error('請使用 500 KB 以下的 PNG、JPG、GIF 或 WebP 圖片。');
    const content = await this.call<Office.AttachmentContent>('讀取圖片內容',cb=>this.item.getAttachmentContentAsync(attachment.id,cb));
    if (!this.isCurrent() || String(content.format).toLowerCase() !== 'base64') throw new Error('無法讀取圖片內容，請用「圖片」加入原檔。');
    return `data:${mime};base64,${content.content}`;
  }
  prepend(html:string):Promise<void> {return this.call('插入內文',cb=>this.item.body.prependAsync(html,{coercionType:Office.CoercionType.Html},cb));}
  prependText(text:string):Promise<void> {return this.call('插入純文字',cb=>this.item.body.prependAsync(text,{coercionType:Office.CoercionType.Text},cb));}
  setBody(html:string):Promise<void> {return this.call('更新模板',cb=>this.item.body.setAsync(html,{coercionType:Office.CoercionType.Html,...bodyModeOptions()},cb));}
  setTo(recipients:Recipient[]):Promise<void> {return this.call('更新 To',cb=>this.item.to.setAsync(recipients,cb));}
  setCc(recipients:Recipient[]):Promise<void> {return this.call('更新 CC',cb=>this.item.cc.setAsync(recipients,cb));}
  setSubject(subject:string):Promise<void> {return this.call('更新主旨',cb=>this.item.subject.setAsync(subject,cb));}
}

export async function initializeOffice(onItemChanged:()=>void):Promise<void> {
  const waitForScript=()=>new Promise<void>((resolve,reject)=>{
    if (typeof Office!=='undefined') {resolve();return;}
    const script=document.getElementById('office-js');
    const timeout=setTimeout(()=>reject(new Error('Office.js 載入逾時。請檢查網路並從 Outlook 重新開啟增益集。')),15_000);
    script?.addEventListener('load',()=>{clearTimeout(timeout);resolve();},{once:true});
    script?.addEventListener('error',()=>{clearTimeout(timeout);reject(new Error('無法載入 Office.js。請檢查網路連線。'));},{once:true});
  });
  await waitForScript();
  let timer:ReturnType<typeof setTimeout> | undefined;
  try {
    const info=await Promise.race([
      Office.onReady(),
      new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('尚未連線至 Outlook。請在新版 Outlook 的撰寫郵件視窗開啟「寄信模式」。')),15_000);}),
    ]);
    if (info.host!==Office.HostType.Outlook) throw new Error('請從新版 Outlook 撰寫郵件的「應用程式」開啟寄信模式。此頁不是獨立寄信網站。');
    if (!Office.context.requirements.isSetSupported('Mailbox','1.3')) throw new Error('此 Outlook 版本未支援必要草稿 API，請更新 Outlook。');
    if (Office.context.requirements.isSetSupported('Mailbox','1.5')) {
      await officeCall<void>('監聽草稿切換',cb=>Office.context.mailbox.addHandlerAsync(Office.EventType.ItemChanged,()=>{itemRevision++;onItemChanged();},cb));
    }
  } finally {if(timer) clearTimeout(timer);}
}
