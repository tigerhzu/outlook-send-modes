import { bodyEditEvidence, contentEvidence, findManagedBlock, replaceManagedBlock, templateHash, wrapTemplate } from './body';
import { resolveRecipients, sanitizeTemplate } from './model';
import type { ApplyResult, ConfirmApply, Mode, Recipient, Settings } from './types';
import { alreadyContainsSignature, appendSignature, hasSignatureContent, prepareSignature, type SignaturePort, type SignatureState } from './signature';

export interface DraftSnapshot { to:Recipient[];cc:Recipient[];subject:string;bodyHtml:string;bodyType:string;bodyText?:string }
export interface TemplateState { version:1; token:string;modeId:string;presetHash:string;phase:'prepared'|'applied' }
export interface DraftPort {
  isCurrent():boolean;
  snapshot():Promise<DraftSnapshot>;
  readState():Promise<TemplateState | undefined>;
  saveState(state:TemplateState):Promise<void>;
  prepend(html:string):Promise<void>;
  prependText?(text:string):Promise<void>;
  setBody(html:string):Promise<void>;
  setTo(recipients:Recipient[]):Promise<void>;
  setCc(recipients:Recipient[]):Promise<void>;
  setSubject(subject:string):Promise<void>;
  readInlineImage?(source:string):Promise<string>;
}
const recipientKey = (list:Recipient[]) => list.map(r=>r.emailAddress.trim().toLowerCase()).sort().join('\n');
const equalRecipients = (a:Recipient[],b:Recipient[]) => recipientKey(a)===recipientKey(b);
const sameSnapshot = (a:DraftSnapshot,b:DraftSnapshot, sameBody = (left:string,right:string)=>left===right) => equalRecipients(a.to,b.to) && equalRecipients(a.cc,b.cc) && a.subject===b.subject && sameBody(a.bodyHtml,b.bodyHtml) && a.bodyType===b.bodyType && a.bodyText===b.bodyText;
export interface ApplyOptions {
  preserveRecipients?: boolean;
  preserveSubject?: boolean;
  plainText?: string;
  beforeWrite?: () => Promise<void>;
  expectedBodyType?: 'html'|'text';
}
const messageOf = (e:unknown) => e instanceof Error ? e.message : String(e);

/** Serialized, verified, non-transactional Office writes. Never roll back over user edits. */
export class ApplyController {
  private busy = false;
  async addSignature(html: string, port: SignaturePort): Promise<ApplyResult> {
    if (this.busy) return {status:'error',message:'正在套用，請稍候。',completed:[]};
    this.busy = true;
    let mutationStarted = false;
    try {
      if (!hasSignatureContent(html)) throw new Error('請先貼上並儲存簽章。');
      const checkItem = () => { if (!port.isCurrent()) throw new Error('草稿已切換或操作逾時，請檢查原草稿。'); };
      checkItem();
      const state = await port.readSignatureState();
      const before = await port.snapshot(); checkItem();
      if (before.bodyType.toLowerCase() !== 'html') throw new Error('請先將郵件切換為 HTML 格式。');
      if (state) {
        const block = findManagedBlock(before.bodyHtml,state.token,'簽章');
        if (!block || state.phase !== 'applied') throw new Error('先前簽章操作未確認完成或標記遺失。請檢查草稿，避免重複加入。');
        return {status:'noop',message:'已加入簽章，保留目前內容。',completed:[]};
      }
      if (alreadyContainsSignature(before.bodyHtml,html)) return {status:'noop',message:'草稿已有此簽章。',completed:[]};
      const next: SignatureState = {version:1,token:`send-signature-${crypto.randomUUID()}`,phase:'prepared'};
      const prepared = prepareSignature(html,next.token);
      port.checkSignatureImages(prepared.images);
      const assertUnchanged = async () => {
        checkItem(); const current = await port.snapshot(); checkItem();
        if (!sameSnapshot(before,current)) throw new Error('草稿在加入簽章時被修改，已停止。請檢查草稿。');
      };
      await assertUnchanged();
      // Journal before attaching anything. Ambiguous failures never silently retry.
      await port.saveSignatureState(next);
      await assertUnchanged();
      for (const image of prepared.images) {
        checkItem(); mutationStarted = true;
        await port.addSignatureImage(image);
        await assertUnchanged();
      }
      mutationStarted = true;
      await port.setBody(appendSignature(before.bodyHtml,prepared.html));
      checkItem();
      const after = await port.snapshot(); checkItem();
      const block = findManagedBlock(after.bodyHtml,next.token,'簽章');
      if (!block) throw new Error('簽章標記無法辨識，內容可能已加入。');
      if (contentEvidence(replaceManagedBlock(after.bodyHtml,block,'')) !== contentEvidence(before.bodyHtml)) throw new Error('無法確認原有內文、簽名或歷史完整保留。');
      if (contentEvidence(block.html) !== contentEvidence(prepared.html)) throw new Error('簽章文字、圖片或連結與預期不符。');
      if (!equalRecipients(before.to,after.to) || !equalRecipients(before.cc,after.cc) || before.subject !== after.subject) throw new Error('加入簽章時其他欄位被修改。');
      await port.saveSignatureState({...next,phase:'applied'}); checkItem();
      return {status:'success',message:'已加入簽章',completed:['簽章']};
    } catch (e) {
      return {status:mutationStarted ? 'partial' : 'error',message:`${messageOf(e)}${mutationStarted ? ' 請檢查草稿與附件；為避免重複，已停止再次加入。' : ''}`,completed:[]};
    } finally { this.busy = false; }
  }
  async apply(mode:Mode,settings:Settings,port:DraftPort,confirm:ConfirmApply,options:ApplyOptions = {}):Promise<ApplyResult> {
    if (this.busy) return {status:'error',message:'正在套用，請稍候。',completed:[]};
    this.busy = true;
    const completed:string[] = [];
    let attempted = '';
    let mutationStarted = false;
    try {
      const target = options.preserveRecipients ? {to:[],cc:[]} : resolveRecipients(mode);
      const html = sanitizeTemplate(mode.bodyHtml);
      const hash = await templateHash(html);
      const checkItem = () => { if (!port.isCurrent()) throw new Error('目前草稿已切換或操作逾時。請重新開啟工作窗格並檢查原草稿。'); };
      // Outlook can reassign signature CIDs during setBody and later saves.
      // Resolve the old bytes BEFORE writing, while their attachment IDs still
      // exist. Keep fingerprints in this operation only; never rewrite the HTML.
      const imageIdentities = new Map<string,string>();
      const imageIdentity = (source:string|null) => source ? imageIdentities.get(source) || source : null;
      const readSnapshot = async () => {
        const snapshot = await port.snapshot(); checkItem();
        if (port.readInlineImage) {
          const doc = new DOMParser().parseFromString(snapshot.bodyHtml,'text/html');
          const sources = new Set(Array.from(doc.querySelectorAll('img')).map(node=>node.getAttribute('src') || '').filter(source=>/^cid:/i.test(source)));
          await Promise.all(Array.from(sources).map(async source=>{
            if (imageIdentities.has(source)) return;
            try {
              const data = await port.readInlineImage!(source);
              const match = data.match(/^data:image\/[a-z0-9.+-]+;base64,([a-z0-9+/=\s]+)$/i);
              if (!match) throw new Error('Inline image bytes unavailable');
              imageIdentities.set(source,`sha256:${await templateHash(match[1].replace(/\s+/g,''))}`);
            } catch {
              // Without verified bytes, different CIDs must still fail closed.
              imageIdentities.set(source,source);
            }
          }));
        }
        checkItem(); return snapshot;
      };
      checkItem();
      const state = await port.readState();
      let expected = await readSnapshot();
      checkItem();
      if(options.expectedBodyType && expected.bodyType.toLowerCase()!==options.expectedBodyType) throw new Error('郵件格式已變更，請重新整理預覽後插入。');
      if (expected.bodyType.toLowerCase() !== 'html') {
        if (options.plainText === undefined || !port.prependText || expected.bodyText === undefined) throw new Error('這封郵件目前是純文字格式。請在 Outlook 將郵件切換為 HTML，再套用可編輯表格。');
        // Plain text has no reliable invisible region markers. Journal once and
        // fail closed on every subsequent attempt instead of guessing a range.
        if (state) throw new Error('這封草稿已有範本紀錄。純文字無法安全定位原區塊，請保留原稿並在新草稿插入。');
        const text = options.plainText + '\r\n\r\n';
        const writeSubject = !options.preserveSubject && expected.subject !== mode.subject;
        if (writeSubject && expected.subject.trim() && !await confirm({changes:[`主旨：「${expected.subject}」將改為「${mode.subject}」。`]})) return {status:'cancelled',message:'已取消，未修改草稿。',completed};
        const assertTextUnchanged = async () => { checkItem(); if (!sameSnapshot(expected,await readSnapshot())) throw new Error('草稿在確認或套用期間被修改，已停止。'); };
        await options.beforeWrite?.(); await assertTextUnchanged();
        const next:TemplateState = {version:1,token:`send-mode-${crypto.randomUUID()}`,modeId:mode.id,presetHash:await templateHash(text),phase:'prepared'};
        attempted='模板追蹤設定'; await port.saveState(next); await assertTextUnchanged();
        attempted='內文'; mutationStarted=true; await port.prependText(text); checkItem();
        const after=await readSnapshot();
        const normalize=(value:string)=>value.replace(/\r\n?/g,'\n');
        if (normalize(after.bodyText || '')!==normalize(text + expected.bodyText) || !sameSnapshot({...expected,bodyText:after.bodyText},after)) throw new Error('無法確認純文字與原稿完整保留，請檢查草稿，不要再次插入。');
        completed.push('內文'); expected=after;
        await port.saveState({...next,phase:'applied'}); await assertTextUnchanged();
        if (writeSubject) {
          attempted='主旨'; await port.setSubject(mode.subject); checkItem();
          const final=await readSnapshot();
          if (!sameSnapshot({...expected,subject:mode.subject},final)) throw new Error('主旨或其他欄位回讀不符，請檢查草稿。');
          completed.push('主旨');
        }
        return {status:'success',message:'已填入目前草稿',completed};
      }
      if (!state && /(?:x_)*(?:send-mode|company-template)-[a-z0-9-]+/i.test(expected.bodyHtml)) throw new Error('偵測到模板標記，但缺少追蹤設定，已停止以避免重複插入。');
      const block = state ? findManagedBlock(expected.bodyHtml,state.token) : null;
      if (state && !block) throw new Error('找不到先前模板的完整標記，可能已被 Outlook 或手動編輯移除。為避免重複插入或刪除資料，已停止。請保留本封內容，在新的空白草稿套用。');
      const replaceBody = !!state && (state.modeId!==mode.id || state.presetHash!==hash || state.phase==='prepared');
      const writeBody = !state || replaceBody;
      const writeTo = !options.preserveRecipients && !equalRecipients(expected.to,target.to);
      const writeCc = !options.preserveRecipients && !equalRecipients(expected.cc,target.cc);
      const writeSubject = !options.preserveSubject && expected.subject!==mode.subject;
      let bodyWritesFinished = !writeBody;
      let activeToken = state?.token;
      const sameBody = (before: string, after: string) => {
        // Keep exact comparisons until our final body write: source offsets and
        // the original signature/history must never be spliced into stale HTML.
        if (!bodyWritesFinished || before === after) return before === after;
        if (!activeToken) return false;
        const previousBlock = findManagedBlock(before,activeToken);
        const currentBlock = findManagedBlock(after,activeToken);
        if (!previousBlock || !currentBlock) return false;
        // Check both regions separately so moving text across the boundary, or
        // losing a marker, cannot be mistaken for host HTML normalization.
        return bodyEditEvidence(previousBlock.html,imageIdentity) === bodyEditEvidence(currentBlock.html,imageIdentity)
          && bodyEditEvidence(replaceManagedBlock(before,previousBlock,''),imageIdentity) === bodyEditEvidence(replaceManagedBlock(after,currentBlock,''),imageIdentity);
      };
      const changes:string[]=[];
      if (writeTo && expected.to.length) changes.push(`To 收件者：將以「${target.to.map(r=>r.displayName || r.emailAddress).join('、')}」取代目前完整名單。`);
      if (writeCc && expected.cc.length) changes.push(`CC 副本：將${target.cc.length ? `改為「${target.cc.map(r=>r.displayName || r.emailAddress).join('、')}」` : '清空'}目前名單。`);
      if (writeSubject && expected.subject.trim()) changes.push(`主旨：「${expected.subject}」將改為「${mode.subject}」。`);
      if (replaceBody) changes.push('既有模板區塊將被取代，其中已填的日期、時數、工作內容或其他修改會移除。區塊外的內文、簽名及回覆歷史會保留。');
      if (changes.length && !(await confirm({changes,previousTemplateText:replaceBody ? block?.text : undefined}))) return {status:'cancelled',message:'已取消，未修改草稿。',completed};
      if (!writeBody && !writeTo && !writeCc && !writeSubject) return {status:'noop',message:'此模式已套用；保留目前模板中填寫的資料。',completed};
      const assertUnchanged = async () => {
        checkItem();
        const now = await readSnapshot(); checkItem();
        if (!sameSnapshot(expected,now,sameBody)) throw new Error('草稿在確認或套用期間被修改，已停止後續操作。請檢查草稿後重新套用。');
      };
      await options.beforeWrite?.();
      await assertUnchanged();
      const next:TemplateState = {version:1,token:state?.token ?? `send-mode-${crypto.randomUUID()}`,modeId:mode.id,presetHash:hash,phase:'prepared'};
      if (writeBody) {
        attempted='模板追蹤設定'; await port.saveState(next);
        await assertUnchanged();
        attempted='內文'; mutationStarted=true;
        const wrapped = wrapTemplate(html,next.token);
        if (block) await port.setBody(replaceManagedBlock(expected.bodyHtml,block,wrapped));
        else await port.prepend(wrapped);
        checkItem();
        const after = await readSnapshot(); checkItem();
        const afterBlock=findManagedBlock(after.bodyHtml,next.token);
        if (!afterBlock) throw new Error('Outlook 回傳的模板標記無法辨識；內文可能已插入。請保留草稿並回報此訊息，不要重複套用。');
        const beforeOutside=block ? replaceManagedBlock(expected.bodyHtml,block,'') : expected.bodyHtml;
        const afterOutside=replaceManagedBlock(after.bodyHtml,afterBlock,'');
        if (contentEvidence(beforeOutside,imageIdentity)!==contentEvidence(afterOutside,imageIdentity)) throw new Error('Outlook 回讀的模板外內容與原稿不同，無法確認簽名、圖片、連結或歷史完整保留。請立即檢查草稿；已停止後續操作。');
        if (contentEvidence(wrapped,imageIdentity)!==contentEvidence(afterBlock.html,imageIdentity)) throw new Error('Outlook 回讀的模板文字或表格與預期不同。請檢查內文；已停止後續操作。');
        completed.push('內文');
        if (!equalRecipients(expected.to,after.to) || !equalRecipients(expected.cc,after.cc) || expected.subject!==after.subject) throw new Error('套用內文期間，收件者或主旨有其他修改。已停止後續操作。');
        expected=after;
        activeToken=next.token;
        bodyWritesFinished=true;
        attempted='模板追蹤設定'; await port.saveState({...next,phase:'applied'});
      }
      for (const field of ['to','cc','subject'] as const) {
        const wanted = field==='subject' ? mode.subject : target[field];
        const shouldWrite = field==='subject' ? writeSubject : field==='to' ? writeTo : writeCc;
        if (!shouldWrite) continue;
        await assertUnchanged();
        attempted = field==='to' ? 'To 收件者' : field==='cc' ? 'CC 副本' : '主旨';
        mutationStarted=true;
        if (field==='subject') await port.setSubject(wanted as string);
        else if (field==='to') await port.setTo(wanted as Recipient[]);
        else await port.setCc(wanted as Recipient[]);
        checkItem();
        const after=await readSnapshot(); checkItem();
        const matches = field==='subject' ? after.subject===wanted : equalRecipients(after[field],wanted as Recipient[]);
        if (!matches) throw new Error('Outlook 回讀結果與設定不符，請手動檢查此欄位。');
        completed.push(attempted);
        const adjusted = {...expected,[field]:after[field]};
        if (!sameSnapshot(adjusted,after,sameBody)) throw new Error('套用期間偵測到其他欄位變更，已停止後續操作。');
        expected=after;
      }
      await assertUnchanged();
      return {status:'success',message:'已填入目前草稿',completed};
    } catch (e) {
      return {status:mutationStarted ? 'partial' : 'error',message:`${mutationStarted ? '套用未完整完成。' : ''}${messageOf(e)}${mutationStarted ? ` 已確認完成：${completed.join('、') || '尚無'}；「${attempted}」可能已變更，請檢查。未自動復原，也沒有寄出郵件。` : ''}`,completed,failed:attempted || undefined};
    } finally { this.busy=false; }
  }
}
