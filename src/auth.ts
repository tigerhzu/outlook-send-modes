import { PublicClientApplication } from '@azure/msal-browser';
import { loadCompanyConfig } from './company-api';

async function authenticate() {
  await Office.onReady();
  const channel=new URLSearchParams(location.hash.slice(1)).get('channel');
  if(channel && /^[a-f0-9-]{36}$/.test(channel)) {sessionStorage.setItem('company-auth-channel',channel);history.replaceState(null,'',location.pathname);}
  const saved=sessionStorage.getItem('company-auth-channel');
  if(!saved) throw new Error('請從工作窗格開啟登入。');
  let msal:PublicClientApplication|undefined;
  try {
    const config=await loadCompanyConfig();if(!config) throw new Error('公司登入尚未設定。');
    msal=new PublicClientApplication({auth:{clientId:config.clientId,authority:`https://login.microsoftonline.com/${config.tenantId}`,redirectUri:new URL('/auth.html',location.origin).href},cache:{cacheLocation:'sessionStorage'}});
    await msal.initialize();
    const result=await msal.handleRedirectPromise({navigateToLoginRequestUrl:false});
    if(!result) {await msal.acquireTokenRedirect({scopes:[config.scope],prompt:'select_account'});return;}
    if(result.tenantId!==config.tenantId || !result.accessToken || !result.expiresOn) throw new Error('登入的公司不符。');
    await msal.clearCache();sessionStorage.removeItem('company-auth-channel');
    Office.context.ui.messageParent(JSON.stringify({channel:saved,accessToken:result.accessToken,expiresAt:result.expiresOn.getTime()}),{targetOrigin:location.origin});
  } catch {
    await msal?.clearCache().catch(()=>{});
    sessionStorage.removeItem('company-auth-channel');
    Office.context.ui.messageParent(JSON.stringify({channel:saved,error:true}),{targetOrigin:location.origin});
  }
}
void authenticate().catch(()=>{document.getElementById('status')!.textContent='登入未完成。請關閉此視窗，從 Outlook 工作窗格重試。';});
