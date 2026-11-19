import { sampleSettings as defaultSettings } from './sample-settings';
import { describe,expect,it } from 'vitest';
import { missingRecipients,resolveRecipients,sanitizeTemplate,splitEmails,validateSettings } from '../src/model';

export function legacySettings() {
  const current=defaultSettings();
  return {version:1,contacts:[{id:'a',name:'A',email:'a@example.test'},{id:'b',name:'B',email:'b@example.test'}],modes:current.modes.map(m=>({...m,to:['a'],cc:['b']})),signatureHtml:'<p>Saved signature</p>'};
}
describe('settings and direct recipient rules',()=>{
  it('accepts saved user modes with empty addresses and editable blank tables',()=>{
    const s=defaultSettings();
    expect(s.version).toBe(2);expect(s).not.toHaveProperty('contacts');
    expect(s.modes.map(m=>[m.name,m.to,m.cc,m.subject])).toEqual([
      ['加班',[],[],'加班申請'],['居家',[],[],'居家辦公申請'],
    ]);
    for (const [i,labels] of [[0,['加班日期','開始時間','結束時間','加班時數','工作內容／原因']],[1,['申請日期','工作內容','聯絡方式']]] as const) {
      const doc=new DOMParser().parseFromString(s.modes[i].bodyHtml,'text/html');
      expect([...doc.querySelectorAll('th')].map(el=>el.textContent)).toEqual(labels);
      expect([...doc.querySelectorAll('td')].every(el=>!el.textContent?.trim())).toBe(true);
    }
  });
  it('accepts pasted separators and rejects names or invalid addresses',()=>{
    expect(splitEmails(' a@example.test; b@example.test，c@example.test\nd@example.test； ')).toEqual(['a@example.test','b@example.test','c@example.test','d@example.test']);
    const s=defaultSettings();
    expect(missingRecipients(s.modes[0])).toEqual(['To']);
    for(const email of ['Johnny','a@','a@example.test b@example.test','Name <a@example.test>']) {
      s.modes[0].to=[email];
      expect(()=>validateSettings(s)).toThrow(/To Email/);
      expect(()=>resolveRecipients(s.modes[0])).toThrow(/To/);
    }
  });
  it('deduplicates case-insensitively with To winning and keeps modes independent',()=>{
    const s=defaultSettings();
    s.modes[0].to=[' a@example.test ','A@EXAMPLE.TEST','extra@example.test'];s.modes[0].cc=['A@example.test','b@example.test','b@example.test'];
    const validated=validateSettings(s);
    expect(validated.modes[0].to).toEqual(['a@example.test','extra@example.test']);
    expect(resolveRecipients(validated.modes[0])).toEqual({to:[{displayName:'a@example.test',emailAddress:'a@example.test'},{displayName:'extra@example.test',emailAddress:'extra@example.test'}],cc:[{displayName:'b@example.test',emailAddress:'b@example.test'}]});
    expect(validated.modes[1].to).toEqual([]);
  });
  it('migrates legacy references without changing mode identity, content or signature',()=>{
    const old=legacySettings(); const migrated=validateSettings(old);
    expect(migrated.version).toBe(2);expect(migrated).not.toHaveProperty('contacts');
    expect(migrated.modes[0]).toEqual({...old.modes[0],to:['a@example.test'],cc:['b@example.test'],bodyHtml:sanitizeTemplate(old.modes[0].bodyHtml)});
    expect(migrated.signatureHtml).toBe(old.signatureHtml);
    expect(validateSettings(JSON.parse(JSON.stringify(migrated)))).toEqual(migrated);
    expect(old.modes[0].to).toEqual(['a']);
  });
  it('does not silently drop blank legacy CC or accept dangling IDs',()=>{
    const old=legacySettings();old.contacts[1].email='';
    const migrated=validateSettings(old);
    expect(migrated.modes[0].cc).toEqual(['']);
    expect(missingRecipients(migrated.modes[0])).toEqual(['CC']);
    expect(()=>resolveRecipients(migrated.modes[0])).toThrow(/CC/);
    expect(validateSettings(migrated).modes[0].cc).toEqual(['']);
    old.modes[0].cc=['missing'];expect(()=>validateSettings(old)).toThrow(/清單/);
    const duplicate=legacySettings();duplicate.contacts.push({...duplicate.contacts[0]});expect(()=>validateSettings(duplicate)).toThrow(/識別碼/);
  });
  it('allows empty saved configurations, rejects unknown versions and excessive lists',()=>{
    expect(validateSettings(defaultSettings()).modes[0].to).toEqual([]);
    expect(()=>validateSettings({version:99,modes:[]})).toThrow(/版本/);
    const s=defaultSettings();s.modes[0].to=Array(101).fill('a@example.test');
    expect(()=>validateSettings(s)).toThrow(/100/);
  });
});

describe('template sanitization',()=>{
  it('keeps basic formatting and editable table structure, removes executable and external content',()=>{
    const html=sanitizeTemplate('<script>alert(1)</script><p onclick="evil()"><b>bold</b><i>italic</i><u>under</u></p><img src="https://tracker.test/a"><iframe src="evil"></iframe><table><tr><td colspan="2" style="color:red;background-image:url(https://tracker.test/b);position:fixed">cell</td></tr></table>');
    expect(html).toContain('<b>bold</b>');expect(html).toContain('<i>italic</i>');expect(html).toContain('<u>under</u>');
    expect(html).toContain('colspan="2"');expect(html).toContain('color:');
    expect(html).not.toMatch(/script|onclick|img|iframe|url\(|position:/i);
  });
  it('cannot import the managed block id into a user template',()=>{
    expect(sanitizeTemplate('<div id="send-mode-forged" data-token="fake">safe</div>')).toBe('<div>safe</div>');
  });
});

describe('optional favorite recipients',()=>{
  it('loads older v2 settings and round-trips favorites without linking modes',()=>{
    const old=validateSettings(defaultSettings());expect(old.favorites).toBeUndefined();
    const result=validateSettings({...old,favorites:[{id:'a',name:' Alex ',email:' alex@example.test '},{id:'b',name:'Alias',email:'ALEX@example.test'}]});
    expect(result.favorites).toEqual([{id:'a',name:'Alex',email:'alex@example.test'}]);
    expect(result.modes).toEqual(old.modes);
    expect(validateSettings(JSON.parse(JSON.stringify(result)))).toEqual(result);
  });
  it('rejects malformed, missing, duplicate-ID and oversized favorite lists; names are optional',()=>{
    for(const favorites of [null,{},[{id:'a',name:'',email:''}],[{id:'a',name:'',email:'bad'}],[{id:'a',name:'',email:'a@example.test'},{id:'a',name:'',email:'b@example.test'}],Array(501).fill({id:'a',name:'',email:'a@example.test'})]) {
      expect(()=>validateSettings({...defaultSettings(),favorites})).toThrow(/常用/);
    }
    expect(validateSettings({...defaultSettings(),favorites:[{id:'a',name:'',email:'a@example.test'}]}).favorites).toHaveLength(1);
  });
});
