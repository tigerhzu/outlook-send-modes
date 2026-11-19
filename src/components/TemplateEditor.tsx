import { useEffect, useRef, useState } from 'react';
import { sanitizeTemplate } from '../model';
import { readImageFile, sanitizeSignature } from '../signature';
import ActionMenu from './ActionMenu';
import { captureSignatureImages } from '../signature-paste';

interface Props { value: string; onChange: (html: string) => void; disabled: boolean; signature?: boolean; onBusyChange?: (busy: boolean) => void; resolveImage?: (source: string) => Promise<string> }

export default function TemplateEditor({ value, onChange, disabled, signature = false, onBusyChange, resolveImage }: Props) {
  const editor = useRef<HTMLDivElement>(null);
  const selection = useRef<Range | null>(null);
  const [source, setSource] = useState(false);
  const [notice, setNotice] = useState('');
  const [pasting, setPasting] = useState(false);
  const pasteLock = useRef(false);
  const imageInput = useRef<HTMLInputElement>(null);
  const blocked = disabled || pasting;

  useEffect(() => {
    const element = editor.current;
    if (element && element.innerHTML !== value) element.innerHTML = signature ? sanitizeSignature(value) : sanitizeTemplate(value);
  }, [value, source, signature]);

  useEffect(() => {
    const remember = () => {
      const active = window.getSelection();
      if (active?.rangeCount && editor.current?.contains(active.anchorNode)) {
        selection.current = active.getRangeAt(0).cloneRange();
      }
    };
    document.addEventListener('selectionchange', remember);
    return () => document.removeEventListener('selectionchange', remember);
  }, []);

  function restoreSelection() {
    editor.current?.focus();
    const active = window.getSelection();
    if (active && selection.current && editor.current?.contains(selection.current.commonAncestorContainer)) {
      active.removeAllRanges();
      active.addRange(selection.current);
    }
  }

  function update() {
    if (editor.current) onChange(editor.current.innerHTML);
    setNotice('');
  }

  function format(command: string, argument?: string) {
    restoreSelection();
    document.execCommand(command, false, argument);
    update();
  }

  async function pasteSignature(html: string, plain: string, files: File[]) {
    if (disabled || pasteLock.current) return;
    pasteLock.current = true; setPasting(true); onBusyChange?.(true); setNotice('');
    try {
      let inserted = '';
      if (html) {
        inserted = await captureSignatureImages(html,resolveImage,files);
      } else if (files.length) {
        const doc = document.implementation.createHTMLDocument();
        for (const file of files) {
          const img = doc.createElement('img'); img.src = await readImageFile(file); img.alt = file.name;
          doc.body.appendChild(img);
        }
        inserted = sanitizeSignature(doc.body.innerHTML);
      }
      // Check the total before changing the editor, not just the pasted fragment.
      if (inserted) sanitizeSignature((editor.current?.innerHTML || '') + inserted);
      // Re-enable contenteditable before execCommand inserts the resolved image data.
      if (editor.current) editor.current.contentEditable = 'true';
      if (inserted) format('insertHTML',inserted);
      else if (plain) format('insertText',plain);
    } catch (error) { setNotice(error instanceof Error ? error.message : '無法貼上簽章。'); }
    finally { pasteLock.current = false; setPasting(false); onBusyChange?.(false); }
  }

  function selectedCell(): HTMLTableCellElement | null {
    restoreSelection();
    const anchor = window.getSelection()?.anchorNode;
    const element = anchor instanceof Element ? anchor : anchor?.parentElement;
    const cell = element?.closest('td, th') as HTMLTableCellElement | null;
    if (!cell || !editor.current?.contains(cell)) {
      setNotice('請先點選表格內的儲存格。');
      return null;
    }
    return cell;
  }

  function tableAction(action: 'row' | 'column' | 'remove') {
    const cell = selectedCell();
    if (!cell) return;
    const table = cell.closest('table');
    const row = cell.parentElement as HTMLTableRowElement | null;
    if (!table || !row) return;
    if (action === 'remove') table.remove();
    if (action === 'row') {
      const newRow = table.insertRow(row.rowIndex + 1);
      for (let index = 0; index < row.cells.length; index++) {
        const added = newRow.insertCell();
        added.setAttribute('style', 'border:1px solid #aab2bd;padding:8px;vertical-align:top');
        added.innerHTML = '&nbsp;';
      }
    }
    if (action === 'column') {
      const index = cell.cellIndex + 1;
      const group = table.querySelector(':scope > colgroup');
      if (group) group.insertBefore(document.createElement('col'), group.children[index] || null);
      Array.from(table.rows).forEach((current) => {
        const added = current.insertCell(Math.min(index, current.cells.length));
        added.setAttribute('style', 'border:1px solid #aab2bd;padding:8px;vertical-align:top');
        added.innerHTML = '&nbsp;';
      });
    }
    selection.current = null;
    update();
  }

  function insertTable() {
    const cell = 'style="border:1px solid #aab2bd;padding:8px;vertical-align:top"';
    format('insertHTML', `<table style="border-collapse:collapse;width:100%;table-layout:fixed"><tbody><tr><th ${cell}>欄位</th><th ${cell}>內容</th></tr><tr><td ${cell}>&nbsp;</td><td ${cell}>&nbsp;</td></tr><tr><td ${cell}>&nbsp;</td><td ${cell}>&nbsp;</td></tr></tbody></table><p><br></p>`);
  }

  return <section className="template-section">
    <label id="body-label" className="visually-hidden">{signature ? '簽章內容' : '內文'}</label>
    {source && <div className="source-actions"><button type="button" className="text-button" disabled={disabled} onClick={()=>{setSource(false);setNotice('');}}>編輯</button></div>}
    {source ? <textarea className="source-editor" aria-label="內文 HTML 原始碼" value={value} disabled={disabled} spellCheck={false} onChange={(event) => onChange(event.target.value)} /> : <>
      <div className="editor-toolbar" role="toolbar" aria-label="文字格式" inert={blocked}>
        <button type="button" aria-label="粗體" title="粗體" disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => format('bold')}><b>B</b></button>
        <button type="button" aria-label="斜體" title="斜體" disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => format('italic')}><i>I</i></button>
        <button type="button" aria-label="底線" title="底線" disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => format('underline')}><u>U</u></button>
        {signature && <button type="button" disabled={blocked} onMouseDown={(event) => event.preventDefault()} onClick={() => imageInput.current?.click()}>圖片</button>}
        <ActionMenu label="更多格式" disabled={blocked}>
          <button type="button" aria-label="項目符號" onMouseDown={event=>event.preventDefault()} onClick={()=>format('insertUnorderedList')}>條列</button>
          <button type="button" onMouseDown={event=>event.preventDefault()} onClick={insertTable}>插入表格</button>
          <button type="button" onMouseDown={event=>event.preventDefault()} onClick={()=>tableAction('row')}>加列</button>
          <button type="button" onMouseDown={event=>event.preventDefault()} onClick={()=>tableAction('column')}>加欄</button>
          <button type="button" onMouseDown={event=>event.preventDefault()} onClick={()=>tableAction('remove')}>刪表</button>
          {!signature && <button type="button" onClick={()=>{setSource(true);setNotice('');}}>HTML</button>}
        </ActionMenu>
      </div>
      {signature && <input ref={imageInput} className="visually-hidden" type="file" accept="image/png,image/jpeg,image/gif,image/webp" aria-label="簽章圖片" multiple tabIndex={-1} disabled={blocked} onChange={event=>{ const files = Array.from(event.target.files || []); void pasteSignature('','',files); event.target.value = ''; }} />}
      <div ref={editor} className="body-editor" data-placeholder={signature ? '將簽章貼在這裡' : '輸入內文'} contentEditable={!blocked} role="textbox" aria-multiline="true" aria-labelledby="body-label" aria-disabled={blocked} suppressContentEditableWarning onInput={update} onDrop={(event) => {
        event.preventDefault();
        if (blocked) return;
        const html = event.dataTransfer.getData('text/html');
        const plain = event.dataTransfer.getData('text/plain');
        if (signature) void pasteSignature(html,plain,Array.from(event.dataTransfer.files).filter(file=>file.type.startsWith('image/')));
        else if (html) format('insertHTML', sanitizeTemplate(html));
        else if (plain) format('insertText', plain);
      }} onPaste={(event) => {
        event.preventDefault();
        if (blocked) return;
        const html = event.clipboardData.getData('text/html');
        if (signature) void pasteSignature(html,event.clipboardData.getData('text/plain'),Array.from(event.clipboardData.files).filter(file=>file.type.startsWith('image/')));
        else if (html) format('insertHTML', sanitizeTemplate(html));
        else format('insertText', event.clipboardData.getData('text/plain'));
      }} />
    </>}
    {pasting && <p className="field-note" role="status">正在貼上…</p>}
    {notice && <p className="field-note" role="alert">{notice}</p>}
  </section>;
}
