import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import CompanyWorkspace from './components/CompanyWorkspace';
import { defaultSettings, validateSettings } from './model';
import { SettingsStore } from './storage';
import { ApplyController } from './draft';
import { composeAvailable, initializeOffice, OfficeDraftPort } from './office';
import type { Settings } from './types';
import './styles.css';

function Root() {
  const [settings,setSettings]=useState<Settings>(defaultSettings);
  const [ready,setReady]=useState(false);
  const [message,setMessage]=useState('正在連線至 Outlook…');
  const [account,setAccount]=useState('loading');
  const [companyBusy,setCompanyBusy]=useState(false);
  const [draftSession,setDraftSession]=useState(0);
  const store=useRef<SettingsStore|null>(null);
  const storageAccount=useRef('');
  const controller=useRef(new ApplyController());
  useEffect(()=>{
    let mounted=true;
    const update=()=>{
      if(!mounted) return;
      try {
        const email=Office.context.mailbox.userProfile.emailAddress;
        if(!email) throw new Error('無法辨識目前信箱，已停用設定與草稿寫入。');
        if(storageAccount.current!==email) {
          const next=new SettingsStore(email);
          const loaded=next.load();
          store.current=next;storageAccount.current=email;setSettings(loaded);setAccount(email);
        }
        setReady(composeAvailable());setMessage(composeAvailable() ? '' : '請開啟一封正在撰寫的郵件。');
      } catch(e) {store.current=null;setReady(false);setMessage(`無法載入本機設定：${e instanceof Error?e.message:String(e)} 請保留原始資料並檢查儲存空間／權限。`);}
    };
    void initializeOffice(()=>{setDraftSession(value=>value+1);update();}).then(update).catch(e=>{if(mounted){setReady(false);setMessage(e instanceof Error?e.message:String(e));}});
    return ()=>{mounted=false;};
  },[]);
  return <App key={account} settings={settings} hostReady={ready} hostMessage={message} externalBusy={companyBusy}
    renderCompany={(confirm,busy)=><CompanyWorkspace key={account} draftKey={draftSession} readBodyFormat={()=>new OfficeDraftPort().bodyFormat()} hostReady={ready} disabled={busy} confirm={confirm} onBusyChange={setCompanyBusy}
      onApply={async(template,rendered,applySubject,verify,expectedBodyType)=>{
        const port=new OfficeDraftPort();
        await verify();
        return controller.current.apply({id:`published:${template.id}`,name:template.name,to:[],cc:[],subject:rendered.subject,bodyHtml:rendered.html},settings,port,confirm,{preserveRecipients:true,preserveSubject:!applySubject,plainText:rendered.text,beforeWrite:verify,expectedBodyType});
      }} />}
    onSignature={async()=>controller.current.addSignature(settings.signatureHtml || '',new OfficeDraftPort())}
    resolveSignatureImage={async source=>new OfficeDraftPort().readInlineImage(source)}
    onSave={async next=>{
      if(!store.current) throw new Error('尚未連線至 Outlook 的本機設定。請從 Outlook 開啟工作窗格後儲存；可先匯出備份。');
      const clean=validateSettings(next);store.current.save(clean);setSettings(clean);
    }}
    onApply={async(modeId,confirm)=>{
      if(!ready) return {status:'error',message:'請先開啟 Outlook 撰寫郵件。',completed:[]};
      const mode=settings.modes.find(m=>m.id===modeId);
      if(!mode) return {status:'error',message:'模式已不存在，請重新開啟工作窗格。',completed:[]};
      try {return await controller.current.apply(mode,settings,new OfficeDraftPort(),confirm);}
      catch(e){return {status:'error',message:e instanceof Error?e.message:String(e),completed:[]};}
    }} />;
}
class LoadBoundary extends React.Component<{children: React.ReactNode}, {failed: boolean}> {
  state = {failed: false};
  static getDerivedStateFromError() { return {failed: true}; }
  render() {
    if (this.state.failed) return <main role="alert" style={{padding:24}}>
      <p>寄信模式無法載入。請檢查網路並重新開啟工作窗格；若仍失敗，請聯絡管理者。</p>
      <button type="button" onClick={()=>location.reload()}>重新載入</button>
    </main>;
    return this.props.children;
  }
}
createRoot(document.getElementById('root')!).render(<LoadBoundary><Root /></LoadBoundary>);
