// Crypto on the Web Crypto API, so it runs identically on Cloudflare
// Workers and Node.
//
// PINs: a 6-digit PIN has only a million possible values, so no hash makes
// it strong on its own; the real defence is the rate limit on sign-in.
// Hashing with a secret pepper (HMAC) means that a leaked database alone
// can't be brute-forced offline, and it's cheap enough for the Workers free
// plan's 10 ms CPU budget (scrypt or bcrypt would not be).

const enc = new TextEncoder();

export function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256(value: string): Promise<string> {
  return b64url(await crypto.subtle.digest('SHA-256', enc.encode(value)));
}

export async function hmac(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(value)));
}

export async function hashPin(pepper: string, memberId: number, pin: string): Promise<string> {
  return `hmac1$${await hmac(pepper, `${memberId}:${pin}`)}`;
}

export async function verifyPin(pepper: string, memberId: number, pin: string, stored: string | null): Promise<boolean> {
  const actual = await hashPin(pepper, memberId, pin);
  return timingSafeEqual(actual, stored ?? 'hmac1$-');
}

export function timingSafeEqual(a: string, b: string): boolean {
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export function validPin(pin: unknown): pin is string {
  return typeof pin === 'string' && /^\d{6}$/.test(pin) && !/^(\d)\1{5}$/.test(pin) && pin !== '123456' && pin !== '654321';
}
