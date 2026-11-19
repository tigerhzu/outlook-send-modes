import { beforeEach,describe,expect,it,vi } from 'vitest';
import { ApplyController } from '../src/draft';
import { sampleSettings as defaultSettings } from './sample-settings';
import type { ConfirmApply, Settings } from '../src/types';
import { FakeDraft,clone } from './fake-draft';

let settings:Settings;
let port:FakeDraft;
let controller:ApplyController;
beforeEach(()=>{settings=defaultSettings();settings.modes[0].to=['johnny@example.test'];settings.modes[0].cc=['purple@example.test'];settings.modes[1].to=['hank@example.test'];settings.modes[1].cc=['johnny@example.test','purple@example.test'];port=new FakeDraft();controller=new ApplyController();});
const yes=async()=>true;

describe('draft application through a fake Office port (not real Outlook)',()=>{
  it.each(['prefix','class-only'])('completes fields and safely reapplies after host normalization: %s',async(kind)=>{
    const outside='<p>existing</p><div><img src="cid:logo">signature</div><blockquote>history</blockquote>';
    port.data.bodyHtml=outside;
    port.afterWrite=(field,p)=>{
      if(field!=='prepend' && field!=='body') return;
      if(kind==='class-only') p.data.bodyHtml=p.data.bodyHtml.replace(/ id="send-mode-[^"]+"/g,'');
      p.data.bodyHtml=p.data.bodyHtml.replace(/(id|class)="((?:x_)*send-mode-[^"]+)"/g,'$1="x_$2"');
    };
    expect((await controller.apply(settings.modes[0],settings,port,yes)).status).toBe('success');
    expect(port.data.to.map(r=>r.emailAddress)).toEqual(['johnny@example.test']);
    expect(port.data.cc.map(r=>r.emailAddress)).toEqual(['purple@example.test']);
    expect(port.data.subject).toBe('加班申請');
    port.data.bodyHtml=port.data.bodyHtml.replace('&nbsp;','filled work');
    const filled=port.data.bodyHtml;
    expect((await new ApplyController().apply(settings.modes[0],settings,port,yes)).status).toBe('noop');
    expect(port.data.bodyHtml).toBe(filled);
    expect((await controller.apply(settings.modes[1],settings,port,async()=>false)).status).toBe('cancelled');
    expect(port.data.bodyHtml).toBe(filled);
    expect((await controller.apply(settings.modes[1],settings,port,yes)).status).toBe('success');
    expect(port.data.bodyHtml.match(/<table/g)).toHaveLength(1);
    expect(port.data.bodyHtml.endsWith(outside)).toBe(true);
    expect(port.data.to.map(r=>r.emailAddress)).toEqual(['hank@example.test']);
    expect(port.data.cc.map(r=>r.emailAddress)).toEqual(['johnny@example.test','purple@example.test']);
  });
  it('fills an empty draft with Johnny, Purple and editable overtime cells without a prompt or send',async()=>{
    const confirm=vi.fn<ConfirmApply>(yes);const result=await controller.apply(settings.modes[0],settings,port,confirm);
    expect(result.status).toBe('success');expect(confirm).not.toHaveBeenCalled();
    expect(port.data.to.map(r=>r.emailAddress)).toEqual(['johnny@example.test']);
    expect(port.data.cc.map(r=>r.emailAddress)).toEqual(['purple@example.test']);
    expect(port.data.subject).toBe('加班申請');expect(port.data.bodyHtml).toContain('<table');
    expect(port.writes).toEqual(['state','prepend','state','to','cc','subject']);
    expect(port.state?.phase).toBe('applied');expect('send' in port).toBe(false);
  });
  it('prepends without altering existing signature, inline images, typed content or reply history',async()=>{
    const existing='<p>已寫內容</p><p id="signature"><img src="cid:logo">簽名</p><blockquote>原始回覆</blockquote>';
    port.data.bodyHtml=existing;
    expect((await controller.apply(settings.modes[0],settings,port,yes)).status).toBe('success');
    expect(port.data.bodyHtml.endsWith(existing)).toBe(true);expect(port.writes).not.toContain('body');
  });
  it('blocks incomplete addresses before touching the draft',async()=>{
    settings.modes[0].to=[''];
    const result=await controller.apply(settings.modes[0],settings,port,yes);
    expect(result.status).toBe('error');expect(result.message).toContain('To');expect(port.writes).toEqual([]);
  });
  it('identifies all non-empty fields at risk and cancellation makes no mutations',async()=>{
    port.data.to=[{displayName:'Old To',emailAddress:'old@example.test'}];
    port.data.cc=[{displayName:'Old CC',emailAddress:'cc@example.test'}];port.data.subject='Existing subject';
    const original=clone(port.data);const confirm=vi.fn<ConfirmApply>(async()=>false);
    const result=await controller.apply(settings.modes[0],settings,port,confirm);
    expect(result.status).toBe('cancelled');expect(confirm.mock.calls[0][0].changes).toHaveLength(3);
    expect(port.data).toEqual(original);expect(port.writes).toEqual([]);
  });
  it('repeated application preserves filled cells and does not stack tables, even after reopening the pane',async()=>{
    await controller.apply(settings.modes[0],settings,port,yes);
    port.data.bodyHtml=port.data.bodyHtml.replace('&nbsp;','2026-11-13');
    const filled=port.data.bodyHtml;port.writes=[];
    const result=await new ApplyController().apply(settings.modes[0],settings,port,yes);
    expect(result.status).toBe('noop');expect(port.data.bodyHtml).toBe(filled);expect(port.writes).toEqual([]);
    expect(port.data.bodyHtml.match(/<table/g)).toHaveLength(1);
  });
  it('switching to remote confirms loss of filled template data and replaces only that block plus full recipient lists',async()=>{
    const existing='<p>existing</p><div class="signature">Signature</div><blockquote>History</blockquote>';
    port.data.bodyHtml=existing;await controller.apply(settings.modes[0],settings,port,yes);
    port.data.bodyHtml=port.data.bodyHtml.replace('&nbsp;','2026-11-13');
    const confirm=vi.fn<ConfirmApply>(yes);const result=await controller.apply(settings.modes[1],settings,port,confirm);
    expect(result.status).toBe('success');expect(confirm.mock.calls[0][0].changes.some(x=>x.includes('模板'))).toBe(true);
    expect(confirm.mock.calls[0][0].previousTemplateText).toContain('2026-11-13');
    expect(port.data.bodyHtml.endsWith(existing)).toBe(true);expect(port.data.bodyHtml.match(/<table/g)).toHaveLength(1);
    expect(port.data.to.map(r=>r.emailAddress)).toEqual(['hank@example.test']);
    expect(port.data.cc.map(r=>r.emailAddress)).toEqual(['johnny@example.test','purple@example.test']);
    expect(port.data.subject).toBe('居家辦公申請');expect(port.data.bodyHtml).toContain('聯絡方式');
  });
  it('finishes To, CC and subject when Outlook normalizes HTML after saving the new body state',async()=>{
    await controller.apply(settings.modes[0],settings,port,yes);
    const saveState=port.saveState.bind(port);
    vi.spyOn(port,'saveState').mockImplementation(async state=>{
      await saveState(state);
      if(state.phase==='applied') port.data.bodyHtml=port.data.bodyHtml.replace(/ (id|class)="(send-mode-[^"]+)"/g,' $1="x_$2"')+'<!-- Outlook normalization -->';
    });
    port.afterWrite=(field,p)=>{if(field==='to' || field==='cc')p.data.bodyHtml+='<!-- host save -->';};
    const result=await controller.apply(settings.modes[1],settings,port,yes);
    expect(result.status).toBe('success');
    expect(port.data.to.map(person=>person.emailAddress)).toEqual(settings.modes[1].to);
    expect(port.data.cc.map(person=>person.emailAddress)).toEqual(settings.modes[1].cc);
    expect(port.data.subject).toBe(settings.modes[1].subject);
    expect(port.writes.filter(field=>field==='prepend')).toHaveLength(1);
  });
  it.each(['body','state'])('verifies signature bytes when Outlook reassigns CIDs after %s writes',async moment=>{
    port.data.bodyHtml='<p><img src="cid:original" alt="logo">Signature</p>';
    const readInlineImage=vi.fn(async(source:string)=>{
      // Old CID becomes unreadable after Outlook changes it. Its identity must
      // already have been captured before the body write.
      if(source==='cid:original' && port.data.bodyHtml.includes('cid:reassigned')) throw new Error('Old attachment no longer exists');
      return 'data:image/png;base64,c2FtZS1sb2dv';
    });
    Object.assign(port,{readInlineImage});
    await controller.apply(settings.modes[0],settings,port,yes);
    const saveState=port.saveState.bind(port);
    vi.spyOn(port,'saveState').mockImplementation(async state=>{await saveState(state);if(moment==='state' && state.phase==='applied')port.data.bodyHtml=port.data.bodyHtml.replace('cid:original','cid:reassigned');});
    port.afterWrite=(field,p)=>{if(moment==='body' && field==='body')p.data.bodyHtml=p.data.bodyHtml.replace('cid:original','cid:reassigned');};
    const result=await controller.apply(settings.modes[1],settings,port,yes);
    expect(result.status).toBe('success');
    expect(port.data.to.map(person=>person.emailAddress)).toEqual(settings.modes[1].to);
    expect(port.data.cc.map(person=>person.emailAddress)).toEqual(settings.modes[1].cc);
    expect(port.data.subject).toBe(settings.modes[1].subject);
    expect(port.data.bodyHtml).toContain('cid:reassigned');
    expect(readInlineImage).toHaveBeenCalledWith('cid:original');
    expect(readInlineImage).toHaveBeenCalledWith('cid:reassigned');
  });
  it.each(['different-bytes','unreadable'])('still stops when changed signature CIDs cannot be verified: %s',async kind=>{
    port.data.bodyHtml='<p><img src="cid:original">Signature</p>';
    Object.assign(port,{readInlineImage:async(source:string)=>{
      if(source==='cid:changed' && kind==='unreadable')throw new Error('Attachment unavailable');
      return source==='cid:original'?'data:image/png;base64,bG9nbw==':'data:image/png;base64,ZGlmZmVyZW50';
    }});
    await controller.apply(settings.modes[0],settings,port,yes);port.writes=[];
    port.afterWrite=(field,p)=>{if(field==='body')p.data.bodyHtml=p.data.bodyHtml.replace('cid:original','cid:changed');};
    expect((await controller.apply(settings.modes[1],settings,port,yes)).status).toBe('partial');
    expect(port.writes).not.toContain('to');expect(port.writes).not.toContain('cc');
  });
  it.each(['typed-text','signature-image','signature-link','removed-marker','duplicate-marker','moved-content'])('still stops recipient writes after real body changes: %s',async kind=>{
    port.data.bodyHtml='<p><img src="cid:logo"><a href="https://original.test">Signature</a></p>';
    await controller.apply(settings.modes[0],settings,port,yes);
    port.writes=[];
    const saveState=port.saveState.bind(port);
    vi.spyOn(port,'saveState').mockImplementation(async state=>{
      await saveState(state);
      if(state.phase!=='applied') return;
      if(kind==='typed-text') port.data.bodyHtml=port.data.bodyHtml.replace('&nbsp;','New user text');
      if(kind==='signature-image') port.data.bodyHtml=port.data.bodyHtml.replace('cid:logo','cid:changed');
      if(kind==='signature-link') port.data.bodyHtml=port.data.bodyHtml.replace('https://original.test','https://changed.test');
      if(kind==='removed-marker') port.data.bodyHtml=port.data.bodyHtml.replace(/ (?:id|class)="send-mode-[^"]+"/g,'');
      if(kind==='duplicate-marker') port.data.bodyHtml+=`<div id="${state.token}">duplicate</div>`;
      if(kind==='moved-content') port.data.bodyHtml=port.data.bodyHtml.replace('Signature','').replace('</div>','Signature</div>');
    });
    expect((await controller.apply(settings.modes[1],settings,port,yes)).status).toBe('partial');
    expect(port.writes).not.toContain('to');expect(port.writes).not.toContain('cc');
  });
  it('keeps raw HTML checks before replacement so stale source offsets are never reused',async()=>{
    await controller.apply(settings.modes[0],settings,port,yes);port.writes=[];
    const result=await controller.apply(settings.modes[1],settings,port,async()=>{port.data.bodyHtml='<!-- new prefix -->'+port.data.bodyHtml;return true;});
    expect(result.status).toBe('error');expect(port.writes).toEqual([]);
  });
  it('retries incomplete recipient updates without replacing text filled into the applied body',async()=>{
    await controller.apply(settings.modes[0],settings,port,yes);
    port.fail='to';
    expect((await controller.apply(settings.modes[1],settings,port,yes)).status).toBe('partial');
    port.fail=undefined;port.writes=[];
    port.data.bodyHtml=port.data.bodyHtml.replace('&nbsp;','Keep my completed details');
    port.afterWrite=(field,p)=>{if(field==='to')p.data.bodyHtml+='<!-- Outlook save -->';};
    expect((await controller.apply(settings.modes[1],settings,port,yes)).status).toBe('success');
    expect(port.writes).toEqual(['to','cc','subject']);
    expect(port.data.bodyHtml).toContain('Keep my completed details');
  });
  it('canceling a switch keeps all user-filled data and the original mode',async()=>{
    await controller.apply(settings.modes[0],settings,port,yes);port.data.bodyHtml=port.data.bodyHtml.replace('&nbsp;','user notes');
    const original=clone(port.data);const writes=port.writes.length;
    expect((await controller.apply(settings.modes[1],settings,port,async()=>false)).status).toBe('cancelled');
    expect(port.data).toEqual(original);expect(port.writes).toHaveLength(writes);
  });
  it('manual draft edits never change the persisted mode object',async()=>{
    const original=clone(settings);await controller.apply(settings.modes[0],settings,port,yes);
    port.data.to=[];port.data.cc=[];port.data.subject='manual';port.data.bodyHtml='manual';
    expect(settings).toEqual(original);
  });
  it('saved template changes require confirmation before replacing a previously filled version',async()=>{
    await controller.apply(settings.modes[0],settings,port,yes);settings.modes[0].bodyHtml='<p>Revised template</p>';
    const confirm=vi.fn<ConfirmApply>(async()=>false);const before=port.data.bodyHtml;
    expect((await controller.apply(settings.modes[0],settings,port,confirm)).status).toBe('cancelled');
    expect(confirm.mock.calls[0][0].changes.some(x=>x.includes('模板'))).toBe(true);expect(port.data.bodyHtml).toBe(before);
  });
  it('fails closed when a persisted marker is removed instead of duplicating content',async()=>{
    await controller.apply(settings.modes[0],settings,port,yes);
    port.data.bodyHtml=port.data.bodyHtml.replace(/ (?:id|class)="send-mode-[^"]+"/g,'');port.writes=[];
    const body=port.data.bodyHtml;const result=await controller.apply(settings.modes[1],settings,port,yes);
    expect(result.status).toBe('error');expect(result.message).toContain('標記');expect(port.writes).toEqual([]);expect(port.data.bodyHtml).toBe(body);
  });
  it('reports partial failure and retains completed changes if CC rejects after body and To succeed',async()=>{
    port.fail='cc';const result=await controller.apply(settings.modes[0],settings,port,yes);
    expect(result.status).toBe('partial');expect(result.completed).toEqual(['內文','To 收件者']);
    expect(result.failed).toBe('CC 副本');expect(result.message).toContain('沒有寄出');
    expect(port.data.bodyHtml).toContain('<table');expect(port.data.to).toHaveLength(1);expect(port.data.subject).toBe('');
    port.fail=undefined;
    expect((await controller.apply(settings.modes[0],settings,port,yes)).status).toBe('success');
    expect(port.data.bodyHtml.match(/<table/g)).toHaveLength(1);
  });
  it('read-back mismatch is never reported as successful',async()=>{
    port.afterWrite=(field,p)=>{if(field==='to')p.data.to=[];};
    const result=await controller.apply(settings.modes[0],settings,port,yes);
    expect(result.status).toBe('partial');expect(result.message).toContain('回讀結果');expect(port.writes).not.toContain('cc');
  });
  it('does not report success if the host drops existing signature text or inline images',async()=>{
    port.data.bodyHtml='<p id="signature"><img src="cid:company-logo">Keep my signature</p>';
    port.afterWrite=(field,p)=>{if(field==='prepend')p.data.bodyHtml=p.data.bodyHtml.replace('<p id="signature"><img src="cid:company-logo">Keep my signature</p>','');};
    const result=await controller.apply(settings.modes[0],settings,port,yes);
    expect(result.status).toBe('partial');expect(result.completed).not.toContain('To 收件者');
    expect(port.writes).not.toContain('to');
  });
  it('stops when the user types while a confirmation dialog is open',async()=>{
    port.data.subject='original';const result=await controller.apply(settings.modes[0],settings,port,async()=>{port.data.bodyHtml='<p>typed during confirmation</p>';return true;});
    expect(result.status).toBe('error');expect(result.message).toContain('被修改');expect(port.writes).toEqual([]);
  });
  it('stops remaining writes when another field changes during a host write',async()=>{
    port.afterWrite=(field,p)=>{if(field==='to')p.data.subject='user typing';};
    const result=await controller.apply(settings.modes[0],settings,port,yes);
    expect(result.status).toBe('partial');expect(port.data.subject).toBe('user typing');expect(port.writes).not.toContain('cc');
  });
  it('serializes duplicate clicks so only one template gets inserted',async()=>{
    const first=controller.apply(settings.modes[0],settings,port,yes);
    const second=controller.apply(settings.modes[0],settings,port,yes);
    expect((await second).status).toBe('error');expect((await first).status).toBe('success');
    expect(port.writes.filter(x=>x==='prepend')).toHaveLength(1);
  });
  it('rejects plain text drafts without partial field changes',async()=>{
    port.data.bodyType='text';const result=await controller.apply(settings.modes[0],settings,port,yes);
    expect(result.status).toBe('error');expect(result.message).toContain('HTML');expect(port.writes).toEqual([]);
  });
  it('aborts after item change while waiting for confirmation',async()=>{
    port.data.subject='existing';const result=await controller.apply(settings.modes[0],settings,port,async()=>{port.current=false;return true;});
    expect(result.status).toBe('error');expect(result.message).toContain('草稿已切換');expect(port.writes).toEqual([]);
  });
});

