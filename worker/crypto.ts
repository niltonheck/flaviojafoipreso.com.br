const enc = new TextEncoder();

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

const key = (secret: string, usage: KeyUsage) =>
  crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
const mac = async (secret: string, message: string) =>
  crypto.subtle.sign('HMAC', await key(secret, 'sign'), enc.encode(message));

/** 128-bit random voter identifier. */
export const newVoterId = () => b64url(crypto.getRandomValues(new Uint8Array(16)));

/** Cookie value = `<id>.<signature>`; the `cookie:` prefix keeps it separate from the stored voter hash. */
export async function signVoterCookie(secret: string, id: string): Promise<string> {
  return `${id}.${b64url(new Uint8Array(await mac(secret, `cookie:${id}`)))}`;
}

/** Returns the voter id if the cookie signature is valid (constant-time), else null. */
export async function verifyVoterCookie(secret: string, value: string | undefined): Promise<string | null> {
  if (!value) return null;
  const dot = value.indexOf('.');
  if (dot < 1) return null;
  const id = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  try {
    const bytes = fromB64url(sig);
    if (b64url(bytes) !== sig) return null; // canonical encoding only: one valid spelling per signature
    const ok = await crypto.subtle.verify('HMAC', await key(secret, 'verify'), bytes, enc.encode(`cookie:${id}`));
    return ok ? id : null;
  } catch {
    return null;
  }
}

/**
 * What D1 stores instead of the raw identifier. It is scoped to one poll AND one day, so the same browser
 * gets an unrelated code every day: votes on different days cannot be linked to each other.
 */
export const voterHash = async (secret: string, id: string, pollId: string, day: string) =>
  hex(await mac(secret, `voter:${pollId}:${day}:${id}`));

/** Short non-reversible key for rate limiting; never persisted by us. */
export const rateKey = async (secret: string, label: string, value: string) =>
  `${label}:${hex(await mac(secret, `ratelimit:${label}:${value}`)).slice(0, 32)}`;
