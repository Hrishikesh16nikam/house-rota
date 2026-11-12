import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleApi, type ApiContext } from '../src/api.ts';
import { nodeDb } from '../src/db-node.ts';
import { House } from '../src/house.ts';
import { generateVapidKeys } from '../src/push.ts';
import { makeHouse, MIGRATIONS, PEPPER } from './helpers.ts';

const BASE = 'https://rota.example.com';

function client(ctx: ApiContext) {
  let cookie = '';
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await handleApi(new Request(BASE + path, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }), ctx);
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    return { status: res.status, headers: res.headers, data: text ? JSON.parse(text) : null };
  };
  return { call, get cookie() { return cookie; } };
}

test('first-run setup needs the setup code, then signs the admin in', async () => {
  const house = new House(nodeDb(':memory:', MIGRATIONS), { pepper: PEPPER });
  const ctx: ApiContext = { house, setupCode: 'open-sesame-42', vapid: null, waitUntil: () => {} };
  const c = client(ctx);
  assert.deepEqual((await c.call('GET', '/api/status')).data, { setUp: false, house: null });
  const body = {
    houseName: 'Maple', timezone: 'America/New_York', adminName: 'Hrishi', adminPin: '135790', housemates: ['Ben', 'Chen'],
    washrooms: [{ name: 'Upstairs', members: ['Hrishi', 'Ben', 'Chen'] }], kitchenSlots: 1,
  };
  assert.equal((await c.call('POST', '/api/setup', { ...body, setupCode: 'wrong' })).status, 403);
  const ok = await c.call('POST', '/api/setup', { ...body, setupCode: 'open-sesame-42' });
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('set-cookie')!, /HttpOnly; SameSite=Lax; Path=\/; Max-Age=\d+; Secure/);
  assert.equal((await c.call('GET', '/api/me')).data.member.name, 'Hrishi');
  assert.equal((await c.call('POST', '/api/setup', { ...body, setupCode: 'open-sesame-42' })).status, 409);
});

test('invite flow: admin creates a link, the housemate sets a PIN and is signed in', async () => {
  const { house } = await makeHouse();
  const ctx: ApiContext = { house, setupCode: 'x', vapid: null, waitUntil: () => {} };
  const admin = client(ctx);
  await admin.call('POST', '/api/login', { memberId: 1, pin: '246810' });
  const added = await admin.call('POST', '/api/members', { name: 'Dana' });
  const inv = await admin.call('POST', `/api/members/${added.data.id}/invite`);
  assert.match(inv.data.url, /^https:\/\/rota\.example\.com\/join\//);
  const token = inv.data.url.split('/join/')[1];
  const dana = client(ctx);
  assert.equal((await dana.call('GET', `/api/invites/${token}`)).data.name, 'Dana');
  assert.equal((await dana.call('POST', `/api/invites/${token}`, { pin: '864200' })).status, 200);
  assert.equal((await dana.call('GET', '/api/me')).data.member.name, 'Dana');
});

test('auth, CSRF and JSON rules', async () => {
  const { house } = await makeHouse();
  const ctx: ApiContext = { house, setupCode: 'x', vapid: null, waitUntil: () => {} };
  const c = client(ctx);
  assert.equal((await c.call('GET', '/api/weeks/current')).status, 401);
  await c.call('POST', '/api/login', { memberId: 2, pin: '246810' });
  assert.equal((await c.call('GET', '/api/weeks/current')).status, 200);
  const cross = await c.call('POST', '/api/absences', { startDate: '2026-10-27', endDate: '2026-10-28' }, { Origin: 'https://evil.example' });
  assert.equal(cross.status, 403);
  const res = await handleApi(new Request(`${BASE}/api/login`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'x' }), ctx);
  assert.equal(res.status, 415);
  assert.match(res.headers.get('content-security-policy')!, /default-src 'self'/);
  assert.equal((await c.call('GET', '/api/weeks/nope')).status, 400);
  assert.equal((await c.call('GET', '/api/whatever')).status, 404);
});

test('push subscriptions are validated, and actions send encrypted pushes in the background', async () => {
  const { house } = await makeHouse();
  const pending: Promise<unknown>[] = [];
  const sent: string[] = [];
  const fetchFn = (async (url: string) => {
    sent.push(String(url));
    return new Response(null, { status: 201 });
  }) as unknown as typeof fetch;
  const ctx: ApiContext = { house, setupCode: 'x', vapid: await generateVapidKeys('mailto:x@example.com'), waitUntil: (p) => pending.push(p), fetchFn };

  const w = await house.week('current');
  const k = w.weekly.find((a) => a.dutyName === 'Kitchen')!;
  const owner = client(ctx);
  await owner.call('POST', '/api/login', { memberId: k.memberId, pin: '246810' });
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const { b64url } = await import('../src/security.ts');
  const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc123', keys: { p256dh: b64url(await crypto.subtle.exportKey('raw', pair.publicKey)), auth: b64url(crypto.getRandomValues(new Uint8Array(16))) } };
  assert.equal((await owner.call('POST', '/api/push/subscribe', { ...sub, endpoint: 'http://169.254.169.254/' })).status, 400);
  assert.equal((await owner.call('POST', '/api/push/subscribe', sub)).status, 200);

  const nudger = client(ctx);
  await nudger.call('POST', '/api/login', { memberId: [1, 2, 3, 4, 5, 6].find((id) => id !== k.memberId), pin: '246810' });
  assert.equal((await nudger.call('POST', `/api/assignments/${k.id}/nudge`)).status, 200);
  await Promise.all(pending);
  assert.deepEqual(sent, ['https://fcm.googleapis.com/fcm/send/abc123']);
  const row = await house.db.get<{ status: string }>("SELECT status FROM notifications WHERE key LIKE 'nudge:%'");
  assert.equal(row?.status, 'sent');
});
