// Shared local setup: a SQLite file plus generated secrets in ./data.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { nodeDb } from '../src/db-node.ts';
import { House } from '../src/house.ts';
import { generateVapidKeys, type VapidKeys } from '../src/push.ts';
import { randomToken } from '../src/security.ts';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const DATA = `${ROOT}data`;

export interface LocalSecrets {
  pepper: string;
  setupCode: string;
  vapid: VapidKeys;
}

export async function localSecrets(): Promise<LocalSecrets> {
  mkdirSync(DATA, { recursive: true });
  const path = `${DATA}/local-secrets.json`;
  if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8')) as LocalSecrets;
  const s: LocalSecrets = { pepper: randomToken(32), setupCode: randomToken(9), vapid: await generateVapidKeys('mailto:admin@example.com') };
  writeFileSync(path, JSON.stringify(s, null, 2), { mode: 0o600 });
  return s;
}

export async function localHouse(): Promise<{ house: House; secrets: LocalSecrets }> {
  const secrets = await localSecrets();
  const house = new House(nodeDb(`${DATA}/local.db`, `${ROOT}migrations`), { pepper: secrets.pepper });
  return { house, secrets };
}
