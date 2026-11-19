import { createRemoteJWKSet, jwtVerify } from 'jose';
import { fail } from './catalog.mjs';

export function createAuthenticator({tenantId, apiAudience, clientId}, verificationKey) {
  const issuer = `https://login.microsoftonline.com/${tenantId}/v2.0`;
  const jwks = verificationKey || createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`), {timeoutDuration:10_000});
  return async request => {
    const header = request.headers.authorization;
    if (typeof header !== 'string' || !/^Bearer [A-Za-z0-9._~-]+$/.test(header)) fail(401, '請登入公司帳號。');
    let payload;
    try { ({payload} = await jwtVerify(header.slice(7), jwks, {issuer, audience:apiAudience, algorithms:['RS256'], requiredClaims:['exp','iat','nbf','oid','tid','azp','scp'], clockTolerance:30})); }
    catch { fail(401, '登入已失效，請重新登入公司帳號。'); }
    if (payload.ver !== '2.0' || payload.tid !== tenantId || payload.azp !== clientId || typeof payload.oid !== 'string' || !payload.oid || typeof payload.scp !== 'string' || !payload.scp.split(' ').includes('Templates.Read') || payload.idtyp === 'app') fail(403, '此帳號沒有公司範本權限。');
    return {id:payload.oid, roles:Array.isArray(payload.roles) ? payload.roles.filter(role => typeof role === 'string') : []};
  };
}
export function requireRole(identity, ...roles) {
  if (!roles.some(role => identity.roles?.includes(role))) fail(403, '此帳號沒有這項管理權限。');
}
