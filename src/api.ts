// The HTTP API as a standard fetch handler (Request in, Response out), so it
// runs unchanged on Cloudflare Workers and on Node.

import { HttpError, type House, type MemberRow, type Reminder } from './house.ts';
import { deliver, type Fetcher } from './notify.ts';
import type { VapidKeys } from './push.ts';
import { timingSafeEqual } from './security.ts';

export interface ApiContext {
  house: House;
  setupCode: string;
  vapid: VapidKeys | null;
  /** Keep background work (sending pushes) alive after the response. */
  waitUntil: (p: Promise<unknown>) => void;
  fetchFn?: Fetcher;
}

const COOKIE = 'rota_session';
const JSON_LIMIT = 32 * 1024;
const PHOTO_LIMIT = 700 * 1024;

export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' blob: data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};

interface Req {
  request: Request;
  url: URL;
  params: Record<string, string>;
  member: MemberRow | null;
  ip: string;
  cookies: string[];
}

type Handler = (r: Req, c: ApiContext) => Promise<unknown>;
interface Route { method: string; pattern: RegExp; auth: boolean; handler: Handler }
const routes: Route[] = [];
const route = (method: string, path: string, auth: boolean, handler: Handler) =>
  routes.push({ method, pattern: new RegExp(`^${path.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), auth, handler });

const num = (r: Req, key = 'id') => {
  const n = Number(r.params[key]);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `invalid ${key}`);
  return n;
};
const me = (r: Req) => r.member!.id;
const notify = (c: ApiContext, rem: Reminder | null) => {
  if (rem) c.waitUntil(deliver(c.house, c.vapid, rem, c.fetchFn).catch((e) => console.error('[push]', e)));
};

async function json(r: Req): Promise<Record<string, unknown>> {
  if (!(r.request.headers.get('content-type') ?? '').includes('application/json')) throw new HttpError(415, 'expected JSON');
  const body = await readBody(r.request, JSON_LIMIT);
  try {
    const v = JSON.parse(new TextDecoder().decode(body) || '{}');
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
    return v as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'invalid JSON');
  }
}

async function readBody(request: Request, limit: number): Promise<Uint8Array> {
  const declared = Number(request.headers.get('content-length') ?? NaN);
  if (declared > limit) throw new HttpError(413, 'request too large');
  const buf = new Uint8Array(await request.arrayBuffer());
  if (buf.length > limit) throw new HttpError(413, 'request too large');
  return buf;
}

function sessionCookie(r: Req, token: string, maxAge: number): string {
  const secure = r.url.protocol === 'https:' ? '; Secure' : '';
  // Lax, not Strict: opening the app from a notification or a shared link
  // is a top-level navigation, and Strict would look signed out.
  return `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`;
}

function readCookie(request: Request): string | undefined {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return v.join('=') || undefined;
  }
  return undefined;
}

const publicMember = (m: MemberRow) => ({ id: m.id, name: m.name, color: m.color, isAdmin: m.isAdmin, active: m.active, joined: m.joined });

// ---- setup, invites, sign-in -------------------------------------------------

route('GET', '/api/status', false, async (_r, c) => ({
  setUp: await c.house.isSetUp(),
  house: (await c.house.isSetUp()) ? (await c.house.settings()).name : null,
}));

route('POST', '/api/setup', false, async (r, c) => {
  const b = await json(r);
  if (!c.setupCode || !timingSafeEqual(String(b.setupCode ?? ''), c.setupCode)) throw new HttpError(403, 'wrong setup code');
  await c.house.setup({
    houseName: String(b.houseName ?? ''), timezone: String(b.timezone ?? ''), adminName: String(b.adminName ?? ''),
    adminPin: String(b.adminPin ?? ''), housemates: Array.isArray(b.housemates) ? b.housemates.map(String) : [],
    washrooms: Array.isArray(b.washrooms) ? (b.washrooms as { name: string; members: string[] }[]) : [],
    kitchenSlots: Number(b.kitchenSlots ?? 1),
  });
  const { token, member } = await c.house.login(1, String(b.adminPin), r.ip);
  r.cookies.push(sessionCookie(r, token, 60 * 86400));
  return { member: publicMember(member) };
});

route('GET', '/api/login-options', false, async (_r, c) => ({
  house: (await c.house.settings()).name,
  members: (await c.house.memberRows()).filter((m) => m.active && m.joined).map((m) => ({ id: m.id, name: m.name, color: m.color })),
}));

route('POST', '/api/login', false, async (r, c) => {
  const b = await json(r);
  const { token, member } = await c.house.login(Number(b.memberId), String(b.pin ?? ''), r.ip);
  r.cookies.push(sessionCookie(r, token, 60 * 86400));
  return { member: publicMember(member) };
});

route('POST', '/api/logout', false, async (r, c) => {
  await c.house.logout(readCookie(r.request));
  r.cookies.push(sessionCookie(r, '', 0));
  return { ok: true };
});

route('GET', '/api/invites/:token', false, async (r, c) => c.house.inviteInfo(r.params.token));
route('POST', '/api/invites/:token', false, async (r, c) => {
  const { token, member } = await c.house.acceptInvite(r.params.token, String((await json(r)).pin ?? ''));
  r.cookies.push(sessionCookie(r, token, 60 * 86400));
  return { member: publicMember(member) };
});

route('GET', '/api/me', true, async (r) => ({ member: publicMember(r.member!) }));
route('POST', '/api/me/pin', true, async (r, c) => {
  const b = await json(r);
  await c.house.changePin(me(r), String(b.current ?? ''), String(b.next ?? ''), r.ip);
  r.cookies.push(sessionCookie(r, '', 0));
  return { ok: true };
});

// ---- house, members, duties -------------------------------------------------------

route('GET', '/api/house', true, async (r, c) => {
  const s = await c.house.settings();
  const admin = r.member!.isAdmin;
  return {
    name: s.name, timezone: s.timezone, reminderHour: s.reminderHour,
    members: (await c.house.memberRows()).filter((m) => admin || m.active).map(publicMember),
    duties: await c.house.dutyRows(admin),
  };
});
route('PATCH', '/api/house', true, async (r, c) => {
  const b = await json(r);
  return c.house.updateSettings(me(r), { name: b.name as string | undefined, timezone: b.timezone as string | undefined, reminderHour: b.reminderHour as number | undefined });
});
route('POST', '/api/members', true, async (r, c) => publicMember(await c.house.addMember(me(r), String((await json(r)).name ?? ''))));
route('PATCH', '/api/members/:id', true, async (r, c) => {
  const b = await json(r);
  return publicMember(await c.house.updateMember(me(r), num(r), {
    active: typeof b.active === 'boolean' ? b.active : undefined,
    isAdmin: typeof b.isAdmin === 'boolean' ? b.isAdmin : undefined,
    color: typeof b.color === 'string' ? b.color : undefined,
    name: typeof b.name === 'string' ? b.name : undefined,
  }));
});
route('POST', '/api/members/:id/invite', true, async (r, c) => {
  const { token, expiresAt } = await c.house.createInvite(me(r), num(r));
  return { url: `${r.url.origin}/join/${token}`, expiresAt };
});
const dutyInput = (b: Record<string, unknown>) => ({
  name: String(b.name ?? ''), icon: String(b.icon ?? 'sparkles'), slots: Number(b.slots ?? 1), points: Number(b.points ?? 2),
  eligible: Array.isArray(b.eligible) ? b.eligible.map(Number) : null, active: b.active !== false,
});
route('POST', '/api/duties', true, async (r, c) => c.house.saveDuty(me(r), null, dutyInput(await json(r))));
route('PATCH', '/api/duties/:id', true, async (r, c) => c.house.saveDuty(me(r), num(r), dutyInput(await json(r))));

// ---- weeks and duties -------------------------------------------------------------

route('GET', '/api/weeks/:which', true, async (r, c) => {
  const w = r.params.which;
  if (w !== 'current' && w !== 'next' && !/^\d{4}-\d{2}-\d{2}$/.test(w)) throw new HttpError(400, 'unknown week');
  return c.house.week(w as 'current');
});
route('POST', '/api/assignments/:id/done', true, async (r, c) => c.house.markDone(me(r), num(r)));
route('POST', '/api/assignments/:id/confirm', true, async (r, c) => c.house.confirm(me(r), num(r)));
route('POST', '/api/assignments/:id/flag', true, async (r, c) => {
  const out = await c.house.flag(me(r), num(r), String((await json(r)).reason ?? ''));
  notify(c, out.notify);
  return out.assignment;
});
route('POST', '/api/assignments/:id/resolve', true, async (r, c) => c.house.resolve(me(r), num(r), (await json(r)).outcome as 'accept' | 'redo'));
route('POST', '/api/assignments/:id/nudge', true, async (r, c) => {
  notify(c, await c.house.nudge(me(r), num(r)));
  return { ok: true };
});
route('PUT', '/api/assignments/:id/photo', true, async (r, c) => c.house.savePhoto(me(r), num(r), await readBody(r.request, PHOTO_LIMIT)));
route('GET', '/api/assignments/:id/photo', true, async (r, c) => {
  const p = await c.house.photo(num(r));
  return new Response(p.data as BodyInit, { headers: { ...SECURITY_HEADERS, 'Content-Type': p.mime, 'Cache-Control': 'private, max-age=3600' } });
});

// ---- swaps, absences, votes, fairness, history ------------------------------------

route('GET', '/api/swaps', true, async (r, c) => ({ swaps: await c.house.swaps(me(r)) }));
route('POST', '/api/swaps', true, async (r, c) => {
  const b = await json(r);
  const out = await c.house.requestSwap(me(r), Number(b.assignmentId), Number(b.targetId), b.targetAssignmentId ? Number(b.targetAssignmentId) : null);
  notify(c, out.notify);
  return { id: out.swapId };
});
route('POST', '/api/swaps/:id/:decision', true, async (r, c) => {
  const d = r.params.decision;
  if (d !== 'accept' && d !== 'decline' && d !== 'cancel') throw new HttpError(404, 'not found');
  notify(c, await c.house.decideSwap(me(r), num(r), d));
  return { ok: true };
});
route('GET', '/api/absences', true, async (_r, c) => ({ absences: await c.house.absences() }));
route('POST', '/api/absences', true, async (r, c) => {
  const b = await json(r);
  return { changes: await c.house.addAbsence(me(r), Number(b.memberId ?? me(r)), String(b.startDate ?? ''), String(b.endDate ?? ''), (b.note as string) || null) };
});
route('DELETE', '/api/absences/:id', true, async (r, c) => {
  await c.house.removeAbsence(me(r), num(r));
  return { ok: true };
});
route('GET', '/api/votes', true, async (r, c) => ({ duties: await c.house.votes(me(r)) }));
route('PUT', '/api/votes/:id', true, async (r, c) => {
  await c.house.vote(me(r), num(r), Number((await json(r)).score));
  return { duties: await c.house.votes(me(r)) };
});
route('GET', '/api/fairness', true, async (_r, c) => ({ members: await c.house.fairness() }));
route('GET', '/api/history', true, async (r, c) => {
  const before = r.url.searchParams.get('before');
  return { events: await c.house.history(60, before ? Number(before) : null) };
});

// ---- push ------------------------------------------------------------------------------

route('GET', '/api/push/key', true, async (_r, c) => ({ publicKey: c.vapid?.publicKey ?? null }));
route('POST', '/api/push/subscribe', true, async (r, c) => {
  await c.house.savePushSubscription(me(r), (await json(r)) as never);
  return { ok: true };
});
route('POST', '/api/push/unsubscribe', true, async (r, c) => {
  await c.house.removePushSubscription(me(r), String((await json(r)).endpoint ?? ''));
  return { ok: true };
});
route('POST', '/api/push/test', true, async (r, c) => {
  const status = await deliver(c.house, c.vapid, { key: `test:${me(r)}:${Date.now()}`, memberId: me(r), title: 'Reminders are on', body: 'This is what a House Rota reminder looks like.', url: '/' }, c.fetchFn);
  return { status };
});

// ---- dispatch ---------------------------------------------------------------------------

export async function handleApi(request: Request, c: ApiContext): Promise<Response> {
  const url = new URL(request.url);
  const r: Req = {
    request, url, params: {}, member: null, cookies: [],
    ip: request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'local',
  };
  const started = Date.now();
  let status = 200;
  try {
    const allowed: string[] = [];
    for (const rt of routes) {
      const m = rt.pattern.exec(url.pathname);
      if (!m) continue;
      allowed.push(rt.method);
      if (rt.method !== request.method) continue;
      r.params = { ...(m.groups ?? {}) };
      if (request.method !== 'GET') {
        // CSRF: browsers send Origin on cross-site writes; it must be ours.
        const origin = request.headers.get('origin');
        if (origin && origin !== url.origin) throw new HttpError(403, 'cross-origin request rejected');
      }
      if (rt.auth) {
        r.member = await c.house.sessionMember(readCookie(request));
        if (!r.member) throw new HttpError(401, 'please sign in');
      }
      const out = await rt.handler(r, c);
      if (out instanceof Response) return out;
      return jsonResponse(200, out, r.cookies);
    }
    if (allowed.length) throw new HttpError(405, 'method not allowed');
    throw new HttpError(404, 'not found');
  } catch (e) {
    if (e instanceof HttpError) {
      status = e.status;
      return jsonResponse(e.status, { error: e.message }, r.cookies);
    }
    status = 500;
    console.error(`[api] ${request.method} ${url.pathname}`, e);
    return jsonResponse(500, { error: 'something went wrong' }, []);
  } finally {
    if (status >= 500) console.error(`${request.method} ${url.pathname} ${status} ${Date.now() - started}ms`);
  }
}

function jsonResponse(status: number, body: unknown, cookies: string[]): Response {
  const headers = new Headers({ ...SECURITY_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  for (const c of cookies) headers.append('Set-Cookie', c);
  return new Response(JSON.stringify(body), { status, headers });
}
