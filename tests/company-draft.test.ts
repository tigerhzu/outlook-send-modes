import { describe, expect, it } from 'vitest';
import { defaultSettings, upgradeSettings, validateSettings } from '../src/model';
import { companyTemplates, companyDefaults, renderCompanyTemplate } from '../src/company-templates';
import { ApplyController } from '../src/draft';
import { contentEvidence, findManagedBlock } from '../src/body';
import { FakeDraft } from './fake-draft';
import { SettingsStore } from '../src/storage';

describe('one editable mode system for all company presets',()=>{
  it('uses all four new sources, defaults and recipients; no unresolved form tokens',()=>{
    const settings=defaultSettings();
    expect(settings.modes.map(mode=>mode.id)).toEqual(['overtime','remote','wfh-tasklist','it-request']);
    settings.modes.forEach((mode,index)=>{
      const source=renderCompanyTemplate(companyTemplates[index],companyDefaults(companyTemplates[index]));
      expect(contentEvidence(mode.bodyHtml)).toBe(contentEvidence(source.html));
      expect(mode.subject).toBe(source.subject.trim());
      expect(mode.to).toEqual(source.to.map(person=>person.emailAddress));
      expect(mode.cc).toEqual(source.cc.map(person=>person.emailAddress));
      expect(mode.bodyHtml).not.toMatch(/\{\{|ROW START/);
      expect(mode.bodyHtml).toContain('background:');
      expect(mode.bodyHtml).toContain('border-top:');
      expect(mode.bodyHtml).toContain('line-height:');
      expect(mode.bodyHtml).toContain('border="0"');
    });
  });
  it('replaces overlapping old modes once, keeps custom modes/signature/favorites, and respects subsequent edits/deletions',()=>{
    const old={...defaultSettings(),presetRevision:undefined};
    old.modes=old.modes.slice(0,2).map(mode=>({...mode,bodyHtml:'<p>old body</p>',to:['old@example.test']}));
    old.modes.push({id:'custom',name:'Custom',subject:'Keep',bodyHtml:'<p>custom</p>',to:['a@example.test'],cc:[]});
    old.signatureHtml='<p>signature</p>';old.favorites=[{id:'f',name:'Saved',email:'saved@example.test'}];
    const upgraded=upgradeSettings(old);
    expect(upgraded.modes.slice(0,4)).toEqual(defaultSettings().modes);
    expect(upgraded.modes[4]).toEqual(old.modes[2]);
    expect(upgraded.signatureHtml).toBe(old.signatureHtml);expect(upgraded.favorites).toEqual(old.favorites);
    upgraded.modes[0].subject='My subject';upgraded.modes.splice(1,1);
    const store=new SettingsStore('upgrade-test');store.load();store.save(upgraded);
    expect(new SettingsStore('upgrade-test').load()).toEqual(validateSettings(upgraded));
    expect(upgradeSettings(upgraded)).toEqual(upgraded);
  });
  it('switches all four presets and a custom mode through one tracked block, preserves outside content and manual edits',async()=>{
    const settings=defaultSettings(), port=new FakeDraft(), controller=new ApplyController();
    const outside='<p>typed text</p><p><img src="cid:logo">signature</p><blockquote>history</blockquote>';
    port.data.bodyHtml=outside;
    for(const mode of [...settings.modes,{id:'custom',name:'Custom',subject:'Custom',bodyHtml:'<p>custom body</p>',to:['custom@example.test'],cc:[]}]) {
      expect((await controller.apply(mode,settings,port,async()=>true)).status).toBe('success');
      const block=findManagedBlock(port.data.bodyHtml,port.state!.token)!;
      expect(contentEvidence(block.html)).toBe(contentEvidence(mode.bodyHtml));
      expect(port.data.bodyHtml.endsWith(outside)).toBe(true);
      expect(port.data.to.map(person=>person.emailAddress)).toEqual(mode.to);
      expect(port.data.cc.map(person=>person.emailAddress)).toEqual(mode.cc);
      port.data.bodyHtml=port.data.bodyHtml.replace('</div>','<p>Filled in Outlook</p></div>');
      const filled=port.data.bodyHtml;
      expect((await controller.apply(mode,settings,port,async()=>true)).status).toBe('noop');
      expect(port.data.bodyHtml).toBe(filled);
    }
    expect(port.writes.filter(field=>field==='prepend')).toHaveLength(1);
  });
  it('replaces a tracked legacy company block only after confirmation, without adding a second system',async()=>{
    const settings=defaultSettings(),port=new FakeDraft(),controller=new ApplyController();
    port.state={version:1,token:'company-template-old',modeId:'company:overtime',presetHash:'old',phase:'applied'};
    const existing='<div id="company-template-old"><p>Filled old company template</p></div><p>signature</p>';
    port.data.bodyHtml=existing;
    expect((await controller.apply(settings.modes[0],settings,port,async()=>false)).status).toBe('cancelled');
    expect(port.data.bodyHtml).toBe(existing);expect(port.writes).toEqual([]);
    expect((await controller.apply(settings.modes[0],settings,port,async()=>true)).status).toBe('success');
    expect(port.writes).not.toContain('prepend');expect(port.data.bodyHtml.endsWith('<p>signature</p>')).toBe(true);
  });
  it.each(['send-mode-orphan','company-template-orphan'])('blocks orphan markers: %s',async token=>{
    const settings=defaultSettings(),port=new FakeDraft();port.data.bodyHtml=`<div id="${token}">Keep</div>`;
    expect((await new ApplyController().apply(settings.modes[0],settings,port,async()=>true)).status).toBe('error');
    expect(port.writes).toEqual([]);
  });
});
