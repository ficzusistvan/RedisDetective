import { createSign } from 'node:crypto';

const CLOCK_SKEW_SECONDS = 60;
const MAX_LIFETIME_SECONDS = 10 * 60;

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

/**
 * Signs a short-lived RS256 JWT for GitHub App authentication.
 *
 * GitHub rejects tokens whose `iat` is in the future, so `iat` is set 60 seconds in the past as
 * clock-skew tolerance. `exp` is at most ten minutes out — GitHub will not accept longer.
 *
 * The JWT is a credential. Callers must not log it, persist it, or put it in an error message.
 */
export function createGitHubAppJwt(privateKeyPem: string, appId: string, now: Date): string {
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const header = base64UrlJson({ alg: 'RS256', typ: 'JWT' });
  const payload = base64UrlJson({
    iat: nowSeconds - CLOCK_SKEW_SECONDS,
    exp: nowSeconds + MAX_LIFETIME_SECONDS,
    iss: appId,
  });
  const unsigned = `${header}.${payload}`;

  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  const signature = signer.sign(privateKeyPem, 'base64url');
  return `${unsigned}.${signature}`;
}
