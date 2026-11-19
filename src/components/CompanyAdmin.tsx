import { useEffect, useRef, useState } from 'react';
import { companyRequest } from '../company-api';
import { parseCatalog, type CatalogField, type CatalogTemplate } from '../catalog';
import CompanyCatalog from './CompanyCatalog';
import TemplateEditor from './TemplateEditor';
import type { ConfirmApply } from '../types';

interface AdminState {revision:string;roles:string[];drafts:CatalogTemplate[];published:CatalogTemplate[];history:{revision:string;at:string;action:string;templateId:string;actor:string;version?:string}[]}
type EditableField = Omit<CatalogField,'options'> & {optionsText:string};
type EditableTemplate = Omit<CatalogTemplate,'tags'|'audience'|'fields'> & {tagsText:string;audienceText:string;fields:EditableField[]};
const emptyTemplate = ():CatalogTemplate => ({id:`template-${crypto.randomUUID()}`,name:'新範本',category:'一般',tags:[],language:'zh-TW',version:'1',updatedAt:new Date().toISOString(),subject:'服務通知',bodyHtml:'<p>{{customer}} 您好：</p><p>服務將於 {{date}} 進行。</p>',bodyText:'{{customer}} 您好：\n服務將於 {{date}} 進行。',fields:[{key:'customer',label:'稱呼',type:'text',required:true},{key:'date',label:'服務日期',type:'date',required:true}],owner:'',audience:[]});
const splitList = (value:string) => value.split(/[,，\n]/).map(item=>item.trim()).filter(Boolean);
function editable(template:CatalogTemplate):EditableTemplate {
  const {tags,audience,fields,...rest}=template;
  return {...rest,tagsText:tags.join(', '),audienceText:audience.join(', '),fields:fields.map(({options,...field})=>({...field,defaultValue:field.defaultValue || '',optionsText:options?.join('\n') || ''}))};
}
function templateValue(edit:EditableTemplate):CatalogTemplate {
  const {tagsText,audienceText,fields,...rest}=edit;
  return {...rest,tags:splitList(tagsText),audience:splitList(audienceText),fields:fields.map(({optionsText,...field})=>({...field,...(field.type==='select'?{options:optionsText.split('\n').map(item=>item.trim()).filter(Boolean)}:{})}))};
}
function validateEdit(edit:EditableTemplate):CatalogTemplate {
  if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(edit.id)) throw new Error('ID 請使用 80 字元內的英數字、點、底線或連字號。');
  return parseCatalog({schemaVersion:1,revision:'preview',templates:[templateValue(edit)]}).templates[0];
}

export default function CompanyAdmin({getToken,confirm,onClose}:{getToken:()=>string;confirm:ConfirmApply;onClose:()=>void}) {
  const [state,setState]=useState<AdminState|null>(null);
  const [etag,setEtag]=useState('');
  const [edit,setEdit]=useState<EditableTemplate|null>(null);
  const [baseline,setBaseline]=useState('');
  const [selectedId,setSelectedId]=useState('');
  const [idLocked,setIdLocked]=useState(false);
  const [preview,setPreview]=useState<CatalogTemplate|null>(null);
  const [busy,setBusy]=useState(false);
  const busyRef=useRef(false);
  const [message,setMessage]=useState('');
  const [error,setError]=useState(false);
  const [rollbackVersion,setRollbackVersion]=useState('');
  const publisher=!!state?.roles.includes('Template.Publisher');
  const editor=publisher || !!state?.roles.includes('Template.Editor');
  const dirty=!!edit && JSON.stringify(edit)!==baseline;
  const savedDraft=state?.drafts.find(item=>item.id===selectedId);
  const published=state?.published.find(item=>item.id===selectedId);
  const history=state?.history.filter(item=>item.templateId===selectedId && ['publish','rollback'].includes(item.action) && item.version).slice().reverse() || [];
  const templateIds=[...new Set([...(state?.drafts || []),...(state?.published || [])].map(item=>item.id).concat(state?.history.map(item=>item.templateId) || []))];

  function installEditor(template:CatalogTemplate|null, id=template?.id || '', locked=true) {
    const next=template?editable(template):null;
    setEdit(next);setBaseline(next && locked?JSON.stringify(next):'');setSelectedId(id);setIdLocked(locked);
    setPreview(null);setRollbackVersion('');setMessage('');setError(false);
  }
  async function run(action:()=>Promise<void>) {
    if(busyRef.current)return;
    busyRef.current=true;setBusy(true);setMessage('');setError(false);
    try{await action();}
    catch(caught){setError(true);setMessage(caught instanceof Error?caught.message:'操作失敗，請重試。');}
    finally{busyRef.current=false;setBusy(false);}
  }
  async function mayDiscard() {
    return !dirty || await confirm({changes:['尚未儲存的範本變更將被捨棄。繼續離開目前編輯？']});
  }
  async function load() {
    const result=await companyRequest('/api/admin',getToken());
    const next=result.data as AdminState;
    setState(next);setEtag(result.etag);
    const current=next.drafts.find(item=>item.id===selectedId) || next.published.find(item=>item.id===selectedId);
    installEditor(current || null,current?.id || (next.history.some(item=>item.templateId===selectedId)?selectedId:''));
  }
  useEffect(()=>{void run(load);},[]);
  useEffect(()=>{
    if(!dirty)return;
    const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};
    window.addEventListener('beforeunload',warn);
    return ()=>window.removeEventListener('beforeunload',warn);
  },[dirty]);
  function change(update:Partial<EditableTemplate>) {
    setEdit(current=>current?{...current,...update}:current);setPreview(null);setMessage('');setError(false);
  }
  function changeField(index:number,update:Partial<EditableField>) {
    if(edit)change({fields:edit.fields.map((field,i)=>i===index?{...field,...update}:field)});
  }
  function select(id:string) {
    void run(async()=>{if(await mayDiscard())installEditor(state?.drafts.find(item=>item.id===id) || state?.published.find(item=>item.id===id) || null,id);});
  }
  function addField() {
    if(!edit)return;
    let number=edit.fields.length+1;
    while(edit.fields.some(field=>field.key===`field_${number}`))number++;
    change({fields:[...edit.fields,{key:`field_${number}`,label:`欄位 ${number}`,type:'text',required:false,defaultValue:'',optionsText:''}]});
  }
  async function write(action:'save'|'publish'|'withdraw'|'rollback') {
    if(!etag)return;
    await run(async()=>{
      const parsed=action==='save' && edit?validateEdit(edit):null;
      const id=parsed?.id || selectedId;
      if(!id)throw new Error('請先選擇範本。');
      if(action==='save') {
        if(!parsed || !editor)throw new Error('目前無法儲存範本。');
        if(idLocked && id!==selectedId)throw new Error('既有範本不能修改 ID。');
        if(!idLocked && templateIds.includes(id))throw new Error('此 ID 已存在，請改用其他 ID。');
      } else {
        if(!publisher)throw new Error('此帳號沒有發布權限。');
        if(dirty)throw new Error('請先儲存草稿或捨棄變更。');
        if(action==='publish' && !savedDraft)throw new Error('請先儲存草稿。');
        if(action==='rollback' && !history.some(item=>item.version===rollbackVersion))throw new Error('請選擇可回復的版本。');
        const label=action==='publish'?'發布已儲存草稿':action==='withdraw'?'下架':'回復歷史版本';
        if(!await confirm({changes:[`${label}「${edit?.name || id}」後，同仁將取得新的發布狀態。已插入的郵件草稿維持原樣。`]}))return;
      }
      const path=action==='save'?`/api/admin/drafts/${encodeURIComponent(id)}`:`/api/admin/${action}/${encodeURIComponent(id)}`;
      const result=await companyRequest(path,getToken(),{method:action==='save'?'PUT':'POST',headers:{'Content-Type':'application/json','If-Match':etag},body:JSON.stringify(parsed || (action==='rollback'?{version:rollbackVersion}:{}))});
      const next=result.data as AdminState;
      setState(next);setEtag(result.etag);
      installEditor(next.drafts.find(item=>item.id===id) || next.published.find(item=>item.id===id) || null,id);
      setMessage(action==='save'?'已儲存草稿，尚未發布。':action==='publish'?'已發布。':action==='withdraw'?'已下架。':'已回復為新的發布版本。');
    });
  }
  return <section className="company-admin" aria-label="管理公司範本" aria-busy={busy}>
    <div className="company-heading"><h2>管理公司範本</h2><button type="button" className="text-button" disabled={busy} onClick={()=>void run(async()=>{if(await mayDiscard())onClose();})}>返回</button></div>
    {message && <p className={`notice ${error?'error':'info'}`} role={error?'alert':'status'}>{message}</p>}
    <div className="company-admin-actions"><button type="button" className="button" disabled={busy} onClick={()=>void run(async()=>{if(await mayDiscard())await load();})}>重新整理</button>{editor && <button type="button" className="button" disabled={busy} onClick={()=>void run(async()=>{if(await mayDiscard())installEditor(emptyTemplate(),'',false);})}>新增範本</button>}</div>
    {state && <>
      <div className="company-list">{templateIds.map(id=>{const draft=state.drafts.find(item=>item.id===id);const live=state.published.find(item=>item.id===id);return <button type="button" className="company-choice" key={id} aria-pressed={selectedId===id} disabled={busy} onClick={()=>select(id)}><span>{(draft || live)?.name || id}</span><span>{live?(draft?'已發布・有草稿':'已發布'):draft?'草稿':'已下架'}</span></button>;})}</div>
      {!templateIds.length && <p className="empty-state">尚未建立範本。</p>}
      {edit && <>
        <form className="company-fields" onSubmit={event=>{event.preventDefault();void write('save');}}>
          <label>範本名稱<input aria-label="範本名稱" required maxLength={100} value={edit.name} disabled={busy || !editor} onChange={event=>change({name:event.target.value})} /></label>
          <details><summary>分類與權限</summary><div className="company-fields">
            <label>ID<input aria-label="範本 ID" maxLength={80} readOnly={idLocked} value={edit.id} disabled={busy || !editor} onChange={event=>change({id:event.target.value})} /></label>
            <label>分類<input aria-label="範本分類" maxLength={100} value={edit.category} disabled={busy || !editor} onChange={event=>change({category:event.target.value})} /></label>
            <label>標籤<input aria-label="範本標籤" placeholder="以逗號分隔" value={edit.tagsText} disabled={busy || !editor} onChange={event=>change({tagsText:event.target.value})} /></label>
            <label>語言<input aria-label="範本語言" maxLength={35} value={edit.language} disabled={busy || !editor} onChange={event=>change({language:event.target.value})} /></label>
            <label>適用角色（留空為全公司）<input aria-label="適用角色" placeholder="以逗號分隔" value={edit.audienceText} disabled={busy || !editor} onChange={event=>change({audienceText:event.target.value})} /></label>
          </div></details>
          <label>維護人<input aria-label="維護人" required maxLength={200} value={edit.owner} disabled={busy || !editor} onChange={event=>change({owner:event.target.value})} /></label>
          <label>主旨<input aria-label="範本主旨" maxLength={255} value={edit.subject} disabled={busy || !editor} onChange={event=>change({subject:event.target.value})} /></label>
          <div><label>內文</label><TemplateEditor value={edit.bodyHtml} disabled={busy || !editor} onChange={bodyHtml=>change({bodyHtml})} /></div>
          <label>純文字內文<textarea aria-label="範本純文字內文" rows={4} maxLength={100_000} value={edit.bodyText} disabled={busy || !editor} onChange={event=>change({bodyText:event.target.value})} /></label>
          <div className="company-heading"><h3>填寫欄位</h3><button type="button" className="text-button" disabled={busy || !editor || edit.fields.length>=40} onClick={addField}>新增欄位</button></div>
          {edit.fields.map((field,index)=><fieldset key={index} disabled={busy || !editor}><legend>{field.label || `欄位 ${index+1}`}</legend><div className="company-fields">
            <label>變數<input aria-label={`欄位 ${index+1} 變數`} maxLength={50} value={field.key} onChange={event=>changeField(index,{key:event.target.value})} /></label>
            <code>{`{{${field.key}}}`}</code>
            <label>顯示名稱<input aria-label={`欄位 ${index+1} 顯示名稱`} maxLength={100} value={field.label} onChange={event=>changeField(index,{label:event.target.value})} /></label>
            <label>類型<select aria-label={`欄位 ${index+1} 類型`} value={field.type} onChange={event=>changeField(index,{type:event.target.value as CatalogField['type'],defaultValue:''})}><option value="text">文字</option><option value="date">日期</option><option value="number">數字</option><option value="select">選單</option></select></label>
            {field.type==='select' && <label>選項（每行一項）<textarea aria-label={`欄位 ${index+1} 選項`} rows={3} value={field.optionsText} onChange={event=>changeField(index,{optionsText:event.target.value})} /></label>}
            <label>預設值{field.type==='select'?<select aria-label={`欄位 ${index+1} 預設值`} value={field.defaultValue || ''} onChange={event=>changeField(index,{defaultValue:event.target.value})}><option value="">不預填</option>{[...new Set(field.optionsText.split('\n').map(item=>item.trim()).filter(Boolean))].map(option=><option key={option} value={option}>{option}</option>)}</select>:<input aria-label={`欄位 ${index+1} 預設值`} type={field.type==='text'?'text':field.type} step={field.type==='number'?'any':undefined} maxLength={2000} value={field.defaultValue || ''} onChange={event=>changeField(index,{defaultValue:event.target.value})} />}</label>
            <label className="company-subject"><input type="checkbox" checked={field.required} onChange={event=>changeField(index,{required:event.target.checked})} /><span>必填</span></label>
            <button type="button" className="text-button" aria-label={`移除欄位 ${index+1}`} onClick={()=>change({fields:edit.fields.filter((_,i)=>i!==index)})}>移除欄位</button>
          </div></fieldset>)}
          <div className="company-admin-actions"><button type="button" className="button" disabled={busy} onClick={()=>void run(async()=>{setPreview(validateEdit(edit));})}>預覽</button><button type="submit" className="button primary" disabled={busy || !editor || !dirty}>儲存草稿</button>{dirty && <button type="button" className="text-button" disabled={busy} onClick={()=>void run(async()=>{if(await mayDiscard())installEditor(savedDraft || published || null,selectedId);})}>捨棄變更</button>}</div>
        </form>
        {dirty && <p className="company-validation" role="status">尚未儲存</p>}
        {preview && <CompanyCatalog key={JSON.stringify(preview)} catalog={{schemaVersion:1,revision:'preview',templates:[preview]}} loading={false} hostReady={false} onRefresh={async()=>{}} onApply={async()=>{}} />}
        <details><summary>JSON</summary><textarea aria-label="範本 JSON" className="company-json" readOnly value={JSON.stringify(templateValue(edit),null,2)} /></details>
      </>}
      {publisher && selectedId && <div className="company-fields">
        <div className="company-admin-actions"><button type="button" className="button primary" disabled={busy || dirty || !savedDraft} onClick={()=>void write('publish')}>發布已存草稿</button><button type="button" className="button" disabled={busy || dirty || !published} onClick={()=>void write('withdraw')}>下架</button></div>
        {!!history.length && <><label>歷史版本<select aria-label="回復版本" disabled={busy || dirty} value={rollbackVersion} onChange={event=>setRollbackVersion(event.target.value)}><option value="">選擇版本</option>{history.map(item=><option key={item.revision} value={item.version}>{new Date(item.at).toLocaleString('zh-TW')} · {item.version}</option>)}</select></label><button type="button" className="button" disabled={busy || dirty || !rollbackVersion} onClick={()=>void write('rollback')}>回復並發布</button></>}
      </div>}
      <details><summary>發布紀錄</summary><ul>{state.history.slice().reverse().map(item=><li key={item.revision}>{new Date(item.at).toLocaleString('zh-TW')} · {item.templateId} · {{save:'儲存草稿',publish:'發布',withdraw:'下架',rollback:'回復'}[item.action] || item.action}{item.version?` · ${item.version}`:''}</li>)}</ul></details>
    </>}
  </section>;
}
