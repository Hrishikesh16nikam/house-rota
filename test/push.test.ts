import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encryptPayload, generateVapidKeys, sendPush, vapidHeader } from '../src/push.ts';
import { b64url, fromB64url } from '../src/security.ts';

const enc = new TextEncoder();

const bs = (u: Uint8Array) => u as BufferSource;

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number) {
  const key = await crypto.subtle.importKey('raw', bs(ikm), 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: bs(salt), info: bs(info) }, key, length * 8));
}

/** Plays the browser: makes a subscription and decrypts what the server sends. */
async function browser() {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const uaPublic = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const sub = { endpoint: 'https://push.example.com/send/abc', p256dh: b64url(uaPublic), auth: b64url(auth) };

  const decrypt = async (body: Uint8Array) => {
    const salt = body.slice(0, 16);
    const rs = new DataView(body.buffer, body.byteOffset).getUint32(16);
    const idlen = body[20];
    const asPublic = body.slice(21, 21 + idlen);
    const ciphertext = body.slice(21 + idlen);
    const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, pair.privateKey, 256));
    const info = new Uint8Array([...enc.encode('WebPush: info\0'), ...uaPublic, ...asPublic]);
    const ikm = await hkdf(auth, ecdh, info, 32);
    const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
    const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
    const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ciphertext));
    assert.equal(plain[plain.length - 1], 2, 'last-record delimiter');
    return { rs, idlen, text: new TextDecoder().decode(plain.slice(0, -1)) };
  };
  return { sub, decrypt };
}

test('payloads are RFC 8291 encrypted and only the browser can read them', async () => {
  const { sub, decrypt } = await browser();
  const body = await encryptPayload(sub, enc.encode('{"title":"Trash day"}'));
  const out = await decrypt(body);
  assert.equal(out.text, '{"title":"Trash day"}');
  assert.equal(out.rs, 4096);
  assert.equal(out.idlen, 65);
});

test('the VAPID JWT is a valid ES256 signature for the push service origin', async () => {
  const keys = await generateVapidKeys('mailto:house@example.com');
  const header = await vapidHeader('https://push.example.com/send/abc', keys, 1_000_000);
  const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header)!;
  assert.ok(m, header);
  const claims = JSON.parse(new TextDecoder().decode(fromB64url(m[2])));
  assert.deepEqual(claims, { aud: 'https://push.example.com', exp: 1_000_000 + 43200, sub: 'mailto:house@example.com' });
  const pub = await crypto.subtle.importKey('raw', bs(fromB64url(m[4])), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, bs(fromB64url(m[3])), enc.encode(`${m[1]}.${m[2]}`));
  assert.ok(ok);
});

test('sendPush posts encrypted data with the right headers and reports expired subscriptions', async () => {
  const { sub, decrypt } = await browser();
  const keys = await generateVapidKeys('mailto:house@example.com');
  let captured: { headers: Record<string, string>; body: Uint8Array } | null = null;
  const fetchFn = (async (_url: string, init: { headers: Record<string, string>; body: Uint8Array }) => {
    captured = { headers: init.headers, body: init.body };
    return new Response(null, { status: 410 });
  }) as unknown as typeof fetch;
  const r = await sendPush(sub, { title: 'Kitchen', body: 'Due tonight' }, keys, fetchFn);
  assert.equal(r.gone, true);
  assert.equal(captured!.headers['Content-Encoding'], 'aes128gcm');
  assert.match(captured!.headers.Authorization, /^vapid t=/);
  assert.deepEqual(JSON.parse((await decrypt(captured!.body)).text), { title: 'Kitchen', body: 'Due tonight' });
});
