import type { House, Reminder } from './house.ts';
import { sendPush, type VapidKeys } from './push.ts';

export type Fetcher = typeof fetch;

/**
 * Deliver a reminder to every device the member enabled, at most once: the
 * key is recorded before sending, so retries and overlapping runs never
 * double-notify. Dead subscriptions (uninstalled app, revoked permission)
 * are removed automatically.
 */
export async function deliver(house: House, keys: VapidKeys | null, r: Reminder, fetchFn: Fetcher = fetch): Promise<string> {
  const { changes } = await house.db.run(
    "INSERT OR IGNORE INTO notifications (key, member_id, title, body, status, sent_at) VALUES (?, ?, ?, ?, 'sending', ?)",
    r.key, r.memberId, r.title, r.body, house.now().toISOString());
  if (changes === 0) return 'duplicate';
  const subs = await house.pushSubscriptions(r.memberId);
  let status = 'no-device';
  const errors: string[] = [];
  if (keys && subs.length) {
    let ok = 0;
    for (const s of subs) {
      try {
        const res = await sendPush(s, { title: r.title, body: r.body, url: r.url ?? '/', tag: r.key }, keys, fetchFn);
        if (res.ok) ok++;
        else if (res.gone) await house.db.run('DELETE FROM push_subscriptions WHERE id = ?', s.id);
        else errors.push(`HTTP ${res.status}`);
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
    status = ok > 0 ? 'sent' : 'failed';
  }
  await house.db.run('UPDATE notifications SET status = ?, error = ? WHERE key = ?', status, errors.join('; ').slice(0, 300) || null, r.key);
  return status;
}

/** One pass of background work. Runs on a schedule; safe to run any time. */
export async function tick(house: House, keys: VapidKeys | null, fetchFn: Fetcher = fetch): Promise<number> {
  if (!(await house.isSetUp())) return 0;
  await house.finalize();
  await house.week('current');
  await house.week('next'); // planned a week ahead so people can swap early
  let sent = 0;
  for (const r of await house.dueReminders()) if ((await deliver(house, keys, r, fetchFn)) === 'sent') sent++;
  return sent;
}
