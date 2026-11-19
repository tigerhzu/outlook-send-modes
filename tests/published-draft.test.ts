import { describe,it,expect,vi } from 'vitest';
import { ApplyController } from '../src/draft';
import { FakeDraft } from './fake-draft';
import type { Mode, Settings } from '../src/types';

const mode:Mode={id:'published:service',name:'服務通知',to:[],cc:[],subject:'新主旨',bodyHtml:'<p>公司範本</p>'};
const settings:Settings={version:2,presetRevision:1,modes:[]};
const defaults={preserveRecipients:true,preserveSubject:true};
function draft(){const port=new FakeDraft();port.data={to:[{displayName:'To',emailAddress:'to@example.test'}],cc:[{displayName:'CC',emailAddress:'cc@example.test'}],subject:'原主旨',bodyHtml:'<p>既有內容</p><p>簽名</p><blockquote>回覆歷史</blockquote>',bodyType:'html'};return port;}

describe('published company templates (Office mock)',()=>{
  it('does not write recipients or subject and keeps outside content',async()=>{
    const port=draft();const before=structuredClone(port.data);const verify=vi.fn(async()=>{});
    const result=await new ApplyController().apply(mode,settings,port,async()=>true,{...defaults,beforeWrite:verify});
    expect(result.status).toBe('success');expect(port.data.to).toEqual(before.to);expect(port.data.cc).toEqual(before.cc);expect(port.data.subject).toBe(before.subject);
    expect(port.data.bodyHtml.endsWith(before.bodyHtml)).toBe(true);expect(port.writes).not.toContain('to');expect(port.writes).not.toContain('cc');expect(port.writes).not.toContain('subject');expect(verify).toHaveBeenCalledOnce();
  });
  it('permits a blank draft recipient list without adding any recipient',async()=>{
    const port=new FakeDraft();expect((await new ApplyController().apply(mode,settings,port,async()=>true,defaults)).status).toBe('success');expect(port.data.to).toEqual([]);
  });
  it('only replaces subject when opted in and confirmed',async()=>{
    const port=draft();const confirm=vi.fn(async()=>false);
    expect((await new ApplyController().apply(mode,settings,port,confirm,{...defaults,preserveSubject:false})).status).toBe('cancelled');expect(port.writes).toEqual([]);expect(confirm.mock.calls[0]).toBeDefined();
    expect((await new ApplyController().apply(mode,settings,port,async()=>true,{...defaults,preserveSubject:false})).status).toBe('success');expect(port.data.subject).toBe('新主旨');expect(port.writes).not.toContain('to');
  });
  it('checks publication after confirmation and stops before the journal on withdrawn content',async()=>{
    const port=draft();let confirmed=false;
    const result=await new ApplyController().apply(mode,settings,port,async()=>{confirmed=true;return true;},{...defaults,preserveSubject:false,beforeWrite:async()=>{expect(confirmed).toBe(true);throw new Error('已下架');}});
    expect(result.status).toBe('error');expect(result.message).toContain('已下架');expect(port.writes).toEqual([]);
  });
  it('checks draft identity and edits again after publication fetch',async()=>{
    const port=draft();const result=await new ApplyController().apply(mode,settings,port,async()=>true,{...defaults,beforeWrite:async()=>{port.current=false;}});
    expect(result.status).toBe('error');expect(port.writes).toEqual([]);
  });
  it('refuses a different body format than the preview without writing',async()=>{
    const port=draft();
    const result=await new ApplyController().apply(mode,settings,port,async()=>true,{...defaults,expectedBodyType:'text',plainText:'文字版本'});
    expect(result.status).toBe('error');expect(result.message).toContain('郵件格式已變更');expect(port.writes).toEqual([]);
  });
  it('uses plain text only, preserving the existing text and stopping repeat insertion',async()=>{
    const port=draft();port.data={...port.data,bodyHtml:'',bodyType:'text',bodyText:'簽名\n歷史'};
    const prependText=vi.fn(async(text:string)=>{port.data.bodyText=text+port.data.bodyText;});
    const textPort=Object.assign(port,{prependText});const controller=new ApplyController();
    const result=await controller.apply(mode,settings,textPort,async()=>true,{...defaults,plainText:'公司 <範本>'});
    expect(result.status).toBe('success');expect(port.data.bodyText).toBe('公司 <範本>\r\n\r\n簽名\n歷史');expect(port.writes).not.toContain('body');expect(port.writes).not.toContain('subject');
    expect((await controller.apply(mode,settings,textPort,async()=>true,{...defaults,plainText:'公司 <範本>'})).status).toBe('error');expect(prependText).toHaveBeenCalledOnce();
  });
  it('quarantines ambiguous plain text insertion by retaining prepared journal',async()=>{
    const port=draft();port.data={...port.data,bodyHtml:'',bodyType:'text',bodyText:'簽名'};
    const prependText=vi.fn(async()=>{throw new Error('timeout');});const textPort=Object.assign(port,{prependText});const controller=new ApplyController();
    expect((await controller.apply(mode,settings,textPort,async()=>true,{...defaults,plainText:'範本'})).status).toBe('partial');expect(port.state?.phase).toBe('prepared');
    expect((await controller.apply(mode,settings,textPort,async()=>true,{...defaults,plainText:'範本'})).status).toBe('error');expect(prependText).toHaveBeenCalledOnce();
  });
});
