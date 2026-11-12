// All house logic. HTTP handlers and the scheduled job call into this.
// Reads happen first; each change is then written as one atomic batch.

import { addDays, daysBetween, isValidDate, localTime, weekday, weekDates, weekStart, WEEKDAY_NAMES, type ISODate } from './domain/dates.ts';
import { planWeek } from './domain/scheduler.ts';
import { coverFor, planTrashWeek } from './domain/trash.ts';
import type { Duty, Member } from './domain/types.ts';
import { stmt, type Db, type Stmt } from './db.ts';
import { hashPin, randomToken, sha256, validPin, verifyPin } from './security.ts';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface Settings {
  name: string;
  timezone: string;
  trashCycleStart: ISODate;
  reminderHour: number;
}

export interface MemberRow {
  id: number;
  name: string;
  color: string;
  isAdmin: boolean;
  active: boolean;
  joined: boolean;
  trashOrder: number;
}

export interface DutyRow extends Duty {
  icon: string;
  defaultPoints: number;
  active: boolean;
}

export type Status = 'pending' | 'done' | 'confirmed' | 'flagged' | 'missed' | 'skipped';

export interface AssignmentView {
  id: number;
  weekStart: ISODate;
  dutyId: number;
  dutyName: string;
  icon: string;
  kind: 'weekly' | 'trash';
  slot: number;
  date: ISODate | null;
  memberId: number | null;
  memberName: string | null;
  originalMemberId: number | null;
  originalMemberName: string | null;
  points: number;
  status: Status;
  doneAt: string | null;
  hasPhoto: boolean;
}

export interface Reminder {
  key: string;
  memberId: number;
  title: string;
  body: string;
  url?: string;
}

/** Icon keys the app can draw; the UI maps each to a line icon. */
export const DUTY_ICONS = ['bath', 'kitchen', 'sofa', 'trash', 'sparkles', 'brush', 'plant', 'laundry', 'recycle', 'dog'];

export const PALETTE = ['#3A43C8', '#0F766E', '#B45309', '#9D174D', '#4D7C0F', '#1D4ED8', '#7C3AED', '#475569'];

const H = 3600 * 1000;
const CONFIRM_WINDOW_MS = 24 * H;
const PHOTO_TTL_MS = 7 * 24 * H;
const SESSION_TTL_MS = 60 * 24 * H;
const INVITE_TTL_MS = 7 * 24 * H;
const NUDGE_COOLDOWN_MS = 12 * H;
const MAX_PHOTO_BYTES = 700 * 1024; // the app compresses photos before upload
const AWAY_DAYS_FOR_WEEKLY = 4;
const COUNTS = "('pending', 'done', 'confirmed', 'flagged')";

type Row = Record<string, unknown>;

/** Adds the event only if the previous statement in the batch changed a row. */
const eventIfChanged = (ts: string, actor: number | null, type: string, assignmentId: number | null, detail: Row = {}): Stmt =>
  stmt('INSERT INTO events (ts, actor_id, type, assignment_id, detail) SELECT ?, ?, ?, ?, ? WHERE changes() > 0',
    ts, actor, type, assignmentId, JSON.stringify(detail));

const eventStmt = (ts: string, actor: number | null, type: string, assignmentId: number | null, detail: Row = {}): Stmt =>
  stmt('INSERT INTO events (ts, actor_id, type, assignment_id, detail) VALUES (?, ?, ?, ?, ?)', ts, actor, type, assignmentId, JSON.stringify(detail));

export class House {
  readonly db: Db;
  readonly pepper: string;
  readonly now: () => Date;

  constructor(db: Db, opts: { pepper: string; now?: () => Date }) {
    if (!opts.pepper || opts.pepper.length < 16) throw new Error('PIN_PEPPER must be at least 16 characters');
    this.db = db;
    this.pepper = opts.pepper;
    this.now = opts.now ?? (() => new Date());
  }

  private iso(): string {
    return this.now().toISOString();
  }

  // ---- settings ----------------------------------------------------------

  async settings(): Promise<Settings> {
    const rows = await this.db.all<{ key: string; value: string }>('SELECT key, value FROM settings');
    const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return {
      name: s.name ?? 'Our house',
      timezone: s.timezone ?? 'America/New_York',
      trashCycleStart: s.trashCycleStart ?? '2026-01-05',
      reminderHour: Number(s.reminderHour ?? 18),
    };
  }

  async isSetUp(): Promise<boolean> {
    return Boolean(await this.db.get('SELECT 1 FROM members LIMIT 1'));
  }

  async today(): Promise<ISODate> {
    return localTime((await this.settings()).timezone, this.now()).date;
  }

  async updateSettings(actorId: number, input: Partial<Pick<Settings, 'name' | 'timezone' | 'reminderHour'>>): Promise<Settings> {
    await this.requireAdmin(actorId);
    const stmts: Stmt[] = [];
    if (input.name !== undefined) {
      const name = String(input.name).trim();
      if (!name || name.length > 40) throw new HttpError(400, 'house name must be 1-40 characters');
      stmts.push(setting('name', name));
    }
    if (input.timezone !== undefined) {
      try {
        new Intl.DateTimeFormat('en', { timeZone: String(input.timezone) });
      } catch {
        throw new HttpError(400, 'unknown time zone');
      }
      stmts.push(setting('timezone', String(input.timezone)));
    }
    if (input.reminderHour !== undefined) {
      const h = Number(input.reminderHour);
      if (!Number.isInteger(h) || h < 6 || h > 22) throw new HttpError(400, 'reminder hour must be between 6 and 22');
      stmts.push(setting('reminderHour', String(h)));
    }
    await this.db.batch(stmts);
    return this.settings();
  }

  /**
   * First-run setup: creates the house, its admin and the default duties.
   * Guarded by a setup code from the server's secrets, so whoever finds the
   * URL first can't claim the house.
   */
  async setup(input: {
    houseName: string; timezone: string; adminName: string; adminPin: string;
    housemates: string[]; washrooms: { name: string; members: string[] }[]; kitchenSlots: number;
  }): Promise<{ adminId: number }> {
    if (await this.isSetUp()) throw new HttpError(409, 'this house is already set up');
    const names = [input.adminName, ...input.housemates].map((n) => String(n ?? '').trim()).filter(Boolean);
    if (names.length < 2 || names.length > 12) throw new HttpError(400, 'add between 2 and 12 people');
    if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) throw new HttpError(400, 'names must be different');
    for (const n of names) if (n.length > 30) throw new HttpError(400, `"${n}" is too long`);
    if (!validPin(input.adminPin)) throw new HttpError(400, 'choose a 6-digit PIN that isn\'t easy to guess');
    try {
      new Intl.DateTimeFormat('en', { timeZone: input.timezone });
    } catch {
      throw new HttpError(400, 'unknown time zone');
    }
    const houseName = String(input.houseName ?? '').trim() || 'Our house';
    const today = localTime(input.timezone, this.now()).date;
    const now = this.iso();

    const stmts: Stmt[] = [
      setting('name', houseName.slice(0, 40)),
      setting('timezone', input.timezone),
      setting('trashCycleStart', weekStart(today)),
      setting('reminderHour', '18'),
    ];
    names.forEach((name, i) => {
      stmts.push(stmt('INSERT INTO members (id, name, color, is_admin, trash_order, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        i + 1, name, PALETTE[i % PALETTE.length], i === 0 ? 1 : 0, i + 1, now));
    });
    const idOf = (n: string) => {
      const i = names.findIndex((x) => x.toLowerCase() === n.trim().toLowerCase());
      if (i < 0) throw new HttpError(400, `"${n}" isn't in the house`);
      return i + 1;
    };
    for (const w of input.washrooms ?? []) {
      const eligible = (w.members ?? []).map(idOf);
      if (!w.name?.trim() || eligible.length === 0) throw new HttpError(400, 'each washroom needs a name and at least one person');
      stmts.push(dutyInsert(w.name.trim(), 'bath', 'weekly', 1, 4, eligible));
    }
    const kitchen = Math.max(1, Math.min(4, Number(input.kitchenSlots) || 1));
    stmts.push(dutyInsert('Kitchen', 'kitchen', 'weekly', kitchen, 3, null));
    stmts.push(dutyInsert('Living room', 'sofa', 'weekly', 1, 2, null));
    stmts.push(dutyInsert('Trash', 'trash', 'trash', 1, 1, null));
    stmts.push(eventStmt(now, null, 'house.created', null, { name: houseName }));
    await this.db.batch(stmts);
    await this.db.run('UPDATE members SET pin_hash = ? WHERE id = 1', await hashPin(this.pepper, 1, input.adminPin));
    return { adminId: 1 };
  }

  // ---- members -------------------------------------------------------------

  async memberRows(): Promise<MemberRow[]> {
    return (await this.db.all<Row>('SELECT * FROM members ORDER BY trash_order, id')).map((r) => ({
      id: Number(r.id), name: String(r.name), color: String(r.color), isAdmin: Boolean(r.is_admin),
      active: Boolean(r.active), joined: r.pin_hash !== null, trashOrder: Number(r.trash_order),
    }));
  }

  async members(): Promise<Member[]> {
    return (await this.memberRows()).map((m) => ({ id: m.id, name: m.name, active: m.active, trashOrder: m.trashOrder }));
  }

  async member(id: number): Promise<MemberRow> {
    const m = (await this.memberRows()).find((x) => x.id === id);
    if (!m) throw new HttpError(404, 'member not found');
    return m;
  }

  private async requireAdmin(actorId: number): Promise<void> {
    if (!(await this.member(actorId)).isAdmin) throw new HttpError(403, 'only the house admin can do that');
  }

  async addMember(actorId: number, name: string): Promise<MemberRow> {
    await this.requireAdmin(actorId);
    const clean = String(name ?? '').trim();
    if (!clean || clean.length > 30) throw new HttpError(400, 'name must be 1-30 characters');
    const rows = await this.memberRows();
    if (rows.some((m) => m.name.toLowerCase() === clean.toLowerCase())) throw new HttpError(409, 'someone already has that name');
    const order = Math.max(0, ...rows.map((m) => m.trashOrder)) + 1;
    const { lastId } = await this.db.run('INSERT INTO members (name, color, trash_order, created_at) VALUES (?, ?, ?, ?)',
      clean, PALETTE[rows.length % PALETTE.length], order, this.iso());
    await this.db.run('INSERT INTO events (ts, actor_id, type, detail) VALUES (?, ?, ?, ?)', this.iso(), actorId, 'member.added', JSON.stringify({ name: clean }));
    return this.member(lastId);
  }

  async updateMember(actorId: number, memberId: number, input: { active?: boolean; isAdmin?: boolean; color?: string; name?: string }): Promise<MemberRow> {
    const self = actorId === memberId;
    if (!self || input.active !== undefined || input.isAdmin !== undefined) await this.requireAdmin(actorId);
    if (self && (input.active === false || input.isAdmin === false)) throw new HttpError(400, 'you can\'t remove your own access');
    const m = await this.member(memberId);
    const stmts: Stmt[] = [];
    if (input.color !== undefined) {
      if (!PALETTE.includes(input.color)) throw new HttpError(400, 'pick one of the app colors');
      stmts.push(stmt('UPDATE members SET color = ? WHERE id = ?', input.color, memberId));
    }
    if (input.name !== undefined) {
      const name = String(input.name).trim();
      if (!name || name.length > 30) throw new HttpError(400, 'name must be 1-30 characters');
      stmts.push(stmt('UPDATE members SET name = ? WHERE id = ?', name, memberId));
    }
    if (input.isAdmin !== undefined) stmts.push(stmt('UPDATE members SET is_admin = ? WHERE id = ?', input.isAdmin, memberId));
    if (input.active !== undefined && input.active !== m.active) {
      stmts.push(stmt('UPDATE members SET active = ? WHERE id = ?', input.active, memberId));
      if (!input.active) {
        stmts.push(stmt('DELETE FROM sessions WHERE member_id = ?', memberId));
        stmts.push(stmt('DELETE FROM push_subscriptions WHERE member_id = ?', memberId));
      }
      stmts.push(eventStmt(this.iso(), actorId, input.active ? 'member.reactivated' : 'member.deactivated', null, { name: m.name }));
    }
    try {
      await this.db.batch(stmts);
    } catch (e) {
      if (String(e).includes('UNIQUE')) throw new HttpError(409, 'someone already has that name');
      throw e;
    }
    return this.member(memberId);
  }

  /** A single-use link that lets a housemate set their own PIN. */
  async createInvite(actorId: number, memberId: number): Promise<{ token: string; expiresAt: string }> {
    await this.requireAdmin(actorId);
    const m = await this.member(memberId);
    if (!m.active) throw new HttpError(400, 'reactivate them first');
    const token = randomToken(24);
    const expiresAt = new Date(this.now().getTime() + INVITE_TTL_MS).toISOString();
    await this.db.batch([
      stmt('DELETE FROM invites WHERE member_id = ? AND used_at IS NULL', memberId),
      stmt('INSERT INTO invites (token_hash, member_id, expires_at) VALUES (?, ?, ?)', await sha256(token), memberId, expiresAt),
    ]);
    return { token, expiresAt };
  }

  async inviteInfo(token: string): Promise<{ memberId: number; name: string; house: string }> {
    const row = await this.db.get<{ member_id: number; expires_at: string; used_at: string | null }>(
      'SELECT member_id, expires_at, used_at FROM invites WHERE token_hash = ?', await sha256(String(token ?? '')));
    if (!row || row.used_at || row.expires_at <= this.iso()) throw new HttpError(410, 'this invite link has expired. Ask your house admin for a new one.');
    const m = await this.member(row.member_id);
    return { memberId: m.id, name: m.name, house: (await this.settings()).name };
  }

  async acceptInvite(token: string, pin: string): Promise<{ token: string; member: MemberRow }> {
    const info = await this.inviteInfo(token);
    if (!validPin(pin)) throw new HttpError(400, 'choose a 6-digit PIN that isn\'t easy to guess');
    const now = this.iso();
    const [used] = await this.db.batch([
      stmt('UPDATE invites SET used_at = ? WHERE token_hash = ? AND used_at IS NULL', now, await sha256(token)),
      stmt('UPDATE members SET pin_hash = ? WHERE id = ? AND changes() > 0', await hashPin(this.pepper, info.memberId, pin), info.memberId),
      stmt('DELETE FROM sessions WHERE member_id = ?', info.memberId),
      eventStmt(now, info.memberId, 'member.joined', null, { name: info.name }),
    ]);
    if (used.changes === 0) throw new HttpError(410, 'this invite link was already used');
    return this.startSession(info.memberId);
  }

  // ---- sign-in -------------------------------------------------------------

  /** Counts an attempt against a key; throws 429 once the window's budget is spent. */
  private async limit(key: string, max: number, windowMs: number): Promise<void> {
    const now = this.now().getTime();
    const row = await this.db.get<{ window_start: number; count: number }>('SELECT window_start, count FROM login_attempts WHERE key = ?', key);
    if (row && now - row.window_start < windowMs) {
      if (row.count >= max) throw new HttpError(429, `too many attempts, try again in ${Math.ceil((row.window_start + windowMs - now) / 60000)} minutes`);
      await this.db.run('UPDATE login_attempts SET count = count + 1 WHERE key = ?', key);
    } else {
      await this.db.run('INSERT INTO login_attempts (key, window_start, count) VALUES (?, ?, 1) ON CONFLICT(key) DO UPDATE SET window_start = excluded.window_start, count = 1', key, now);
    }
  }

  async login(memberId: number, pin: string, ip: string): Promise<{ token: string; member: MemberRow }> {
    await this.limit(`ip:${ip}`, 30, 15 * 60 * 1000);
    await this.limit(`member:${memberId}`, 5, 15 * 60 * 1000);
    const row = await this.db.get<{ pin_hash: string | null; active: number }>('SELECT pin_hash, active FROM members WHERE id = ?', memberId);
    const ok = await verifyPin(this.pepper, memberId, String(pin ?? ''), row?.pin_hash ?? null);
    if (!row || !ok || !row.active) throw new HttpError(401, 'wrong PIN');
    await this.db.run('DELETE FROM login_attempts WHERE key = ?', `member:${memberId}`);
    return this.startSession(memberId);
  }

  private async startSession(memberId: number): Promise<{ token: string; member: MemberRow }> {
    const token = randomToken();
    await this.db.batch([
      stmt('INSERT INTO sessions (token_hash, member_id, expires_at) VALUES (?, ?, ?)', await sha256(token), memberId,
        new Date(this.now().getTime() + SESSION_TTL_MS).toISOString()),
      stmt('DELETE FROM sessions WHERE expires_at <= ?', this.iso()),
    ]);
    return { token, member: await this.member(memberId) };
  }

  async sessionMember(token: string | undefined): Promise<MemberRow | null> {
    if (!token) return null;
    const row = await this.db.get<{ member_id: number; expires_at: string }>(
      'SELECT member_id, expires_at FROM sessions WHERE token_hash = ?', await sha256(token));
    if (!row || row.expires_at <= this.iso()) return null;
    const m = (await this.memberRows()).find((x) => x.id === row.member_id);
    return m?.active ? m : null;
  }

  async logout(token: string | undefined): Promise<void> {
    if (token) await this.db.run('DELETE FROM sessions WHERE token_hash = ?', await sha256(token));
  }

  async changePin(memberId: number, current: string, next: string, ip: string): Promise<void> {
    await this.limit(`member:${memberId}`, 5, 15 * 60 * 1000);
    const row = await this.db.get<{ pin_hash: string | null }>('SELECT pin_hash FROM members WHERE id = ?', memberId);
    if (!(await verifyPin(this.pepper, memberId, String(current ?? ''), row?.pin_hash ?? null))) throw new HttpError(401, 'current PIN is wrong');
    if (!validPin(next)) throw new HttpError(400, 'choose a 6-digit PIN that isn\'t easy to guess');
    await this.db.batch([
      stmt('UPDATE members SET pin_hash = ? WHERE id = ?', await hashPin(this.pepper, memberId, next), memberId),
      stmt('DELETE FROM sessions WHERE member_id = ?', memberId),
      eventStmt(this.iso(), memberId, 'member.pin_changed', null, { ip: ip.slice(0, 45) }),
    ]);
  }

  // ---- duties ----------------------------------------------------------------

  async dutyRows(includeInactive = false): Promise<DutyRow[]> {
    return (await this.db.all<Row>(
      `SELECT d.*, AVG(v.score) AS avg_vote, COUNT(v.score) AS n FROM duties d LEFT JOIN votes v ON v.duty_id = d.id
       ${includeInactive ? '' : 'WHERE d.active = 1'} GROUP BY d.id ORDER BY d.kind DESC, d.id`,
    )).map((r) => ({
      id: Number(r.id), name: String(r.name), icon: String(r.icon), kind: r.kind as Duty['kind'], slots: Number(r.slots),
      defaultPoints: Number(r.default_points),
      points: round1(Number(r.n) > 0 ? Number(r.avg_vote) : Number(r.default_points)),
      eligible: r.eligible ? (JSON.parse(String(r.eligible)) as number[]) : null,
      active: Boolean(r.active),
    }));
  }

  async duties(): Promise<Duty[]> {
    return (await this.dutyRows()).map(({ id, name, kind, slots, points, eligible }) => ({ id, name, kind, slots, points, eligible }));
  }

  async saveDuty(actorId: number, id: number | null, input: { name: string; icon: string; slots: number; points: number; eligible: number[] | null; active?: boolean }): Promise<DutyRow> {
    await this.requireAdmin(actorId);
    const name = String(input.name ?? '').trim();
    if (!name || name.length > 30) throw new HttpError(400, 'duty name must be 1-30 characters');
    const icon = DUTY_ICONS.includes(String(input.icon)) ? String(input.icon) : 'sparkles';
    const slots = Number(input.slots);
    const points = Number(input.points);
    if (!Number.isInteger(slots) || slots < 1 || slots > 4) throw new HttpError(400, 'people per week must be 1 to 4');
    if (!(points >= 1 && points <= 5)) throw new HttpError(400, 'points must be 1 to 5');
    const members = await this.memberRows();
    const eligible = input.eligible && input.eligible.length ? input.eligible.map(Number) : null;
    if (eligible && eligible.some((e) => !members.some((m) => m.id === e))) throw new HttpError(400, 'unknown member in the list');
    if (eligible && eligible.length < slots) throw new HttpError(400, 'pick at least as many people as the duty needs each week');
    const eligibleJson = eligible ? JSON.stringify(eligible) : null;
    try {
      if (id === null) {
        const { lastId } = await this.db.run('INSERT INTO duties (name, icon, kind, slots, default_points, eligible) VALUES (?, ?, ?, ?, ?, ?)',
          name, icon, 'weekly', slots, points, eligibleJson);
        id = lastId;
      } else {
        const existing = (await this.dutyRows(true)).find((d) => d.id === id);
        if (!existing) throw new HttpError(404, 'duty not found');
        await this.db.run('UPDATE duties SET name = ?, icon = ?, slots = ?, default_points = ?, eligible = ?, active = ? WHERE id = ?',
          name, icon, existing.kind === 'trash' ? 1 : slots, points, eligibleJson, input.active === false ? 0 : 1, id);
      }
    } catch (e) {
      if (String(e).includes('UNIQUE')) throw new HttpError(409, 'a duty with that name exists');
      throw e;
    }
    await this.db.run('INSERT INTO events (ts, actor_id, type, detail) VALUES (?, ?, ?, ?)', this.iso(), actorId, 'duty.edited', JSON.stringify({ name }));
    return (await this.dutyRows(true)).find((d) => d.id === id)!;
  }

  // ---- weeks -------------------------------------------------------------------

  async ensureWeek(start: ISODate): Promise<void> {
    if (weekday(start) !== 0) throw new HttpError(400, 'weeks start on Monday');
    if (await this.db.get('SELECT 1 FROM weeks WHERE start_date = ?', start)) return;
    await this.generateWeek(start);
  }

  private async generateWeek(start: ISODate): Promise<void> {
    const members = (await this.members()).filter((m) => m.active);
    if (members.length === 0) return;
    const duties = await this.duties();
    const settings = await this.settings();
    const absences = await this.db.all<{ member_id: number; start_date: string; end_date: string }>(
      'SELECT member_id, start_date, end_date FROM absences WHERE end_date >= ? AND start_date <= ?', start, addDays(start, 6));
    const away = (id: number, date: ISODate) => absences.some((a) => a.member_id === id && a.start_date <= date && a.end_date >= date);
    const awayDays = (id: number) => weekDates(start).filter((d) => away(id, d)).length;
    const now = this.iso();
    const stmts: Stmt[] = [stmt('INSERT OR IGNORE INTO weeks (start_date, generated_at) VALUES (?, ?)', start, now)];

    // Trash first: a fixed cycle whose load feeds into who gets the week off.
    const trash = duties.find((d) => d.kind === 'trash');
    const trashPoints = new Map<number, number>();
    if (trash) {
      for (const day of planTrashWeek(members.map((m) => m.id), settings.trashCycleStart, start, away)) {
        stmts.push(stmt(
          'INSERT OR IGNORE INTO assignments (week_start, duty_id, slot, date, member_id, original_member_id, points, status) VALUES (?, ?, 0, ?, ?, ?, ?, ?)',
          start, trash.id, day.date, day.memberId, day.memberId !== day.scheduledId ? day.scheduledId : null, trash.points,
          day.memberId === null ? 'skipped' : 'pending'));
        if (day.memberId !== null) trashPoints.set(day.memberId, (trashPoints.get(day.memberId) ?? 0) + trash.points);
      }
    }

    // Weekly duties, all planned together.
    const totals = await this.effortThrough(start, false);
    for (const [id, p] of trashPoints) totals.set(id, (totals.get(id) ?? 0) + p);
    const unavailable = new Set(members.filter((m) => awayDays(m.id) >= AWAY_DAYS_FOR_WEEKLY).map((m) => m.id));
    const weeksSince = new Map<string, number>();
    for (const r of await this.db.all<{ member_id: number; duty_id: number; last: string }>(
      `SELECT member_id, duty_id, MAX(week_start) AS last FROM assignments WHERE week_start < ? AND date = '' AND member_id IS NOT NULL GROUP BY member_id, duty_id`,
      start)) {
      weeksSince.set(`${r.member_id}:${r.duty_id}`, Math.round(daysBetween(r.last, start) / 7));
    }
    const plan = planWeek({ members, duties: duties.filter((d) => d.kind === 'weekly'), unavailable, totals, weeksSince });
    for (const s of plan.slots) {
      const d = duties.find((x) => x.id === s.dutyId)!;
      stmts.push(stmt(`INSERT OR IGNORE INTO assignments (week_start, duty_id, slot, date, member_id, points, status) VALUES (?, ?, ?, '', ?, ?, ?)`,
        start, s.dutyId, s.slot, s.memberId, d.points, s.memberId === null ? 'skipped' : 'pending'));
    }
    const name = (id: number) => members.find((m) => m.id === id)?.name ?? '?';
    const notes = [
      ...plan.doubled.map((id) => `${name(id)} has two duties because ${unavailable.size} people are away`),
      ...plan.skipped.map((s) => `${duties.find((d) => d.id === s.dutyId)?.name} is skipped: ${s.reason}`),
    ];
    stmts.push(stmt('UPDATE weeks SET notes = ? WHERE start_date = ?', JSON.stringify(notes), start));
    stmts.push(eventStmt(now, null, 'week.planned', null, { week: start, notes }));
    await this.db.batch(stmts);
  }

  private async effortThrough(start: ISODate, inclusive: boolean): Promise<Map<number, number>> {
    const totals = new Map<number, number>((await this.members()).map((m) => [m.id, 0]));
    for (const r of await this.db.all<{ member_id: number; pts: number }>(
      `SELECT member_id, SUM(points) AS pts FROM assignments WHERE week_start ${inclusive ? '<=' : '<'} ? AND status IN ${COUNTS}
       AND member_id IS NOT NULL GROUP BY member_id`, start)) {
      totals.set(r.member_id, r.pts);
    }
    return totals;
  }

  async week(which: 'current' | 'next' | ISODate) {
    const today = await this.today();
    const current = weekStart(today);
    const start = which === 'current' ? current : which === 'next' ? addDays(current, 7) : weekStart(which);
    if (daysBetween(current, start) > 7) throw new HttpError(400, 'weeks are planned at most one week ahead');
    if (daysBetween(current, start) >= 0) await this.ensureWeek(start);
    const meta = await this.db.get<{ notes: string }>('SELECT notes FROM weeks WHERE start_date = ?', start);
    const all = await this.assignments('a.week_start = ?', start);
    const weekly = all.filter((a) => a.kind === 'weekly');
    const busy = new Set(weekly.map((a) => a.memberId));
    return {
      start, today, dates: weekDates(start), current: start === current,
      notes: meta ? (JSON.parse(meta.notes) as string[]) : [],
      weekly,
      trash: all.filter((a) => a.kind === 'trash'),
      free: (await this.members()).filter((m) => m.active && !busy.has(m.id)).map((m) => m.id),
    };
  }

  async assignments(where: string, ...params: unknown[]): Promise<AssignmentView[]> {
    return (await this.db.all<Row>(
      `SELECT a.*, d.name AS duty_name, d.icon, d.kind, m.name AS member_name, o.name AS original_name,
              (SELECT 1 FROM photos p WHERE p.assignment_id = a.id) AS has_photo
       FROM assignments a JOIN duties d ON d.id = a.duty_id
       LEFT JOIN members m ON m.id = a.member_id LEFT JOIN members o ON o.id = a.original_member_id
       WHERE ${where} ORDER BY a.date, d.id, a.slot`, ...params,
    )).map((r) => ({
      id: Number(r.id), weekStart: String(r.week_start), dutyId: Number(r.duty_id), dutyName: String(r.duty_name), icon: String(r.icon),
      kind: r.kind as 'weekly' | 'trash', slot: Number(r.slot), date: (r.date as string) || null,
      memberId: (r.member_id as number) ?? null, memberName: (r.member_name as string) ?? null,
      originalMemberId: (r.original_member_id as number) ?? null, originalMemberName: (r.original_name as string) ?? null,
      points: Number(r.points), status: r.status as Status, doneAt: (r.done_at as string) ?? null, hasPhoto: Boolean(r.has_photo),
    }));
  }

  async assignment(id: number): Promise<AssignmentView> {
    const a = (await this.assignments('a.id = ?', id))[0];
    if (!a) throw new HttpError(404, 'duty not found');
    return a;
  }

  // ---- doing and checking duties ---------------------------------------------

  async markDone(actorId: number, id: number): Promise<AssignmentView> {
    const a = await this.assignment(id);
    if (a.memberId !== actorId) throw new HttpError(403, 'this one is assigned to someone else');
    if (a.status !== 'pending') throw new HttpError(409, `already ${a.status}`);
    const today = await this.today();
    if (a.date && a.date > today) throw new HttpError(409, 'that trash day hasn\'t come yet');
    if (!a.date && a.weekStart > today) throw new HttpError(409, 'that week hasn\'t started yet');
    const now = this.iso();
    await this.db.batch([
      stmt("UPDATE assignments SET status = 'done', done_at = ? WHERE id = ? AND member_id = ? AND status = 'pending'", now, id, actorId),
      eventIfChanged(now, actorId, 'duty.done', id),
    ]);
    return this.assignment(id);
  }

  async confirm(actorId: number, id: number): Promise<AssignmentView> {
    const a = await this.assignment(id);
    if (a.status !== 'done') throw new HttpError(409, 'only finished duties can be confirmed');
    if (a.memberId === actorId) throw new HttpError(403, 'someone else has to confirm yours');
    const now = this.iso();
    await this.db.batch([
      stmt("UPDATE assignments SET status = 'confirmed' WHERE id = ? AND status = 'done'", id),
      eventIfChanged(now, actorId, 'duty.confirmed', id),
    ]);
    return this.assignment(id);
  }

  async flag(actorId: number, id: number, reason: string): Promise<{ assignment: AssignmentView; notify: Reminder }> {
    const a = await this.assignment(id);
    if (a.status !== 'done') throw new HttpError(409, 'only finished duties can be flagged');
    if (a.memberId === actorId) throw new HttpError(403, 'you can\'t flag your own duty');
    const text = String(reason ?? '').trim().slice(0, 200);
    if (!text) throw new HttpError(400, 'say what still needs doing');
    const now = this.iso();
    await this.db.batch([
      stmt("UPDATE assignments SET status = 'flagged' WHERE id = ? AND status = 'done'", id),
      eventIfChanged(now, actorId, 'duty.flagged', id, { reason: text }),
    ]);
    return {
      assignment: await this.assignment(id),
      notify: { key: `flag:${id}:${now}`, memberId: a.memberId!, title: `${cap(label(a))} was flagged`, body: `"${text}"`, url: '/' },
    };
  }

  async resolve(actorId: number, id: number, outcome: 'accept' | 'redo'): Promise<AssignmentView> {
    await this.requireAdmin(actorId);
    if (outcome !== 'accept' && outcome !== 'redo') throw new HttpError(400, 'outcome must be accept or redo');
    const now = this.iso();
    await this.db.batch([
      outcome === 'accept'
        ? stmt("UPDATE assignments SET status = 'confirmed' WHERE id = ? AND status = 'flagged'", id)
        : stmt("UPDATE assignments SET status = 'pending', done_at = NULL WHERE id = ? AND status = 'flagged'", id),
      eventIfChanged(now, actorId, outcome === 'accept' ? 'duty.flag_accepted' : 'duty.flag_redo', id),
    ]);
    return this.assignment(id);
  }

  /** An anonymous reminder: history records that it happened, not who sent it. */
  async nudge(actorId: number, id: number): Promise<Reminder> {
    const a = await this.assignment(id);
    if (a.status !== 'pending' || a.memberId === null) throw new HttpError(409, 'only open duties can be nudged');
    if (a.memberId === actorId) throw new HttpError(400, 'that one is yours');
    const last = await this.db.get<{ ts: string }>("SELECT ts FROM events WHERE type = 'duty.nudged' AND assignment_id = ? ORDER BY id DESC LIMIT 1", id);
    if (last && this.now().getTime() - Date.parse(last.ts) < NUDGE_COOLDOWN_MS) throw new HttpError(429, 'someone already nudged this today');
    const now = this.iso();
    await this.db.run('INSERT INTO events (ts, actor_id, type, assignment_id, detail) VALUES (?, NULL, ?, ?, ?)', now, 'duty.nudged', id, '{}');
    return { key: `nudge:${id}:${now}`, memberId: a.memberId, title: 'Friendly nudge', body: `${cap(label(a))} is still open.`, url: '/' };
  }

  async savePhoto(actorId: number, id: number, bytes: Uint8Array): Promise<AssignmentView> {
    const a = await this.assignment(id);
    if (a.memberId !== actorId) throw new HttpError(403, 'you can only add photos to your own duties');
    if (a.status !== 'done') throw new HttpError(409, 'mark it done first');
    if (bytes.length > MAX_PHOTO_BYTES) throw new HttpError(413, 'photo is too large');
    const mime = imageType(bytes);
    if (!mime) throw new HttpError(415, 'photo must be a JPEG, PNG or WebP image');
    const now = this.iso();
    await this.db.batch([
      stmt('INSERT INTO photos (assignment_id, mime, data, expires_at) VALUES (?, ?, ?, ?) ON CONFLICT(assignment_id) DO UPDATE SET mime = excluded.mime, data = excluded.data, expires_at = excluded.expires_at',
        id, mime, bytes, new Date(this.now().getTime() + PHOTO_TTL_MS).toISOString()),
      eventStmt(now, actorId, 'duty.photo_added', id),
    ]);
    return this.assignment(id);
  }

  async photo(id: number): Promise<{ mime: string; data: Uint8Array }> {
    const row = await this.db.get<{ mime: string; data: Uint8Array | ArrayBuffer }>('SELECT mime, data FROM photos WHERE assignment_id = ? AND expires_at > ?', id, this.iso());
    if (!row) throw new HttpError(404, 'no photo');
    return { mime: row.mime, data: row.data instanceof Uint8Array ? row.data : new Uint8Array(row.data as ArrayBuffer) };
  }

  // ---- swaps ---------------------------------------------------------------------

  async requestSwap(actorId: number, assignmentId: number, targetId: number, targetAssignmentId: number | null): Promise<{ swapId: number; notify: Reminder }> {
    const a = await this.assignment(assignmentId);
    if (a.memberId !== actorId) throw new HttpError(403, 'you can only swap your own duties');
    if (a.status !== 'pending') throw new HttpError(409, 'only open duties can be swapped');
    const target = await this.member(targetId);
    if (!target.active || targetId === actorId) throw new HttpError(400, 'pick another housemate');
    const duties = await this.duties();
    if (!eligible(duties, a.dutyId, targetId)) throw new HttpError(400, `${target.name} doesn't use ${a.dutyName}`);
    let b: AssignmentView | null = null;
    if (targetAssignmentId !== null) {
      b = await this.assignment(targetAssignmentId);
      if (b.memberId !== targetId || b.status !== 'pending') throw new HttpError(409, 'that duty isn\'t theirs to trade');
      if (!eligible(duties, b.dutyId, actorId)) throw new HttpError(400, `you don't use ${b.dutyName}`);
    }
    if (await this.db.get("SELECT 1 FROM swaps WHERE assignment_id = ? AND status = 'pending'", assignmentId)) {
      throw new HttpError(409, 'you already asked someone about this one');
    }
    const now = this.iso();
    const [ins] = await this.db.batch([
      stmt('INSERT INTO swaps (assignment_id, requester_id, target_id, target_assignment_id, created_at) VALUES (?, ?, ?, ?, ?)',
        assignmentId, actorId, targetId, targetAssignmentId, now),
      eventStmt(now, actorId, 'swap.requested', assignmentId, { to: target.name, trade: b ? label(b) : null }),
    ]);
    const me = await this.member(actorId);
    return {
      swapId: ins.lastId,
      notify: {
        key: `swap:${ins.lastId}`, memberId: targetId, title: `${me.name} wants to swap`, url: '/',
        body: b ? `Their ${label(a)} for your ${label(b)}. Tap to answer.` : `Can you take their ${label(a)}? Tap to answer.`,
      },
    };
  }

  async decideSwap(actorId: number, swapId: number, decision: 'accept' | 'decline' | 'cancel'): Promise<Reminder | null> {
    const s = await this.db.get<{ assignment_id: number; requester_id: number; target_id: number; target_assignment_id: number | null; status: string }>(
      'SELECT * FROM swaps WHERE id = ?', swapId);
    if (!s) throw new HttpError(404, 'swap not found');
    if (s.status !== 'pending') throw new HttpError(409, `this swap was already ${s.status}`);
    if (decision === 'cancel' ? actorId !== s.requester_id : actorId !== s.target_id) throw new HttpError(403, 'not your swap to decide');
    const a = await this.assignment(s.assignment_id);
    const b = s.target_assignment_id ? await this.assignment(s.target_assignment_id) : null;
    const now = this.iso();
    const status = { accept: 'accepted', decline: 'declined', cancel: 'cancelled' }[decision];
    const stmts: Stmt[] = [stmt("UPDATE swaps SET status = ?, decided_at = ? WHERE id = ? AND status = 'pending'", status, now, swapId)];
    if (decision === 'accept') {
      const stillValid = a.memberId === s.requester_id && a.status === 'pending' && (!b || (b.memberId === s.target_id && b.status === 'pending'));
      if (!stillValid) {
        await this.db.run("UPDATE swaps SET status = 'expired', decided_at = ? WHERE id = ?", now, swapId);
        throw new HttpError(409, 'those duties changed since the request, so it expired');
      }
      // Points move with the duty; original_member_id remembers who it was planned for.
      stmts.push(stmt("UPDATE assignments SET member_id = ?, original_member_id = COALESCE(original_member_id, ?) WHERE id = ? AND member_id = ? AND status = 'pending'",
        s.target_id, s.requester_id, a.id, s.requester_id));
      if (b) {
        stmts.push(stmt("UPDATE assignments SET member_id = ?, original_member_id = COALESCE(original_member_id, ?) WHERE id = ? AND member_id = ? AND status = 'pending'",
          s.requester_id, s.target_id, b.id, s.target_id));
      }
    }
    stmts.push(eventStmt(now, actorId, `swap.${status}`, a.id, b ? { trade: label(b) } : {}));
    await this.db.batch(stmts);
    if (decision === 'cancel') return null;
    const who = (await this.member(s.target_id)).name;
    return {
      key: `swap-result:${swapId}`, memberId: s.requester_id, url: '/',
      title: decision === 'accept' ? `${who} took your ${label(a)}` : `${who} can't swap this time`,
      body: decision === 'accept' ? 'The rota is updated.' : `Your ${label(a)} is still yours.`,
    };
  }

  async swaps(memberId: number) {
    const rows = await this.db.all<Row>(
      `SELECT s.*, r.name AS requester_name, t.name AS target_name FROM swaps s JOIN members r ON r.id = s.requester_id JOIN members t ON t.id = s.target_id
       WHERE (s.requester_id = ? OR s.target_id = ?) AND s.status = 'pending' ORDER BY s.id DESC`, memberId, memberId);
    const out = [];
    for (const r of rows) {
      out.push({
        id: Number(r.id),
        requester: { id: Number(r.requester_id), name: String(r.requester_name) },
        target: { id: Number(r.target_id), name: String(r.target_name) },
        assignment: await this.assignment(Number(r.assignment_id)),
        tradeFor: r.target_assignment_id ? await this.assignment(Number(r.target_assignment_id)) : null,
        createdAt: String(r.created_at),
      });
    }
    return out;
  }

  // ---- absences ------------------------------------------------------------------

  async addAbsence(actorId: number, memberId: number, startDate: string, endDate: string, note: string | null): Promise<string[]> {
    const actor = await this.member(actorId);
    if (memberId !== actorId && !actor.isAdmin) throw new HttpError(403, 'you can only add your own away dates');
    if (!isValidDate(startDate) || !isValidDate(endDate)) throw new HttpError(400, 'pick valid dates');
    if (endDate < startDate) throw new HttpError(400, 'the end is before the start');
    if (daysBetween(startDate, endDate) > 90) throw new HttpError(400, 'away periods are limited to 90 days');
    if (endDate < (await this.today())) throw new HttpError(400, 'that period is already over');
    const who = await this.member(memberId);
    await this.db.batch([
      stmt('INSERT INTO absences (member_id, start_date, end_date, note, created_at) VALUES (?, ?, ?, ?, ?)', memberId, startDate, endDate, note?.slice(0, 80) ?? null, this.iso()),
      eventStmt(this.iso(), actorId, 'member.away', null, { member: who.name, from: startDate, to: endDate }),
    ]);
    const changes: string[] = [];
    for (const w of await this.db.all<{ start_date: string }>('SELECT start_date FROM weeks WHERE start_date >= ? AND start_date <= ?', weekStart(startDate), endDate)) {
      changes.push(...(await this.rebalance(w.start_date, memberId)));
    }
    return changes;
  }

  async absences() {
    return this.db.all<Row>(
      `SELECT a.id, a.member_id AS memberId, m.name AS memberName, a.start_date AS startDate, a.end_date AS endDate, a.note
       FROM absences a JOIN members m ON m.id = a.member_id WHERE a.end_date >= ? ORDER BY a.start_date`, await this.today());
  }

  async removeAbsence(actorId: number, id: number): Promise<void> {
    const row = await this.db.get<{ member_id: number }>('SELECT member_id FROM absences WHERE id = ?', id);
    if (!row) throw new HttpError(404, 'not found');
    if (row.member_id !== actorId && !(await this.member(actorId)).isAdmin) throw new HttpError(403, 'not yours');
    await this.db.batch([
      stmt('DELETE FROM absences WHERE id = ?', id),
      eventStmt(this.iso(), actorId, 'member.away_removed', null, { member: (await this.member(row.member_id)).name }),
    ]);
  }

  private async isAway(memberId: number, date: ISODate): Promise<boolean> {
    return Boolean(await this.db.get('SELECT 1 FROM absences WHERE member_id = ? AND start_date <= ? AND end_date >= ?', memberId, date, date));
  }

  private async awayDays(memberId: number, start: ISODate): Promise<number> {
    let n = 0;
    for (const d of weekDates(start)) if (await this.isAway(memberId, d)) n++;
    return n;
  }

  /** Hands an away member's open duties in a planned week to someone fair. */
  private async rebalance(start: ISODate, memberId: number): Promise<string[]> {
    const changes: string[] = [];
    const members = (await this.members()).filter((m) => m.active);
    const order = members.map((m) => m.id);
    const today = await this.today();
    const now = this.iso();
    const awayName = (await this.member(memberId)).name;

    for (const a of await this.assignments("a.week_start = ? AND a.member_id = ? AND a.status = 'pending'", start, memberId)) {
      let pick: number | null;
      if (a.kind === 'trash') {
        if (!a.date || a.date < today || !(await this.isAway(memberId, a.date))) continue;
        const awayThatDay = new Set<number>();
        for (const id of order) if (await this.isAway(id, a.date)) awayThatDay.add(id);
        pick = coverFor(order, memberId, (id) => awayThatDay.has(id));
      } else {
        if ((await this.awayDays(memberId, start)) < AWAY_DAYS_FOR_WEEKLY) continue;
        // Prefer someone eligible who's home and has no weekly duty yet;
        // only double someone up if nobody else can.
        const duties = await this.duties();
        const weekly = await this.assignments("a.week_start = ? AND a.date = '' AND a.member_id IS NOT NULL", start);
        const busy = new Set(weekly.map((w) => w.memberId));
        const sameDuty = new Set(weekly.filter((w) => w.dutyId === a.dutyId).map((w) => w.memberId));
        const totals = await this.effortThrough(start, true);
        const candidates = [];
        for (const m of members) {
          if (m.id === memberId || !eligible(duties, a.dutyId, m.id) || sameDuty.has(m.id)) continue;
          if ((await this.awayDays(m.id, start)) >= AWAY_DAYS_FOR_WEEKLY) continue;
          candidates.push(m);
        }
        candidates.sort((x, y) => Number(busy.has(x.id)) - Number(busy.has(y.id)) || (totals.get(x.id) ?? 0) - (totals.get(y.id) ?? 0) || x.id - y.id);
        pick = candidates[0]?.id ?? null;
      }
      const pickName = pick === null ? null : members.find((m) => m.id === pick)!.name;
      await this.db.batch([
        stmt("UPDATE assignments SET member_id = ?, original_member_id = COALESCE(original_member_id, ?), status = ? WHERE id = ? AND status = 'pending'",
          pick, memberId, pick === null ? 'skipped' : 'pending', a.id),
        eventIfChanged(now, null, pick === null ? 'duty.skipped' : 'duty.covered', a.id, { away: awayName, cover: pickName }),
      ]);
      changes.push(pick === null ? `${label(a)}: nobody available` : `${label(a)} → ${pickName}`);
    }
    return changes;
  }

  // ---- votes and fairness ----------------------------------------------------------

  async vote(memberId: number, dutyId: number, score: number): Promise<void> {
    if (!Number.isInteger(score) || score < 1 || score > 5) throw new HttpError(400, 'score must be 1 to 5');
    if (!(await this.dutyRows()).some((d) => d.id === dutyId)) throw new HttpError(404, 'duty not found');
    await this.db.run('INSERT INTO votes (member_id, duty_id, score) VALUES (?, ?, ?) ON CONFLICT(member_id, duty_id) DO UPDATE SET score = excluded.score',
      memberId, dutyId, score);
  }

  async votes(memberId: number) {
    const mine = new Map((await this.db.all<{ duty_id: number; score: number }>('SELECT duty_id, score FROM votes WHERE member_id = ?', memberId)).map((r) => [r.duty_id, r.score]));
    const counts = new Map((await this.db.all<{ duty_id: number; n: number }>('SELECT duty_id, COUNT(*) AS n FROM votes GROUP BY duty_id')).map((r) => [r.duty_id, r.n]));
    return (await this.dutyRows()).map((d) => ({ ...d, myVote: mine.get(d.id) ?? null, votes: counts.get(d.id) ?? 0 }));
  }

  async fairness() {
    const rows = await this.db.all<{ member_id: number; status: string; n: number; pts: number }>(
      'SELECT member_id, status, COUNT(*) AS n, SUM(points) AS pts FROM assignments WHERE member_id IS NOT NULL GROUP BY member_id, status');
    const covered = new Map((await this.db.all<{ member_id: number; n: number }>(
      "SELECT member_id, COUNT(*) AS n FROM assignments WHERE original_member_id IS NOT NULL AND original_member_id != member_id AND status IN ('done', 'confirmed') GROUP BY member_id",
    )).map((r) => [r.member_id, r.n]));
    const members = (await this.memberRows()).filter((m) => m.active);
    return members.map((m) => {
      const mine = rows.filter((r) => r.member_id === m.id);
      const sum = (st: string[]) => round1(mine.filter((r) => st.includes(r.status)).reduce((a, r) => a + r.pts, 0));
      const count = (st: string[]) => mine.filter((r) => st.includes(r.status)).reduce((a, r) => a + r.n, 0);
      return {
        memberId: m.id, name: m.name, color: m.color,
        earned: sum(['done', 'confirmed']), planned: sum(['pending', 'flagged']),
        done: count(['done', 'confirmed']), missed: count(['missed']), covered: covered.get(m.id) ?? 0,
      };
    });
  }

  // ---- history ---------------------------------------------------------------------

  async history(limit = 60, before: number | null = null) {
    const rows = await this.db.all<Row>(
      `SELECT e.*, m.name AS actor_name, d.name AS duty_name, d.icon AS icon, a.date AS date
       FROM events e LEFT JOIN members m ON m.id = e.actor_id
       LEFT JOIN assignments a ON a.id = e.assignment_id LEFT JOIN duties d ON d.id = a.duty_id
       WHERE e.type NOT IN ('member.pin_changed') ${before ? 'AND e.id < ?' : ''} ORDER BY e.id DESC LIMIT ?`,
      ...(before ? [before, Math.min(limit, 100)] : [Math.min(limit, 100)]));
    return rows.map((r) => ({
      id: Number(r.id), ts: String(r.ts), actor: (r.actor_name as string) ?? null, type: String(r.type),
      what: r.duty_name ? (r.date ? `trash on ${WEEKDAY_NAMES[weekday(String(r.date))]}` : String(r.duty_name)) : null,
      icon: (r.icon as string) ?? null,
      detail: JSON.parse(String(r.detail)) as Row,
    }));
  }

  // ---- push subscriptions ----------------------------------------------------------

  async savePushSubscription(memberId: number, sub: { endpoint?: string; keys?: { p256dh?: string; auth?: string } }): Promise<void> {
    const endpoint = String(sub?.endpoint ?? '');
    const p256dh = String(sub?.keys?.p256dh ?? '');
    const auth = String(sub?.keys?.auth ?? '');
    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      throw new HttpError(400, 'invalid push subscription');
    }
    // Only real push services: stops the server being used to send requests anywhere.
    if (url.protocol !== 'https:' || !/^[A-Za-z0-9_-]{80,100}$/.test(p256dh) || !/^[A-Za-z0-9_-]{16,32}$/.test(auth)) {
      throw new HttpError(400, 'invalid push subscription');
    }
    await this.db.run(
      'INSERT INTO push_subscriptions (member_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET member_id = excluded.member_id, p256dh = excluded.p256dh, auth = excluded.auth',
      memberId, endpoint, p256dh, auth, this.iso());
  }

  async removePushSubscription(memberId: number, endpoint: string): Promise<void> {
    await this.db.run('DELETE FROM push_subscriptions WHERE member_id = ? AND endpoint = ?', memberId, String(endpoint ?? ''));
  }

  async pushSubscriptions(memberId: number) {
    return this.db.all<{ id: number; endpoint: string; p256dh: string; auth: string }>('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE member_id = ?', memberId);
  }

  // ---- background work ----------------------------------------------------------------

  /** Closes out deadlines, auto-confirms, expires photos and swaps. Safe to run any time. */
  async finalize(): Promise<void> {
    const today = await this.today();
    const now = this.iso();
    const missed = await this.db.all<{ id: number }>(
      `SELECT id FROM assignments WHERE status = 'pending' AND member_id IS NOT NULL AND ((date != '' AND date < ?) OR (date = '' AND date(week_start, '+6 days') < ?))`,
      today, today);
    const toConfirm = await this.db.all<{ id: number }>("SELECT id FROM assignments WHERE status = 'done' AND done_at <= ?",
      new Date(this.now().getTime() - CONFIRM_WINDOW_MS).toISOString());
    const stmts: Stmt[] = [];
    for (const a of missed) stmts.push(stmt("UPDATE assignments SET status = 'missed' WHERE id = ? AND status = 'pending'", a.id), eventIfChanged(now, null, 'duty.missed', a.id));
    for (const a of toConfirm) stmts.push(stmt("UPDATE assignments SET status = 'confirmed' WHERE id = ? AND status = 'done'", a.id), eventIfChanged(now, null, 'duty.auto_confirmed', a.id));
    stmts.push(stmt('DELETE FROM photos WHERE expires_at <= ?', now));
    stmts.push(stmt("UPDATE swaps SET status = 'expired', decided_at = ? WHERE status = 'pending' AND assignment_id IN (SELECT id FROM assignments WHERE status != 'pending')", now));
    stmts.push(stmt('DELETE FROM login_attempts WHERE window_start < ?', this.now().getTime() - 24 * H));
    await this.db.batch(stmts);
  }

  /** Reminders due now, each with a stable key so it's sent at most once. */
  async dueReminders(): Promise<Reminder[]> {
    const { timezone, reminderHour } = await this.settings();
    const t = localTime(timezone, this.now());
    const day = weekday(t.date);
    const start = weekStart(t.date);
    const out: Reminder[] = [];
    if (t.hour >= reminderHour) {
      for (const a of await this.assignments("a.date = ? AND a.status = 'pending' AND a.member_id IS NOT NULL", t.date)) {
        out.push({ key: `trash:${a.id}`, memberId: a.memberId!, title: 'Trash night', body: 'It\'s your turn tonight. Tap Done once it\'s out.', url: '/' });
      }
    }
    const open = () => this.assignments("a.week_start = ? AND a.date = '' AND a.status = 'pending' AND a.member_id IS NOT NULL", start);
    if (day === 4 && t.hour >= reminderHour) {
      for (const a of await open()) out.push({ key: `fri:${a.id}`, memberId: a.memberId!, title: `${a.dutyName} this weekend`, body: 'Due Sunday night.', url: '/' });
    }
    if (day === 6 && t.hour >= 12) {
      for (const a of await open()) out.push({ key: `sun:${a.id}`, memberId: a.memberId!, title: `${a.dutyName} is due tonight`, body: 'Tap Done when it\'s finished.', url: '/' });
    }
    if (day === 0 && t.hour >= 9) {
      const w = await this.week('current');
      for (const m of (await this.members()).filter((x) => x.active)) {
        const weekly = w.weekly.filter((a) => a.memberId === m.id).map((a) => `${a.dutyName}`);
        const trashDays = w.trash.filter((a) => a.memberId === m.id).map((a) => WEEKDAY_NAMES[weekday(a.date!)].slice(0, 3));
        const parts = [weekly.length ? weekly.join(' and ') : 'a week off from weekly duties', trashDays.length ? `trash on ${trashDays.join(' and ')}` : null].filter(Boolean);
        out.push({ key: `week:${start}:${m.id}`, memberId: m.id, title: 'Your week', body: parts.join(' · '), url: '/' });
      }
    }
    return out;
  }
}

// ---- helpers -------------------------------------------------------------------

export function label(a: Pick<AssignmentView, 'date' | 'dutyName'>): string {
  return a.date ? `trash on ${WEEKDAY_NAMES[weekday(a.date)]}` : a.dutyName;
}

function setting(key: string, value: string): Stmt {
  return stmt('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
}

function dutyInsert(name: string, icon: string, kind: 'weekly' | 'trash', slots: number, points: number, eligible: number[] | null): Stmt {
  return stmt('INSERT INTO duties (name, icon, kind, slots, default_points, eligible) VALUES (?, ?, ?, ?, ?, ?)', name, icon, kind, slots, points, eligible ? JSON.stringify(eligible) : null);
}

function eligible(duties: Duty[], dutyId: number, memberId: number): boolean {
  const d = duties.find((x) => x.id === dutyId);
  return Boolean(d) && (d!.eligible === null || d!.eligible.includes(memberId));
}

function imageType(b: Uint8Array): string | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  const ascii = (s: number, e: number) => String.fromCharCode(...b.slice(s, e));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
