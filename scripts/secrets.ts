// npm run secrets: generates the production secrets and prints how to store
// them in Cloudflare. Run once; keep the output private.
import { generateVapidKeys } from '../src/push.ts';
import { randomToken } from '../src/security.ts';

const contact = process.argv[2] ?? 'mailto:admin@example.com';
const vapid = await generateVapidKeys(contact.startsWith('mailto:') || contact.startsWith('https:') ? contact : `mailto:${contact}`);
const values: Record<string, string> = {
  PIN_PEPPER: randomToken(32),
  SETUP_CODE: randomToken(9),
  VAPID_PUBLIC_KEY: vapid.publicKey,
  VAPID_PRIVATE_JWK: JSON.stringify(vapid.privateJwk),
  VAPID_SUBJECT: vapid.subject,
};
console.log('Run each of these and paste the value when asked:\n');
for (const [k, v] of Object.entries(values)) console.log(`npx wrangler secret put ${k}\n  ${v}\n`);
console.log('Keep SETUP_CODE handy: you enter it once when you open the app for the first time.');
