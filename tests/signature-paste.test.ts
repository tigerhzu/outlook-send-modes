import {afterEach,expect,it,vi} from 'vitest';
import {captureSignatureImages} from '../src/signature-paste';
const data='data:image/png;base64,aGVsbG8=';
afterEach(()=>vi.unstubAllGlobals());
it('resolves originalsrc before sanitization and caches repeated images',async()=>{
  const resolve=vi.fn(async(source:string)=>{expect(source).toBe('cid:logo');return data;});
  const result=await captureSignatureImages('<p>Before</p><img src="blob:https://outlook.office.com/a" originalsrc="cid:logo" width="120"><img src="blob:https://outlook.office.com/a" originalsrc="cid:logo"><p>After</p>',resolve);
  expect(resolve).toHaveBeenCalledTimes(1);expect(result.match(/data:image/g)).toHaveLength(2);
  expect(result).not.toMatch(/blob:|originalsrc/);expect(result).toContain('width="120"');expect(result).toContain('After');
});
it('converts conditional VML images instead of stripping them',async()=>{
  const result=await captureSignatureImages('<p>Before</p><!--[if gte vml 1]><v:shape style="width:120px"><v:imagedata src="cid:logo" o:title="Logo"></v:imagedata></v:shape><![endif]--><p>After</p>',async()=>data);
  expect(result).toContain('<img');expect(result).toContain(data);expect(result).not.toContain('v:');
});
it('does not duplicate a VML image when HTML includes its fallback',async()=>{
  const result=await captureSignatureImages('<v:shape><v:imagedata src="cid:logo"></v:imagedata></v:shape><img src="cid:logo">',async()=>data);
  expect(result.match(/<img/g)).toHaveLength(1);
});
it('captures public images as bytes and does not persist their URLs',async()=>{
  const fetcher=vi.fn(async()=>({ok:true,blob:async()=>new Blob(['hello'],{type:'image/png'})}));
  vi.stubGlobal('fetch',fetcher);
  const result=await captureSignatureImages('<img src="https://example.test/logo.png">');
  expect(result).toContain(data);expect(result).not.toContain('https:');
  expect(fetcher).toHaveBeenCalledWith('https://example.test/logo.png',expect.objectContaining({credentials:'omit',referrerPolicy:'no-referrer'}));
});
it('rejects missing or protected images instead of silently dropping them',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:false})));
  await expect(captureSignatureImages('<img src="https://outlook.office.com/protected">',async()=>{throw Error('Unavailable');})).rejects.toThrow(/無法取得/);
  await expect(captureSignatureImages('<img src="cid:unknown">')).rejects.toThrow(/無法取得/);
});
