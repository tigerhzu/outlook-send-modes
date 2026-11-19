import { useEffect, useRef, useState } from 'react';
import CompanyCatalog from './CompanyCatalog';
import CompanyAdmin from './CompanyAdmin';
import { renderCatalogTemplate, type Catalog, type CatalogTemplate } from '../catalog';
import { CompanyHttpError, fetchCompanyCatalog, loadCompanyConfig, signInCompany } from '../company-api';
import type { ApplyResult, ConfirmApply } from '../types';

export function assertPublishedVersion(template:CatalogTemplate,catalog:Catalog):void {
  const current=catalog.templates.find(item=>item.id===template.id);
  if(!current) throw new Error('此範本已下架或無法存取，未插入草稿。');
  if(JSON.stringify(current)!==JSON.stringify(template)) throw new Error('範本已更新，請重新選擇並預覽後插入。');
}
interface Props {
  hostReady:boolean; disabled:boolean; confirm:ConfirmApply; onBusyChange:(value:boolean)=>void;
  draftKey:number; readBodyFormat:()=>Promise<'html'|'text'>;
  onApply:(template:CatalogTemplate,rendered:ReturnType<typeof renderCatalogTemplate>,applySubject:boolean,verify:()=>Promise<void>,expectedBodyType:'html'|'text')=>Promise<ApplyResult>;
}
export default function CompanyWorkspace({hostReady,disabled,confirm,onBusyChange,onApply,draftKey,readBodyFormat}:Props) {
  const [enabled,setEnabled]=useState(import.meta.env.VITE_COMPANY_DEPLOYMENT==='1');
  const [catalog,setCatalog]=useState<Catalog|null>(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [signedIn,setSignedIn]=useState(false);
  const [admin,setAdmin]=useState(false);
  const [bodyFormat,setBodyFormat]=useState<'html'|'text'>();
  const token=useRef<{accessToken:string;expiresAt:number}|null>(null);
  const request=useRef(0); const mounted=useRef(true);
  useEffect(()=>{
    mounted.current=true;
    void loadCompanyConfig().then(config=>{if(mounted.current)setEnabled(!!config);}).catch(()=>{if(mounted.current){setEnabled(true);setError('公司連線設定無法讀取，請重新整理。');}});
    return ()=>{mounted.current=false;request.current++;token.current=null;onBusyChange(false);};
  },[]);
  useEffect(()=>{
    let current=true;setBodyFormat(undefined);setNotice('');
    if(hostReady)void readBodyFormat().then(format=>{if(current)setBodyFormat(format);}).catch(()=>{});
    return ()=>{current=false;};
  },[hostReady,draftKey]);
  function accessToken() {
    if(!token.current || token.current.expiresAt<Date.now()+30_000) {token.current=null;setSignedIn(false);setCatalog(null);throw new Error('請重新登入公司帳號。');}
    return token.current.accessToken;
  }
  async function refresh() {
    const serial=++request.current;setLoading(true);setError('');
    try {
      const config=await loadCompanyConfig();if(!config)throw new Error('公司範本尚未設定。');
      if(hostReady)setBodyFormat(await readBodyFormat());
      const next=await fetchCompanyCatalog(accessToken());
      if(mounted.current && request.current===serial)setCatalog(next);
    } catch(caught) {
      if(mounted.current && request.current===serial){setCatalog(null);setError(caught instanceof Error?caught.message:'公司範本無法載入。');if(caught instanceof CompanyHttpError && caught.status===401){token.current=null;setSignedIn(false);}}
    } finally {if(mounted.current && request.current===serial)setLoading(false);}
  }
  async function signIn() {
    setError('');onBusyChange(true);
    try {const result=await signInCompany();if(!mounted.current)return;token.current=result;setSignedIn(true);await refresh();}
    finally {onBusyChange(false);}
  }
  async function verify(template:CatalogTemplate) {
    try {
      const fresh=await fetchCompanyCatalog(accessToken());
      if(!mounted.current)throw new Error('草稿已切換，請重新選擇範本。');
      setCatalog(fresh);assertPublishedVersion(template,fresh);
    } catch(caught) {
      if(caught instanceof CompanyHttpError || !(caught instanceof Error && /範本已更新|已下架/.test(caught.message))){setCatalog(null);setError('無法確認最新發布版本，已停止插入。請重新整理或登入。');}
      throw caught;
    }
  }
  if(!enabled)return null;
  return <>
    {notice && <div className="notice info" role="status">{notice}</div>}
    {admin ? <CompanyAdmin getToken={accessToken} confirm={confirm} onClose={()=>{setAdmin(false);onBusyChange(false);void refresh();}} /> : <>
      <CompanyCatalog key={draftKey} catalog={catalog} loading={loading} error={error} disabled={disabled} hostReady={hostReady && !!bodyFormat} previewFormat={bodyFormat} onRefresh={refresh} onSignIn={!signedIn ? signIn : undefined}
        onApply={async(template,values,applySubject)=>{
          onBusyChange(true);setNotice('');
          try {
            const rendered=renderCatalogTemplate(template,values);
            if(!bodyFormat)throw new Error('請重新整理以確認草稿格式。');
            const result=await onApply(template,rendered,applySubject,()=>verify(template),bodyFormat);
            if(result.status==='error' || result.status==='partial')throw new Error(result.message);
            if(result.status!=='cancelled')setNotice(result.message);
          } finally {onBusyChange(false);}
        }} />
      {signedIn && <button type="button" className="text-button" disabled={disabled || loading} onClick={()=>{setAdmin(true);onBusyChange(true);}}>管理公司範本</button>}
    </>}
  </>;
}
