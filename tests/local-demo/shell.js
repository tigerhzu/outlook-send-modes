const taskpane = document.getElementById('taskpane');
const role = document.getElementById('role');
const reload = () => {taskpane.src = `/taskpane.html?demoRole=${encodeURIComponent(role.value)}`;};
role.addEventListener('change', reload);
document.getElementById('reset').addEventListener('click', () => {sessionStorage.removeItem('company-local-demo-draft');reload();});
window.addEventListener('message', event => {
  if (event.origin !== location.origin || event.source !== taskpane.contentWindow || event.data?.type !== 'company-local-demo-draft') return;
  const draft = event.data.draft;
  for (const field of ['to','cc']) document.getElementById(field).textContent = draft[field].map(person => person.emailAddress).join('; ');
  document.getElementById('subject').textContent = draft.subject;
  // An empty sandbox and CSP prevent preview scripts, forms, links or remote resources.
  document.getElementById('draft-body').srcdoc = '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><style>body{font:15px/1.7 system-ui;color:#17233b;padding:14px}blockquote{border-left:3px solid #cad5e4;padding-left:14px;color:#62728a}table{max-width:100%;word-break:break-word}</style>' + draft.bodyHtml;
  document.getElementById('result').textContent = draft.writes.length ? `已更新模擬草稿；寄信次數：${draft.sendCalls}` : '尚未插入範本；寄信次數：0';
});
