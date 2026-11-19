import { defaultSettings } from '../src/model';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { SettingsStore } from '../src/storage';

beforeEach(()=>localStorage.clear());
describe('persistent local settings',()=>{
  it('persists a saved template and direct addresses across store instances and keeps accounts separate',()=>{
    const first=new SettingsStore('User@Example.Test');const s=first.load();
    s.modes[0].to=['johnny@example.test'];s.modes[0].subject='更新申請';first.save(s);
    const reopened=new SettingsStore(' user@example.test ').load();
    expect(reopened.modes[0].to).toEqual(['johnny@example.test']);expect(reopened.modes[0].subject).toBe('更新申請');
    expect(new SettingsStore('someone-else@example.test').load().modes[0].to).toEqual(defaultSettings().modes[0].to);
  });
  it('does not persist in-memory edits until explicitly saved',()=>{
    const store=new SettingsStore('a');const s=store.load();s.modes[0].subject='unsaved';
    expect(new SettingsStore('a').load().modes[0].subject).toBe('加班申請');
  });
  it('detects another pane saving and prevents lost updates',()=>{
    const a=new SettingsStore('a'),b=new SettingsStore('a');const one=a.load(),two=b.load();
    one.modes[0].subject='first';a.save(one);two.modes[0].subject='second';
    expect(()=>b.save(two)).toThrow(/另一個工作窗格/);
    expect(new SettingsStore('a').load().modes[0].subject).toBe('first');
  });
  it('fails visibly on invalid persisted JSON and preserves it for recovery',()=>{
    localStorage.setItem('send-modes.v1.a','{bad-json');const store=new SettingsStore('a');
    expect(()=>store.load()).toThrow();expect(localStorage.getItem('send-modes.v1.a')).toBe('{bad-json');
  });
  it('propagates quota failures instead of reporting a successful save',()=>{
    const store=new SettingsStore('a');const s=store.load();
    vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new DOMException('Full','QuotaExceededError');});
    expect(()=>store.save(s)).toThrow(/Full/);
  });
});

it('migrates v1 at the same account key, writes only on Save, and preserves concurrent-write checks',()=>{
  const key='send-modes.v1.legacy';
  const old={version:1,contacts:[{id:'a',name:'A',email:'a@example.test'}],modes:[{id:'saved',name:'Saved',to:['a'],cc:[],subject:'Keep',bodyHtml:'<p>Keep body</p>'}],signatureHtml:'<p>Keep signature</p>'};
  const original=JSON.stringify(old);localStorage.setItem(key,original);
  const first=new SettingsStore('legacy'),other=new SettingsStore('legacy');
  const migrated=first.load(),second=other.load();
  expect(localStorage.getItem(key)).toBe(original);
  expect(migrated.modes.find(mode=>mode.id==='saved')?.to).toEqual(['a@example.test']);
  expect(migrated.signatureHtml).toBe(old.signatureHtml);
  first.save(migrated);
  expect(JSON.parse(localStorage.getItem(key)!).version).toBe(2);
  expect(new SettingsStore('legacy').load()).toEqual(migrated);
  expect(()=>other.save(second)).toThrow(/另一個工作窗格/);
});
