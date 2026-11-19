import type { DraftPort, DraftSnapshot, TemplateState } from '../src/draft';
import type { Recipient } from '../src/types';

export const clone = <T>(value:T):T => structuredClone(value);
export class FakeDraft implements DraftPort {
  data:DraftSnapshot = {to:[],cc:[],subject:'',bodyHtml:'',bodyType:'html'};
  state:TemplateState|undefined;
  current = true;
  writes:string[] = [];
  fail:string|undefined;
  afterWrite?: (field:string, draft:FakeDraft) => void;
  isCurrent() { return this.current; }
  async snapshot() { return clone(this.data); }
  async readState() { return this.state ? clone(this.state) : undefined; }
  async saveState(state:TemplateState) { this.write('state'); this.state=clone(state); }
  private write(field:string) {
    if (this.fail===field) throw new Error(`Mock failure: ${field}`);
    this.writes.push(field);
  }
  async prepend(html:string) { this.write('prepend'); this.data.bodyHtml=html+this.data.bodyHtml; this.afterWrite?.('prepend',this); }
  async setBody(html:string) { this.write('body'); this.data.bodyHtml=html; this.afterWrite?.('body',this); }
  async setTo(to:Recipient[]) { this.write('to'); this.data.to=clone(to); this.afterWrite?.('to',this); }
  async setCc(cc:Recipient[]) { this.write('cc'); this.data.cc=clone(cc); this.afterWrite?.('cc',this); }
  async setSubject(subject:string) { this.write('subject'); this.data.subject=subject; this.afterWrite?.('subject',this); }
}
