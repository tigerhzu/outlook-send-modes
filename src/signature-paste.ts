import { imageDataPattern, isPublicImageUrl, readImageFile, sanitizeSignature } from './signature';

/** Resolve pasted images before sanitization discards Outlook's originalsrc metadata. */
export async function captureSignatureImages(html: string, resolveImage?: (source:string)=>Promise<string>, files: File[] = []): Promise<string> {
  // Word/Outlook may put VML images inside conditional comments.
  const expanded=html.replace(/<!--\[if[^\]]*\]>/gi,'').replace(/<!\[endif\]-->/gi,'');
  const doc=new DOMParser().parseFromString(expanded,'text/html');
  for(const element of Array.from(doc.body.querySelectorAll('*')).filter(el=>el.localName==='v:imagedata')) {
    const src=element.getAttribute('src') || '';
    const shape=element.closest('v\\:shape') || element;
    const existing=Array.from(doc.body.querySelectorAll('img')).some(img=>[img.getAttribute('src'),img.getAttribute('originalsrc')].includes(src));
    if(existing) {shape.remove();continue;}
    const img=doc.createElement('img');img.setAttribute('src',src);
    img.setAttribute('alt',element.getAttribute('o:title') || '');
    if(shape.getAttribute('style')) img.setAttribute('style',shape.getAttribute('style')!);
    shape.replaceWith(img);
  }
  const images=Array.from(doc.body.querySelectorAll('img'));
  if(images.length>20) throw new Error('簽章最多 20 張圖片。');
  const cached=new Map<string,string>();
  for(const img of images) {
    const src=img.getAttribute('src') || '';
    if(imageDataPattern.test(src)) continue;
    const original=img.getAttribute('originalsrc') || img.getAttribute('data-original-src') || '';
    const attachment=img.getAttribute('data-attachment-id');
    const candidates=[...new Set([original,attachment ? `attachment:${attachment}` : '',src].filter(Boolean))];
    const key=JSON.stringify(candidates);
    let captured=cached.get(key) || candidates.find(candidate=>imageDataPattern.test(candidate));
    if(!captured && resolveImage) {
      for(const candidate of candidates) {
        try {captured=await resolveImage(candidate);break;} catch { /* Try the clipboard bytes or a public resource next. */ }
      }
    }
    if(!captured && images.length===1 && files.length===1) captured=await readImageFile(files[0]);
    if(!captured && isPublicImageUrl(src)) {
      // Store bytes, not an authenticated/expiring Outlook URL. Never send account cookies.
      try {
        const response=await fetch(src,{credentials:'omit',signal:AbortSignal.timeout(10_000),referrerPolicy:'no-referrer'});
        if(!response.ok) throw new Error('Image unavailable');
        const blob=await response.blob();
        captured=await readImageFile(new File([blob],'signature-image',{type:blob.type}));
      } catch { /* Fail visibly instead of saving an empty image rectangle. */ }
    }
    if(!captured || !imageDataPattern.test(captured)) throw new Error('無法取得簽章圖片。請從目前草稿重新複製簽章，或用「圖片」加入原檔。');
    cached.set(key,captured);img.setAttribute('src',captured);
  }
  return sanitizeSignature(doc.body.innerHTML);
}
