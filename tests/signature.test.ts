import { describe, expect, it } from 'vitest';
import { ApplyController } from '../src/draft';
import { defaultSettings, validateSettings } from '../src/model';
import { findManagedBlock } from '../src/body';
import { appendSignature, prepareSignature, sanitizeSignature, type SignatureImage, type SignaturePort, type SignatureState } from '../src/signature';
import { FakeDraft, clone } from './fake-draft';

const signature = '<p>Best regards,<br>Example Person — Example Company</p><p><a href="https://example.test">Website</a></p>';
const image = '<img src="data:image/png;base64,aGVsbG8=" alt="Company logo" width="160">';
class SignatureDraft extends FakeDraft implements SignaturePort {
  signatureState: SignatureState | undefined;
  images: SignatureImage[] = [];
  supported = true;
  async readSignatureState() { return this.signatureState ? clone(this.signatureState) : undefined; }
  async saveSignatureState(state: SignatureState) {
    if (this.fail === 'signature-state') throw new Error('Mock signature save failed');
    this.signatureState = clone(state); this.writes.push('signature-state');
    this.afterWrite?.('signature-state',this);
  }
  checkSignatureImages(images: SignatureImage[]) { if (images.length && !this.supported) throw new Error('Images unsupported'); }
  async addSignatureImage(image: SignatureImage) {
    if (this.fail === 'image') throw new Error('Mock image failed');
    this.images.push(image); this.writes.push('image'); this.afterWrite?.('image',this);
  }
}

describe('signature container and draft preservation (mock host)',()=>{
  it('loads old settings and round-trips a rich signature without stripping links/images',()=>{
    const old = defaultSettings();
    expect(validateSettings(old)).toMatchObject({version:2});
    expect(validateSettings(old).signatureHtml).toBeUndefined();
    const next = validateSettings({...old,signatureHtml:signature+image});
    expect(next.signatureHtml).toContain('href="https://example.test"');
    expect(next.signatureHtml).toContain('data:image/png;base64,');
    expect(validateSettings(JSON.parse(JSON.stringify(next)))).toEqual(next);
  });
  it('sanitizes the pasted signature while preserving supported layout',()=>{
    const clean = sanitizeSignature('<script>alert(1)</script><p onclick="alert(1)" style="color:red;position:fixed;background-image:url(https://bad.test)"><a href="javascript:alert(1)">Name</a></p><table border="0"><tr><td>Company</td></tr></table>');
    expect(clean).not.toMatch(/script|onclick|position|background-image|javascript/);
    expect(clean).toContain('color:red'); expect(clean).toContain('border="0"');
  });
  it.each(['cid:missing','file:///private/image.png','blob:https://example.test/id','http://localhost/image.png','data:image/svg+xml;base64,abcd'])('rejects unresolved or unsafe image %s',src=>{
    expect(()=>sanitizeSignature(`<img src="${src}">`)).toThrow(/圖片/);
  });
  it('prepares inline attachments without adding borders to signature tables',()=>{
    const prepared = prepareSignature(signature+image+'<table border="0"><tr><td>Badge</td></tr></table>','send-signature-test');
    expect(prepared.images).toEqual([{name:'send-signature-test-0.png',source:'data:image/png;base64,aGVsbG8='}]);
    expect(prepared.html).toContain('src="cid:send-signature-test-0.png"');
    expect(prepared.html).toContain('border="0"'); expect(prepared.html).not.toContain('border="1"');
  });
  it('splices a fragment or full document at the end without reserializing original bytes',()=>{
    const body = '<!doctype html><html><head><title>Draft</title></head><body><p data-original="keep">Body</p><blockquote>History</blockquote></body></html>';
    expect(appendSignature(body,'SIGNATURE')).toBe(body.replace('</body>','SIGNATURE</body>'));
    expect(appendSignature('<p>Body</p>','SIGNATURE')).toBe('<p>Body</p>SIGNATURE');
    expect(appendSignature('<html><body><p>Body</p></html>','SIGNATURE')).toBe('<html><body><p>Body</p>SIGNATURE</html>');
  });
  it('appends once, preserves the original body, links, history and all recipients, and keeps user edits on repeat',async()=>{
    const port = new SignatureDraft();
    port.data.bodyHtml = '<html><body><p>Typed message</p><p><img src="cid:existing">Original signature</p><blockquote>History</blockquote></body></html>';
    port.data.subject = 'Keep subject'; port.data.to = [{displayName:'Recipient',emailAddress:'a@example.test'}];
    const before = clone(port.data);
    const controller = new ApplyController();
    expect((await controller.addSignature(signature+image,port)).status).toBe('success');
    const block = findManagedBlock(port.data.bodyHtml,port.signatureState!.token)!;
    expect(port.data.bodyHtml.slice(0,block.start)+port.data.bodyHtml.slice(block.end)).toBe(before.bodyHtml);
    expect(port.data.bodyHtml.indexOf('Best regards')).toBeGreaterThan(port.data.bodyHtml.indexOf('History'));
    expect(port.data.to).toEqual(before.to); expect(port.data.subject).toBe(before.subject);
    expect(port.images).toHaveLength(1);
    port.data.bodyHtml = port.data.bodyHtml.replace('Best regards','Edited closing');
    const writes = [...port.writes];
    expect((await controller.addSignature(signature+image,port)).status).toBe('noop');
    expect(port.writes).toEqual(writes); expect(port.data.bodyHtml).toContain('Edited closing');
  });
  it('does not add a duplicate when a matching existing signature is already in the draft',async()=>{
    const port = new SignatureDraft(); port.data.bodyHtml = '<p>Message</p>'+signature;
    expect((await new ApplyController().addSignature(signature,port)).status).toBe('noop');
    expect(port.writes).toEqual([]);
  });
  it('fails closed when a previously added signature marker has disappeared',async()=>{
    const port = new SignatureDraft(); const controller = new ApplyController();
    await controller.addSignature(signature,port);
    port.data.bodyHtml = '<p>User edited signature and removed marker</p>';
    const writes = [...port.writes];
    expect((await controller.addSignature(signature,port)).status).toBe('error');
    expect(port.writes).toEqual(writes);
  });
  it('blocks plain text and unsupported images before any mutation',async()=>{
    const port = new SignatureDraft(); port.data.bodyType='text';
    expect((await new ApplyController().addSignature(signature,port)).status).toBe('error');
    expect(port.writes).toEqual([]);
    port.data.bodyType='html'; port.supported=false;
    expect((await new ApplyController().addSignature(signature+image,port)).status).toBe('error');
    expect(port.writes).toEqual([]);
  });
  it('does not write when tracking cannot be saved',async()=>{
    const port = new SignatureDraft(); port.fail='signature-state';
    expect((await new ApplyController().addSignature(signature+image,port)).status).toBe('error');
    expect(port.images).toEqual([]); expect(port.data.bodyHtml).toBe('');
  });
  it('blocks retry after an ambiguous image failure',async()=>{
    const port = new SignatureDraft(); port.fail='image'; const controller=new ApplyController();
    expect((await controller.addSignature(signature+image,port)).status).toBe('partial');
    port.fail=undefined;
    expect((await controller.addSignature(signature+image,port)).status).toBe('error');
    expect(port.images).toEqual([]); expect(port.data.bodyHtml).toBe('');
  });
  it('stops before replacing the body if the user edits or switches drafts while images are attached',async()=>{
    for (const change of ['edit','switch']) {
      const port = new SignatureDraft();
      port.afterWrite=(field)=>{if(field==='image') { if(change==='edit') port.data.bodyHtml='<p>New user text</p>'; else port.current=false; }};
      expect((await new ApplyController().addSignature(signature+image,port)).status).toBe('partial');
      expect(port.writes).not.toContain('body');
    }
  });
  it('reports a host that loses original content and does not mark the signature applied',async()=>{
    const port = new SignatureDraft(); port.data.bodyHtml='<p>Original content</p>';
    port.afterWrite=(field)=>{if(field==='body') port.data.bodyHtml=port.data.bodyHtml.replace('<p>Original content</p>','');};
    expect((await new ApplyController().addSignature(signature,port)).status).toBe('partial');
    expect(port.signatureState?.phase).toBe('prepared');
  });
  it('serializes signature and template writes through the same controller',async()=>{
    const port = new SignatureDraft(); const controller=new ApplyController();
    let unblock!:()=>void;
    port.readSignatureState=async()=>{await new Promise<void>(resolve=>{unblock=resolve;});return undefined;};
    const first=controller.addSignature(signature,port);
    const settings=defaultSettings();
    const second=await controller.apply(settings.modes[0],settings,port,async()=>true);
    expect(second.status).toBe('error'); expect(second.message).toContain('正在套用');
    unblock(); expect((await first).status).toBe('success');
  });
  it('switching modes after adding a signature preserves its images, links and tracking',async()=>{
    const settings=defaultSettings();
    settings.modes[0].to=['johnny@example.test'];settings.modes[0].cc=['purple@example.test'];settings.modes[1].to=['hank@example.test'];settings.modes[1].cc=['johnny@example.test','purple@example.test'];
    const port=new SignatureDraft(); port.data.bodyHtml='<blockquote>Original history</blockquote>';
    const controller=new ApplyController();
    expect((await controller.apply(settings.modes[0],settings,port,async()=>true)).status).toBe('success');
    expect((await controller.addSignature(signature+image,port)).status).toBe('success');
    const token=port.signatureState!.token;
    const before=findManagedBlock(port.data.bodyHtml,token)!.html;
    expect((await controller.apply(settings.modes[1],settings,port,async()=>true)).status).toBe('success');
    expect(findManagedBlock(port.data.bodyHtml,token)?.html).toBe(before);
    expect(port.data.bodyHtml).toContain('Original history');
    expect(port.signatureState?.phase).toBe('applied');
    expect(port.images).toHaveLength(1);
  });
});
