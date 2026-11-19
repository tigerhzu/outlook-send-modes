export interface Mode { id: string; name: string; to: string[]; cc: string[]; subject: string; bodyHtml: string }
export interface FavoriteRecipient { id: string; name: string; email: string }
export interface Settings { version: 2; presetRevision?: 1; modes: Mode[]; signatureHtml?: string; favorites?: FavoriteRecipient[] }
export interface Recipient { displayName: string; emailAddress: string }
export interface ConfirmPlan { changes: string[]; previousTemplateText?: string }
export type ConfirmApply = (plan: ConfirmPlan) => Promise<boolean>;
export interface ApplyResult {
  status: 'success' | 'cancelled' | 'partial' | 'error' | 'noop';
  message: string;
  completed: string[];
  failed?: string;
}
