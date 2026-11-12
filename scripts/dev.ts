// Run the whole app locally on Node, without Cloudflare:
//   npm run build && npm run local     ->  http://localhost:8787
// Uses ./data/local.db and generated secrets in ./data/local-secrets.json.

import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { handleApi, SECURITY_HEADERS } from '../src/api.ts';
import { tick } from '../src/notify.ts';
import { localHouse, ROOT } from './local.ts';

const PORT = Number(process.env.PORT ?? 8787);
const DIST = join(ROOT, 'web', 'dist');
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.ico': 'image/x-icon',
};

const { house, secrets } = await localHouse();
if (!(await house.isSetUp())) console.log(`\nFirst run: open the app and use setup code ${secrets.setupCode}\n`);

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  if (url.pathname.startsWith('/api/')) {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
    const request = new Request(url, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method ?? 'GET') ? undefined : Buffer.concat(chunks) });
    const response = await handleApi(request, { house, setupCode: secrets.setupCode, vapid: secrets.vapid, waitUntil: (p) => void p.catch(console.error) });
    const out: Record<string, string | string[]> = {};
    response.headers.forEach((v, k) => { out[k] = k === 'set-cookie' ? [...(out[k] as string[] ?? []), v] : v; });
    res.writeHead(response.status, out);
    res.end(Buffer.from(await response.arrayBuffer()));
    return;
  }
  // Static files with a single-page-app fallback, like Workers Static Assets.
  const requested = join(DIST, normalize(decodeURIComponent(url.pathname)));
  const isFile = requested.startsWith(DIST) && existsSync(requested) && statSync(requested).isFile();
  const file = isFile ? requested : join(DIST, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(503, { 'Content-Type': 'text/plain' });
    res.end('Build the app first: npm run build');
    return;
  }
  res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
  res.end(readFileSync(file));
});

server.listen(PORT, () => console.log(`House Rota running locally at http://localhost:${PORT}`));
setInterval(() => tick(house, secrets.vapid).catch(console.error), 60_000);
