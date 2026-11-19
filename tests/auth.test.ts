import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const mock=vi.hoisted(()=>({initialize:vi.fn(),handle:vi.fn(),redirect:vi.fn(),clear:vi.fn(),config:vi.fn()}));
vi.mock('@azure/msal-browser',()=>({PublicClientApplication:class {initialize=mock.initialize;handleRedirectPromise=mock.handle;acquireTokenRedirect=mock.redirect;clearCache=mock.clear;}}));
vi.mock('../src/company-api',()=>({loadCompanyConfig:mock.config}));
const tenant='11111111-1111-4111-8111-111111111111';
beforeEach(()=>{vi.resetModules();vi.clearAllMocks();sessionStorage.clear();history.replaceState(null,'','/auth.html');sessionStorage.setItem('company-auth-channel','channel');mock.initialize.mockResolvedValue(undefined);mock.clear.mockResolvedValue(undefined);mock.config.mockResolvedValue({tenantId:tenant,clientId:'client',scope:'scope'});});
afterEach(()=>vi.unstubAllGlobals());
it('clears dialog authentication cache before allowing the parent to close the dialog',async()=>{
  mock.handle.mockResolvedValue({tenantId:tenant,accessToken:'opaque-token',expiresOn:new Date(Date.now()+60_000)});
  const parent=vi.fn((_message:string,_options:unknown)=>{expect(sessionStorage.getItem('company-auth-channel')).toBeNull();expect(mock.clear).toHaveBeenCalledOnce();});
  vi.stubGlobal('Office',{onReady:async()=>{},context:{ui:{messageParent:parent}}});
  await import('../src/auth');await vi.waitFor(()=>expect(parent).toHaveBeenCalledOnce());
  expect(JSON.parse(parent.mock.calls[0][0] as unknown as string).accessToken).toBe('opaque-token');
  expect(mock.clear.mock.invocationCallOrder[0]).toBeLessThan(parent.mock.invocationCallOrder[0]);
});
it('clears dialog cache and returns no bearer on a tenant mismatch',async()=>{
  mock.handle.mockResolvedValue({tenantId:'other',accessToken:'reject-this',expiresOn:new Date()});
  const parent=vi.fn();vi.stubGlobal('Office',{onReady:async()=>{},context:{ui:{messageParent:parent}}});
  await import('../src/auth');await vi.waitFor(()=>expect(parent).toHaveBeenCalledOnce());
  expect(JSON.parse(parent.mock.calls[0][0])).toEqual({channel:'channel',error:true});expect(mock.clear).toHaveBeenCalledOnce();expect(sessionStorage.length).toBe(0);
});
