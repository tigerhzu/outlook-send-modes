import { useEffect, useRef, useState, type ReactNode } from 'react';

/** Ordinary buttons in a disclosure; keep native Tab navigation. */
export default function ActionMenu({ label, disabled, children, symbol = '⋯' }: { label: string; disabled?: boolean; children: ReactNode; symbol?: string }) {
  const [open,setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); setOpen(false); trigger.current?.focus(); } };
    document.addEventListener('pointerdown',outside);
    document.addEventListener('keydown',escape);
    return ()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};
  },[open]);
  useEffect(()=>{ if (disabled) setOpen(false); },[disabled]);
  return <div className="action-menu" ref={root} onBlur={event=>{if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);}}>
    <button type="button" ref={trigger} className="plain-icon" aria-label={label} title={label} aria-expanded={open} disabled={disabled} onMouseDown={event=>event.preventDefault()} onClick={()=>setOpen(!open)}>{symbol}</button>
    {open && <div className="action-menu-panel" onClick={event=>{if ((event.target as Element).closest('button')) {setOpen(false);trigger.current?.focus();}}}>{children}</div>}
  </div>;
}
