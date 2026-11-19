import type { Settings } from '../src/types';

/** Saved user-customized modes keep the pre-existing editor/draft regression coverage. */
export function sampleSettings(): Settings {
  const cell = 'border:1px solid #b7c9db;padding:10px;text-align:left';
  const table = (labels: string[]) => `<table><tbody>${labels.map(label => `<tr><th style="${cell}">${label}</th><td style="${cell}">&nbsp;</td></tr>`).join('')}</tbody></table>`;
  return {version:2,presetRevision:1,modes:[
    {id:'overtime',name:'加班',to:[],cc:[],subject:'加班申請',bodyHtml:table(['加班日期','開始時間','結束時間','加班時數','工作內容／原因'])},
    {id:'remote',name:'居家',to:[],cc:[],subject:'居家辦公申請',bodyHtml:table(['申請日期','工作內容','聯絡方式'])},
  ]};
}
