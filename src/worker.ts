// Cloudflare Workers entry point. Static files (the app) are served by
// Workers Static Assets; this code only runs for /api/* and the schedule.

import { handleApi } from './api.ts';
import { d1, type D1Database } from './db.ts';
import { House } from './house.ts';
import { tick } from './notify.ts';
import type { VapidKeys } from './push.ts';

export interface Env {
  DB: D1Database;
  PIN_PEPPER: string;
  SETUP_CODE: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_JWK: string;
  VAPID_SUBJECT: string;
}

interface Ctx {
  waitUntil(p: Promise<unknown>): void;
}

function vapid(env: Env): VapidKeys | null {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_JWK) return null;
  return { publicKey: env.VAPID_PUBLIC_KEY, privateJwk: JSON.parse(env.VAPID_PRIVATE_JWK), subject: env.VAPID_SUBJECT || 'mailto:admin@example.com' };
}

export default {
  async fetch(request: Request, env: Env, ctx: Ctx): Promise<Response> {
    const house = new House(d1(env.DB), { pepper: env.PIN_PEPPER });
    return handleApi(request, { house, setupCode: env.SETUP_CODE, vapid: vapid(env), waitUntil: (p) => ctx.waitUntil(p) });
  },

  async scheduled(_event: unknown, env: Env, ctx: Ctx): Promise<void> {
    const house = new House(d1(env.DB), { pepper: env.PIN_PEPPER });
    ctx.waitUntil(tick(house, vapid(env)).then((n) => console.log(`tick: sent ${n} reminders`)));
  },
};
