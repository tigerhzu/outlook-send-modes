import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ApplyResult, ConfirmApply, ConfirmPlan, FavoriteRecipient, Mode, Settings } from './types';
import { isEmail, missingRecipients, splitEmails, upgradeSettings, validateSettings } from './model';
import TemplateEditor from './components/TemplateEditor';
import ActionMenu from './components/ActionMenu';
import { hasSignatureContent } from './signature';
import { captureSignatureImages } from './signature-paste';
import './styles.css';

export interface AppProps {
  settings: Settings;
  onSave: (settings: Settings) => Promise<void>;
  onApply: (modeId: string, confirm: ConfirmApply) => Promise<ApplyResult>;
  onSignature: () => Promise<ApplyResult>;
  resolveSignatureImage: (source: string) => Promise<string>;
  hostReady: boolean;
  hostMessage: string;
  externalBusy?: boolean;
  renderCompany?: (confirm:ConfirmApply, busy:boolean)=>ReactNode;
}

interface Notice { kind: 'success' | 'error' | 'info'; text: string }
interface DialogState extends ConfirmPlan { title: string; action: string; resolve: (answer: boolean) => void }
const copy = (settings: Settings) => structuredClone(settings);
const errorText = (error: unknown) => error instanceof Error ? error.message : '操作失敗，請稍後再試。';

function Icon({ name }: { name: 'settings' | 'back' | 'edit' | 'arrow' | 'plus' | 'signature' }) {
  const paths = {
    settings: <><path d="m9 3-.6 2-2 .9-2-.5-1.5 2.6 1.4 1.6v2.3L3 13.5l1.5 2.6 2-.4 2 .9.5 2h3l.6-2 2-.9 2 .4 1.5-2.6-1.4-1.6V9.6l1.4-1.6-1.5-2.6-2 .5-2-.9-.6-2Z"/><circle cx="10.5" cy="10.8" r="3"/></>,
    back: <path d="m13 5-7 7 7 7" />,
    edit: <><path d="m14.5 4.5 5 5M4 20l5-1L20 8a2.1 2.1 0 0 0-5-5L4 14Z"/></>,
    arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
    plus: <path d="M12 5v14M5 12h14" />,
    signature: <><path d="M3 16c5-3 9-8 8-11-1-3-4 2-4 6 0 6 3 7 5 2 0 4 2 4 4 1l2 2h3M3 21h18" /></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function Dialog({ request, onAnswer }: { request: DialogState; onAnswer: (answer: boolean) => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    cancel.current?.focus();
    return () => previous?.focus();
  }, []);
  return <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onAnswer(false); }}>
    <div className="dialog" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-description" onKeyDown={(event) => {
      if (event.key === 'Escape') { event.preventDefault(); onAnswer(false); }
      if (event.key === 'Tab') {
        const focusable = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), summary, input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]') || []).filter((element) => element.getClientRects().length > 0);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }}>
      <h2 id="confirm-title">{request.title}</h2>
      <div id="confirm-description"><ul className="change-list">{request.changes.map((change, index) => <li key={index}>{change}</li>)}</ul></div>
      {request.previousTemplateText && <details className="previous-template"><summary>查看目前模板內容</summary><pre>{request.previousTemplateText}</pre></details>}
      <div className="dialog-actions"><button type="button" ref={cancel} className="button" onClick={() => onAnswer(false)}>取消</button><button type="button" className="button primary" onClick={() => onAnswer(true)}>{request.action}</button></div>
    </div>
  </div>;
}

function RecipientSummary({ emails }: { emails: string[] }) {
  return <span className="recipient-names">{emails.length ? emails.map((email,index)=><span key={index} title={email}>{email || '未填 Email'}</span>) : '—'}</span>;
}

function RecipientInput({ label, emails, favorites, disabled, onChange, onManage }: { label: 'To' | 'CC'; emails: string[]; favorites: FavoriteRecipient[]; disabled: boolean; onChange: (emails: string[]) => void; onManage: () => void }) {
  const rows=emails.length ? emails : [''];
  const root=useRef<HTMLDivElement>(null);
  const focusIndex=useRef<number|null>(null);
  useEffect(()=>{
    if(focusIndex.current !== null) {
      root.current?.querySelectorAll('input')[focusIndex.current]?.focus();
      focusIndex.current=null;
    }
  },[emails]);
  function add(email: string) {
    const blank=emails.findIndex(value=>!value.trim());
    const index=blank>=0 ? blank : emails.length;
    focusIndex.current=index;
    onChange(blank>=0 ? emails.map((value,i)=>i===blank?email:value) : [...emails,email]);
  }
  return <div className="recipient-field" ref={root} role="group" aria-label={label}>
    <span className="recipient-label">{label}</span>
    <div className="recipient-inputs">{rows.map((email,index)=><div className="recipient-entry" key={index}>
      <input aria-label={index===0 ? `${label} Email` : `${label} Email ${index+1}`} value={email} disabled={disabled} type="text" inputMode="email" autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="Email" onPaste={event=>{
        const pasted=event.clipboardData.getData('text/plain');
        if(/[;,\n，；]/.test(pasted)) {event.preventDefault();onChange([...rows.slice(0,index),...splitEmails(pasted),...rows.slice(index+1)]);}
      }} onChange={event=>{
        const value=event.target.value;
        const values=/[;,\n，；]/.test(value) ? splitEmails(value) : [value];
        const next=[...rows.slice(0,index),...values,...rows.slice(index+1)];
        onChange(next.length===1 && !next[0] ? [] : next);
      }} />
      <button type="button" className="plain-icon remove" aria-label={`移除 ${label} 第 ${index+1} 位`} title="移除" disabled={disabled || !emails.length} onClick={()=>onChange(emails.filter((_,i)=>i!==index))}>×</button>
    </div>)}</div>
    <ActionMenu label={`新增 ${label}`} symbol="＋" disabled={disabled}>
      <button type="button" disabled={emails.length>=100} onClick={()=>add('')}>新增一人</button>
      {favorites.filter(person=>isEmail(person.email)).map(person=><button type="button" className="favorite-choice" key={person.id} disabled={emails.length>=100 || emails.some(email=>email.trim().toLowerCase()===person.email.trim().toLowerCase())} onClick={()=>add(person.email.trim())}>
        {person.name && <span>{person.name}</span>}<span className={person.name ? 'favorite-email' : undefined}>{person.email}</span>
      </button>)}
      <button type="button" className="manage-favorites" onClick={onManage}>管理常用</button>
    </ActionMenu>
  </div>;
}

export default function App({ settings, onSave, onApply, onSignature, resolveSignatureImage, hostReady, hostMessage, externalBusy=false, renderCompany }: AppProps) {
  const [view, setView] = useState<'home' | 'manage' | 'signature' | 'favorites'>('home');
  const [favoritesFrom, setFavoritesFrom] = useState<'home'|'manage'>('home');
  const [editorBusy, setEditorBusy] = useState(false);
  const [draft, setDraft] = useState<Settings>(() => copy(settings));
  const [selectedId, setSelectedId] = useState(settings.modes[0]?.id || '');
  const [localBusy, setBusy] = useState(false);
  const busy=localBusy || externalBusy;
  const busyRef = useRef(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const activeDialog = useRef<DialogState | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);
  const selected = draft.modes.find((mode) => mode.id === selectedId);

  useEffect(() => {
    setDraft(copy(settings));
    setSelectedId((id) => settings.modes.some((mode) => mode.id === id) ? id : settings.modes[0]?.id || '');
  }, [settings]);
  useEffect(() => () => { activeDialog.current?.resolve(false); }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  function ask(plan: ConfirmPlan, title = '確認套用模式', action = '確認替換') {
    return new Promise<boolean>((resolve) => {
      activeDialog.current?.resolve(false);
      const next = { ...plan, title, action, resolve };
      activeDialog.current = next;
      setDialog(next);
    });
  }
  function answer(value: boolean) {
    const request = activeDialog.current;
    activeDialog.current = null;
    setDialog(null);
    request?.resolve(value);
  }
  function lock(value: boolean) { busyRef.current = value; setBusy(value); }

  async function apply(mode: Mode) {
    if (busyRef.current || !hostReady) return;
    lock(true); setApplyingId(mode.id); setNotice(null);
    try {
      const result = await onApply(mode.id, (plan) => ask(plan));
      if (result.status !== 'cancelled') setNotice({ kind: result.status === 'error' || result.status === 'partial' ? 'error' : result.status === 'success' ? 'success' : 'info', text: result.message });
    } catch (error) { setNotice({ kind: 'error', text: errorText(error) }); }
    finally { lock(false); setApplyingId(null); }
  }

  function manage(id?: string) {
    if (busyRef.current) return;
    setDraft(copy(settings));
    setSelectedId(id || settings.modes[0]?.id || '');
    setView('manage'); setNotice(null);
  }

  function editFavorites(from: 'home'|'manage') {
    if(busyRef.current) return;
    if(from==='home') setDraft(copy(settings));
    setFavoritesFrom(from);setView('favorites');setNotice(null);
  }

  function editSignature() {
    if (busyRef.current) return;
    setDraft(copy(settings)); setView('signature'); setNotice(null);
    window.scrollTo(0,0);
  }

  async function insertSignature() {
    if (busyRef.current) return;
    if (!hasSignatureContent(settings.signatureHtml)) { editSignature(); return; }
    if (!hostReady) return;
    lock(true); setNotice(null);
    try {
      const result = await onSignature();
      setNotice({kind:result.status === 'error' || result.status === 'partial' ? 'error' : result.status === 'success' ? 'success' : 'info',text:result.message});
    } catch (error) { setNotice({kind:'error',text:errorText(error)}); }
    finally { lock(false); }
  }

  async function leaveManagement() {
    if (busyRef.current || editorBusy) return;
    if(view==='favorites' && favoritesFrom==='manage') {setView('manage');setNotice(null);return;}
    if (dirty && !await ask({ changes: ['尚未儲存的變更將捨棄。'] }, '離開編輯？', '捨棄變更')) return;
    setDraft(copy(settings)); setView('home'); setNotice(null);
  }

  function updateMode(changes: Partial<Mode>) {
    setDraft((current) => ({ ...current, modes: current.modes.map((mode) => mode.id === selectedId ? { ...mode, ...changes } : mode) }));
  }

  async function save() {
    if (busyRef.current || editorBusy) return;
    lock(true); setNotice(null);
    try {
      const prepared = view==='signature' && draft.signatureHtml ? {...draft,signatureHtml:await captureSignatureImages(draft.signatureHtml,resolveSignatureImage)} : draft;
      const validated = validateSettings(prepared);
      await onSave(validated);
      setDraft(copy(validated));
      setView('home');
      window.scrollTo(0, 0);
      setNotice({ kind: 'success', text: '已儲存' });
    } catch (error) { setNotice({ kind: 'error', text: errorText(error) }); }
    finally { lock(false); }
  }

  function addMode() {
    const mode: Mode = { id: crypto.randomUUID(), name: '新模式', to: [], cc: [], subject: '', bodyHtml: '<p><br></p>' };
    setDraft((current) => ({ ...current, modes: [...current.modes, mode] }));
    setSelectedId(mode.id); setNotice(null);
  }

  async function removeMode(mode: Mode) {
    if (!await ask({ changes: [`刪除「${mode.name}」？按 Save 後生效。`] }, '刪除模式？', '刪除模式')) return;
    setDraft((current) => {
      const modes = current.modes.filter((item) => item.id !== mode.id);
      setSelectedId(modes[0]?.id || '');
      return { ...current, modes };
    });
  }

  function exportSettings() {
    try {
      const url = URL.createObjectURL(new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url; link.download = '寄信模式備份.json'; document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setNotice({ kind: 'error', text: errorText(error) }); }
  }

  async function importSettings(file: File | undefined) {
    if (!file || busyRef.current) return;
    lock(true); setNotice(null);
    try {
      if (file.size > 2_000_000) throw new Error('備份檔案過大，請選擇 2 MB 以下的 JSON 檔。');
      const imported = upgradeSettings(validateSettings(JSON.parse(await file.text())));
      if (!await ask({ changes: ['以備份取代目前設定，按 Save 後生效。'] }, '匯入備份？', '匯入')) return;
      setDraft(imported); setSelectedId(imported.modes[0]?.id || '');
      setNotice({ kind: 'info', text: '已匯入，按 Save 保存。' });
    } catch (error) { setNotice({ kind: 'error', text: `無法匯入：${errorText(error)}` }); }
    finally { lock(false); if (importInput.current) importInput.current.value = ''; }
  }

  return <div className="app-shell">
    {view !== 'home' && <header className="app-header">
      <button type="button" className="plain-icon" aria-label="返回" title="返回" disabled={busy || editorBusy} onClick={() => void leaveManagement()}><Icon name="back" /></button>
      <h1>{view === 'signature' ? '簽章' : view==='favorites' ? '常用聯絡人' : '編輯模式'}</h1>
      <div className="header-action header-tools">
        <ActionMenu label="更多操作" disabled={busy || editorBusy}>
          {view === 'manage' && <><button type="button" onClick={addMode}>新增模式</button><button type="button" onClick={()=>editFavorites('manage')}>常用聯絡人</button></>}
          <button type="button" onClick={exportSettings}>匯出備份</button><button type="button" onClick={()=>importInput.current?.click()}>匯入備份</button>
          {view === 'manage' && selected && <button type="button" className="danger" aria-label={`刪除「${selected.name || '未命名'}」模式`} onClick={()=>void removeMode(selected)}>刪除模式</button>}
        </ActionMenu>
        <button type="button" className="button primary" disabled={busy || editorBusy} onClick={() => void save()}>{busy ? '儲存中…' : 'Save'}</button>
      </div>
    </header>}
    <main aria-label={view === 'home' ? '寄信模式' : undefined}>
      {!hostReady && hostMessage && <div className="notice info host-notice" role="status">{hostMessage}</div>}
      {notice && <div className={`notice ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</div>}
      {view === 'home' ? <>
        {renderCompany?.(plan=>ask(plan),localBusy)}
        {import.meta.env.VITE_COMPANY_DEPLOYMENT==='1' && <h2 style={{margin:'16px 0 12px'}}>個人模式</h2>}
        <div className="mode-list" aria-busy={busy}>
          {settings.modes.map((mode) => {
            const missing = missingRecipients(mode);
            return <article className="mode-card" key={mode.id} aria-labelledby={`mode-${mode.id}`}>
              <div className="mode-title-row"><h2 id={`mode-${mode.id}`}>{mode.name}</h2><button type="button" className="plain-icon edit-button" aria-label={`編輯${mode.name}`} title={`編輯${mode.name}`} disabled={busy} onClick={() => manage(mode.id)}><Icon name="edit" /></button></div>
              <div className="mode-content">
              <dl className="mode-details"><div><dt>To</dt><dd><RecipientSummary emails={mode.to} /></dd></div>{mode.cc.length > 0 && <div><dt>CC</dt><dd><RecipientSummary emails={mode.cc} /></dd></div>}</dl>
              <button type="button" className="button primary apply-button" aria-label={`套用${mode.name}`} disabled={busy || !hostReady || missing.length > 0} onClick={() => void apply(mode)}>{applyingId === mode.id ? <><span className="spinner" />套用中</> : <>套用<Icon name="arrow" /></>}</button></div>
              {missing.length > 0 && <button type="button" className="text-button missing-address" disabled={busy} onClick={() => manage(mode.id)}>填寫 {missing.join('／')} Email</button>}
            </article>;
          })}
          {!settings.modes.length && <div className="empty-state"><p>還沒有模式。</p><button type="button" className="button primary" onClick={() => manage()}>新增模式</button></div>}
        </div>
        <div className="signature-action"><button type="button" className="signature-button" disabled={busy || (!hostReady && hasSignatureContent(settings.signatureHtml))} onClick={() => void insertSignature()}>簽章</button><button type="button" className="plain-icon edit-button" aria-label="編輯簽章" title="編輯簽章" disabled={busy} onClick={editSignature}><Icon name="edit" /></button></div>
        <div className="home-tools"><button type="button" className="button primary" disabled={busy} onClick={()=>editFavorites('home')}>常用聯絡人</button><button type="button" className="settings-button" disabled={busy} onClick={()=>manage()}><Icon name="settings" />設定</button></div>
      </> : view==='favorites' ? <div className="favorites-editor">
        {(draft.favorites || []).map((person,index)=><div className="favorite-entry" key={person.id}>
          <div className="favorite-fields">
            <input aria-label={`常用姓名 ${index+1}`} placeholder="姓名" value={person.name} disabled={busy} onChange={event=>setDraft(current=>({...current,favorites:current.favorites?.map(item=>item.id===person.id?{...item,name:event.target.value}:item)}))} />
            <input aria-label={`常用 Email ${index+1}`} placeholder="Email" value={person.email} disabled={busy} autoComplete="off" autoCapitalize="none" spellCheck={false} inputMode="email" onChange={event=>setDraft(current=>({...current,favorites:current.favorites?.map(item=>item.id===person.id?{...item,email:event.target.value}:item)}))} />
          </div>
          <button type="button" className="plain-icon remove" aria-label={`刪除常用 ${index+1}`} title="刪除" disabled={busy} onClick={()=>setDraft(current=>({...current,favorites:current.favorites?.filter(item=>item.id!==person.id)}))}>×</button>
        </div>)}
        <button type="button" className="text-button" disabled={busy || (draft.favorites?.length || 0)>=500} onClick={()=>setDraft(current=>({...current,favorites:[...(current.favorites || []),{id:crypto.randomUUID(),name:'',email:''}]}))}>＋新增常用</button>
      </div> : view === 'signature'  ? <div className="signature-editor"><TemplateEditor signature value={draft.signatureHtml || ''} disabled={busy} onBusyChange={setEditorBusy} resolveImage={resolveSignatureImage} onChange={signatureHtml=>setDraft(current=>({...current,signatureHtml}))} /></div> : <div className="management">
        {selected ? <div className="mode-form" key={selected.id}>
          <label className="compose-field mode-name"><span className="visually-hidden">名稱</span><input aria-label="模式名稱" value={selected.name} disabled={busy} maxLength={80} onChange={(event) => updateMode({ name: event.target.value })} /></label>
          <RecipientInput label="To" emails={selected.to} favorites={draft.favorites || []} onManage={()=>editFavorites('manage')} disabled={busy} onChange={(to) => updateMode({ to })} />
          <RecipientInput label="CC" emails={selected.cc} favorites={draft.favorites || []} onManage={()=>editFavorites('manage')} disabled={busy} onChange={(cc) => updateMode({ cc })} />
          <label className="compose-field"><span>主旨</span><input aria-label="主旨" value={selected.subject} disabled={busy} maxLength={255} onChange={(event) => updateMode({ subject: event.target.value })} /></label>
          <TemplateEditor value={selected.bodyHtml} disabled={busy} onChange={(bodyHtml) => updateMode({ bodyHtml })} />
        </div> : <div className="empty-state"><button type="button" className="button" disabled={busy} onClick={addMode}>新增模式</button></div>}
      </div>}
      <input ref={importInput} className="visually-hidden" type="file" aria-label="匯入設定檔案" accept=".json,application/json" tabIndex={-1} disabled={busy || editorBusy} onChange={(event) => void importSettings(event.target.files?.[0])} />
    </main>
    {dialog && <Dialog request={dialog} onAnswer={answer} />}
  </div>;
}
