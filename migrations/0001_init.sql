-- House Rota schema. Applied with: npx wrangler d1 migrations apply house-rota --remote

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE members (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  color       TEXT NOT NULL,
  pin_hash    TEXT,               -- NULL until they accept their invite
  is_admin    INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  trash_order INTEGER NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE invites (
  token_hash TEXT PRIMARY KEY,
  member_id  INTEGER NOT NULL REFERENCES members(id),
  expires_at TEXT NOT NULL,
  used_at    TEXT
);

CREATE TABLE duties (
  id             INTEGER PRIMARY KEY,
  name           TEXT NOT NULL UNIQUE,
  icon           TEXT NOT NULL DEFAULT 'sparkles',
  kind           TEXT NOT NULL CHECK (kind IN ('weekly', 'trash')),
  slots          INTEGER NOT NULL DEFAULT 1 CHECK (slots BETWEEN 1 AND 4),
  default_points REAL NOT NULL,
  eligible       TEXT,            -- JSON array of member ids; NULL means everyone
  active         INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE votes (
  member_id INTEGER NOT NULL REFERENCES members(id),
  duty_id   INTEGER NOT NULL REFERENCES duties(id),
  score     INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
  PRIMARY KEY (member_id, duty_id)
);

CREATE TABLE absences (
  id         INTEGER PRIMARY KEY,
  member_id  INTEGER NOT NULL REFERENCES members(id),
  start_date TEXT NOT NULL,
  end_date   TEXT NOT NULL,
  note       TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE weeks (
  start_date   TEXT PRIMARY KEY,
  generated_at TEXT NOT NULL,
  notes        TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE assignments (
  id                 INTEGER PRIMARY KEY,
  week_start         TEXT NOT NULL,
  duty_id            INTEGER NOT NULL REFERENCES duties(id),
  slot               INTEGER NOT NULL DEFAULT 0,
  date               TEXT NOT NULL DEFAULT '',  -- the day for trash; '' for weekly duties
  member_id          INTEGER REFERENCES members(id),
  original_member_id INTEGER REFERENCES members(id),
  points             REAL NOT NULL,
  status             TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'done', 'confirmed', 'flagged', 'missed', 'skipped')),
  done_at            TEXT,
  UNIQUE (week_start, duty_id, slot, date)
);
CREATE INDEX ix_assignments_member ON assignments(member_id, week_start);
CREATE INDEX ix_assignments_status ON assignments(status);

CREATE TABLE photos (
  assignment_id INTEGER PRIMARY KEY REFERENCES assignments(id),
  mime          TEXT NOT NULL,
  data          BLOB NOT NULL,
  expires_at    TEXT NOT NULL
);

CREATE TABLE swaps (
  id                   INTEGER PRIMARY KEY,
  assignment_id        INTEGER NOT NULL REFERENCES assignments(id),
  requester_id         INTEGER NOT NULL REFERENCES members(id),
  target_id            INTEGER NOT NULL REFERENCES members(id),
  target_assignment_id INTEGER REFERENCES assignments(id),
  status               TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  created_at           TEXT NOT NULL,
  decided_at           TEXT
);

-- Append-only history: the app can add to it but never rewrite it.
CREATE TABLE events (
  id            INTEGER PRIMARY KEY,
  ts            TEXT NOT NULL,
  actor_id      INTEGER,
  type          TEXT NOT NULL,
  assignment_id INTEGER,
  detail        TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX ix_events_assignment ON events(assignment_id, type);
CREATE TRIGGER events_no_update BEFORE UPDATE ON events
  BEGIN SELECT RAISE(ABORT, 'history is append-only'); END;
CREATE TRIGGER events_no_delete BEFORE DELETE ON events
  BEGIN SELECT RAISE(ABORT, 'history is append-only'); END;

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  member_id  INTEGER NOT NULL REFERENCES members(id),
  expires_at TEXT NOT NULL
);

-- Rate limits live in the database: Workers run in many isolates that
-- don't share memory.
CREATE TABLE login_attempts (
  key          TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL
);

CREATE TABLE push_subscriptions (
  id         INTEGER PRIMARY KEY,
  member_id  INTEGER NOT NULL REFERENCES members(id),
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE notifications (
  key       TEXT PRIMARY KEY,   -- makes every reminder idempotent
  member_id INTEGER NOT NULL,
  title     TEXT NOT NULL,
  body      TEXT NOT NULL,
  status    TEXT NOT NULL,
  error     TEXT,
  sent_at   TEXT NOT NULL
);
