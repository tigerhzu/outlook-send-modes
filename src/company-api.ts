import { parseCatalog, type Catalog } from './catalog';

export interface CompanyConfig { enabled: true; tenantId: string; clientId: string; scope: string }
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function parseCompanyConfig(value: unknown): CompanyConfig | null {
  if (!value || typeof value!=='object') throw new Error('公司連線設定無效。');
  const c=value as Record<string,unknown>;
  if(c.enabled===false) return null;
  if(c.enabled!==true || typeof c.tenantId!=='string' || !uuid.test(c.tenantId) || typeof c.clientId!=='string' || !uuid.test(c.clientId) || typeof c.scope!=='string' || !/^api:\/\/[a-f0-9-]{36}\/Templates\.Read$/i.test(c.scope)) throw new Error('公司連線設定無效。');
  return {enabled:true,tenantId:c.tenantId,clientId:c.clientId,scope:c.scope};
}
export class CompanyHttpError extends Error { constructor(message:string,readonly status:number) {super(message);} }
export async function companyRequest(path:string,token?:string,init:RequestInit={}):Promise<{data:unknown;etag:string}> {
  if(!/^\/api\/(config|catalog|admin(?:\/[a-z0-9_./%-]+)?)$/i.test(path)) throw new Error('公司 API 路徑無效。');
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),15_000);
  try {
    const response=await fetch(new URL(path,location.origin),{...init,signal:controller.signal,cache:'no-store',credentials:'omit',redirect:'error',headers:{Accept:'application/json',...(token?{Authorization:`Bearer ${token}`} : {}),...init.headers}});
    if(!response.ok) throw new CompanyHttpError(response.status===401?'請登入公司帳號。':response.status===403?'此帳號沒有操作權限。':response.status===409 || response.status===412?'內容已被其他人更新，請重新整理後再試。':'公司範本服務無法使用，請稍後再試。',response.status);
    if(!response.headers.get('content-type')?.includes('application/json')) throw new Error('公司服務回傳格式無效。');
    const limit=path.startsWith('/api/admin')?30_000_000:4_000_000;
    if(Number(response.headers.get('content-length'))>limit) throw new Error('公司範本資料過大。');
    const reader=response.body?.getReader(); if(!reader) throw new Error('公司服務沒有回傳資料。');
    const decoder=new TextDecoder(); let text='',bytes=0;
    while(true) {const result=await reader.read();if(result.done)break;bytes+=result.value.byteLength;if(bytes>limit){await reader.cancel();throw new Error('公司範本資料過大。');}text+=decoder.decode(result.value,{stream:true});}
    text+=decoder.decode();
    return {data:JSON.parse(text),etag:response.headers.get('etag') || ''};
  } catch(error) {
    if(controller.signal.aborted) throw new Error('公司範本載入逾時，請重新整理。');
    throw error;
  } finally {clearTimeout(timer);}
}
export async function loadCompanyConfig():Promise<CompanyConfig|null> {
  try { return parseCompanyConfig((await companyRequest('/api/config')).data); }
  catch(error) { if(error instanceof CompanyHttpError && error.status===404 && import.meta.env.VITE_COMPANY_DEPLOYMENT!=='1') return null; throw error; }
}
export async function fetchCompanyCatalog(token:string):Promise<Catalog> {return parseCatalog((await companyRequest('/api/catalog',token)).data);}

/** The bearer is held in the taskpane's memory, never localStorage or a URL. */
export async function signInCompany():Promise<{accessToken:string;expiresAt:number}> {
  if(typeof Office==='undefined' || !Office.context.ui?.displayDialogAsync) throw new Error('請從 Outlook 開啟公司登入。');
  const nonce=crypto.randomUUID();
  return new Promise((resolve,reject)=>{
    let dialog:Office.Dialog|undefined; let done=false;
    const finish=(error?:Error,result?:{accessToken:string;expiresAt:number})=>{if(done)return;done=true;clearTimeout(timer);dialog?.close();error?reject(error):resolve(result!);};
    const timer=setTimeout(()=>finish(new Error('登入逾時，請重試。')),300_000);
    Office.context.ui.displayDialogAsync(new URL(`/auth.html#channel=${nonce}`,location.origin).href,{height:65,width:45,displayInIframe:false},result=>{
      if(result.status!==Office.AsyncResultStatus.Succeeded){finish(new Error('無法開啟公司登入，請確認允許登入視窗。'));return;}
      dialog=result.value;if(done){dialog.close();return;}
      dialog.addEventHandler(Office.EventType.DialogMessageReceived,(event)=>{
        if(!('message' in event)) return;
        if(event.origin && event.origin!==location.origin) return;
        try {
          const message=JSON.parse(event.message);
          if(message.channel!==nonce) return;
          if(message.error) {finish(new Error('公司登入未完成，請重試。'));return;}
          if(typeof message.accessToken!=='string' || message.accessToken.length>20_000 || !Number.isFinite(message.expiresAt) || message.expiresAt<=Date.now()) throw new Error();
          finish(undefined,{accessToken:message.accessToken,expiresAt:message.expiresAt});
        } catch {finish(new Error('登入回傳無效，請重試。'));}
      });
      dialog.addEventHandler(Office.EventType.DialogEventReceived,()=>finish(new Error('公司登入已關閉，請重試。')));
    });
  });
}
