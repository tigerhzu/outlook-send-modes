// 寄信模式 1.7：正式網址部署檢查。不需登入、不送出任何權杖或範本資料。
// 用法：node check-deploy.mjs https://templates.company.example
const input = process.argv[2];
if (!input || !/^https:\/\/[^/\\?#\s]+\/?$/.test(input)) {
  console.error('用法：node check-deploy.mjs https://正式網址（不含路徑）');
  process.exit(2);
}
const origin = new URL(input).origin;
const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let failed = 0;

async function get(path) {
  const response = await fetch(origin + path, {redirect: 'manual', signal: AbortSignal.timeout(15000)});
  return {status: response.status, headers: response.headers, text: await response.text()};
}
function report(ok, label, detail = '') {
  if (!ok) failed++;
  console.log(`${ok ? '通過' : '失敗'}  ${label}${detail ? `：${detail}` : ''}`);
}

const checks = [
  ['/taskpane.html', 200], ['/auth.html', 200], ['/commands.html', 200],
  ['/icons/mail-felt-80.png', 200], ['/healthz', 200],
  ['/api/catalog', 401], ['/api/admin', 401],
  ['/.env', 404], ['/server/company.env.example', 404], ['/package.json', 404],
];
for (const [path, expected] of checks) {
  try {
    const {status, headers} = await get(path);
    report(status === expected, `${path} 應回 ${expected}`, `實際 ${status}`);
    if (path === '/taskpane.html' && status === 200) {
      const xfo = headers.get('x-frame-options');
      report(!xfo, 'taskpane 不可帶 X-Frame-Options（Outlook 需嵌入）', xfo || '無');
      const csp = headers.get('content-security-policy') || '';
      report(!/frame-ancestors\s+'(none|self)'/i.test(csp), 'CSP 不可用 frame-ancestors none/self 阻擋 Outlook', csp || '無');
    }
  } catch (error) {
    report(false, path, error.cause?.code || error.message);
  }
}

try {
  const {status, text, headers} = await get('/api/config');
  const config = status === 200 ? JSON.parse(text) : {};
  report(status === 200, '/api/config 可讀', `實際 ${status}`);
  report(guid.test(config.tenantId || ''), 'Tenant ID 已設定（不是範例值）', config.tenantId);
  report(guid.test(config.clientId || '') && !/^0{8}-/.test(config.clientId), 'SPA Client ID 已設定', config.clientId);
  report(/^api:\/\/[0-9a-f-]{36}\/Templates\.Read$/i.test(config.scope || '') && !config.scope.includes('00000000-'), 'API scope 已設定', config.scope);
  report(!/max-age=[1-9]/.test(headers.get('cache-control') || ''), 'API 不應被快取', headers.get('cache-control') || '無');
} catch (error) {
  report(false, '/api/config', error.message);
}

console.log(failed ? `\n${failed} 項未通過。` : '\n網站與 API 基本檢查全部通過。仍需用真實帳號在 Outlook 實測登入、權限與插入。');
process.exit(failed ? 1 : 0);
