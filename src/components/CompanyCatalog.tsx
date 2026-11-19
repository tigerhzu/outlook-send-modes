import { useEffect, useMemo, useState } from 'react';
import { fieldDefaults, renderCatalogTemplate, type Catalog, type CatalogTemplate, type CatalogValues } from '../catalog';
import '../company-catalog.css';

export interface CompanyCatalogProps {
  catalog: Catalog | null;
  loading: boolean;
  error?: string;
  hostReady: boolean;
  disabled?: boolean;
  previewFormat?: 'html'|'text';
  onRefresh: () => Promise<void>;
  onSignIn?: () => Promise<void>;
  onApply: (template: CatalogTemplate, values: CatalogValues, applySubject: boolean) => Promise<void>;
}

export default function CompanyCatalog({catalog, loading, error, hostReady, disabled = false, previewFormat='html', onRefresh, onSignIn, onApply}: CompanyCatalogProps) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [selected, setSelected] = useState<CatalogTemplate | null>(null);
  const [values, setValues] = useState<CatalogValues>({});
  const [applySubject, setApplySubject] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const locked = busy || loading || disabled;
  const categories = useMemo(() => [...new Set(catalog?.templates.map(template => template.category).filter(Boolean))].sort(), [catalog]);
  const filtered = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return catalog?.templates.filter(template => (!category || template.category === category) && (!search || [template.name, template.category, ...template.tags].join(' ').toLocaleLowerCase().includes(search))) || [];
  }, [catalog, query, category]);
  useEffect(() => {
    if (!selected || !catalog) return;
    const current = catalog.templates.find(template => template.id === selected.id);
    if (!current || JSON.stringify(current) !== JSON.stringify(selected)) {
      setSelected(null); setValues({}); setApplySubject(false);
      setMessage(current ? '範本已更新，請重新選擇並預覽。' : '此範本已下架或無法存取。');
    }
  }, [catalog, selected]);
  useEffect(() => { if (category && !categories.includes(category)) setCategory(''); }, [category, categories]);
  let preview: ReturnType<typeof renderCatalogTemplate> | undefined;
  let validation = '';
  if (selected) {
    try { preview = renderCatalogTemplate(selected, values); }
    catch (caught) { validation = caught instanceof Error ? caught.message : '請檢查欄位。'; }
  }
  async function run(action: () => Promise<void>) {
    if (locked) return;
    setBusy(true); setMessage('');
    try { await action(); }
    catch (caught) { setMessage(caught instanceof Error ? caught.message : '操作失敗，請重試。'); }
    finally { setBusy(false); }
  }
  return <section className="company-catalog" aria-label="公司範本" aria-busy={locked}>
    <div className="company-heading"><h2>公司範本</h2><button type="button" className="text-button" disabled={locked} onClick={() => void run(onRefresh)}>重新整理</button></div>
    {loading && <p role="status">讀取中…</p>}
    {error && <div className="notice error" role="alert">{error}</div>}
    {message && <div className="notice info" role="status">{message}</div>}
    {onSignIn && <button type="button" className="button primary" disabled={locked} onClick={() => void run(onSignIn)}>公司帳號登入</button>}
    {catalog && <>
      {selected ? <div className="company-detail">
        <button type="button" className="text-button" disabled={locked} onClick={() => {setSelected(null); setValues({}); setApplySubject(false); setMessage('');}}>← 範本列表</button>
        <div className="company-heading"><h3>{selected.name}</h3><span className="company-version">v{selected.version}</span></div>
        <form className="company-fields" onSubmit={event => event.preventDefault()}>
          {selected.fields.map(field => <label key={field.key}>
            <span>{field.label}{field.required ? ' *' : ''}</span>
            {field.type === 'select' ? <select aria-label={field.label} required={field.required} value={values[field.key] || ''} disabled={locked} onChange={event => setValues(current => ({...current, [field.key]: event.target.value}))}>
              <option value="">請選擇</option>{field.options?.map(option => <option key={option} value={option}>{option}</option>)}
            </select> : field.type === 'text' ? <textarea aria-label={field.label} required={field.required} maxLength={10_000} rows={2} value={values[field.key] || ''} disabled={locked} onChange={event => setValues(current => ({...current, [field.key]: event.target.value}))} /> : <input aria-label={field.label} required={field.required} type={field.type} step={field.type === 'number' ? 'any' : undefined} value={values[field.key] || ''} disabled={locked} onChange={event => setValues(current => ({...current, [field.key]: event.target.value}))} />}
          </label>)}
        </form>
        {validation && <p className="company-validation" role="status">{validation}</p>}
        {preview && <>
          <label className="company-subject"><input type="checkbox" checked={applySubject} disabled={locked} onChange={event => setApplySubject(event.target.checked)} /><span>套用主旨</span></label>
          {applySubject && <p className="company-subject-preview">{preview.subject || '（空白主旨）'}</p>}
          {previewFormat==='text' ? <pre className="company-preview" aria-label="純文字範本預覽" style={{whiteSpace:'pre-wrap'}}>{preview.text}</pre> : <div className="company-preview" aria-label="範本預覽" dangerouslySetInnerHTML={{__html: preview.html}} />}
        </>}
        <button type="button" className="button primary" disabled={locked || !hostReady || !preview || !!error} onClick={() => void run(() => onApply(selected, {...values}, applySubject))}>{busy ? '處理中…' : '插入草稿'}</button>
      </div> : <>
        <div className="company-filters"><input type="search" aria-label="搜尋公司範本" placeholder="搜尋範本" value={query} disabled={locked} onChange={event => setQuery(event.target.value)} /><select aria-label="篩選範本分類" value={category} disabled={locked} onChange={event => setCategory(event.target.value)}><option value="">全部分類</option>{categories.map(item => <option key={item} value={item}>{item}</option>)}</select></div>
        <div className="company-list">{filtered.map(template => <button type="button" className="company-choice" key={template.id} disabled={locked || !!error} onClick={() => {setSelected(template); setValues(fieldDefaults(template)); setApplySubject(false); setMessage('');}}><span>{template.name}</span><span aria-hidden="true">›</span></button>)}</div>
        {!filtered.length && <p className="empty-state">{catalog.templates.length ? '沒有符合的範本。' : '目前沒有已發布範本。'}</p>}
      </>}
    </>}
  </section>;
}
