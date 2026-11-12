# Deploying House Rota (free, about 15 minutes)

House Rota runs on Cloudflare's free plan: Workers for the server, D1 for the database, Static Assets for the app, and a Cron Trigger for reminders. No credit card is needed. Commands below work in PowerShell, Terminal or Git Bash.

## 0. Try it locally first (optional)

```powershell
npm install
npm run demo      # a sample house; everyone's PIN is 246810
npm run build
npm run local     # http://localhost:8787
```

Delete the `data` folder to start over. To try the real first-run setup locally instead of the demo, skip `npm run demo`; the terminal prints a setup code.

## 1. Sign in to Cloudflare

```powershell
npm install
npx wrangler login
```

This opens the browser. Create a free account if you don't have one.

## 2. Create the database

```powershell
npm run cf:db:create
```

Copy the `database_id` it prints into `wrangler.jsonc`, replacing `REPLACE_WITH_YOUR_DATABASE_ID`. Then create the tables:

```powershell
npm run cf:db:migrate
```

## 3. Deploy

```powershell
npm run deploy
```

It prints your app's address, like `https://house-rota.YOUR-NAME.workers.dev`.

## 4. Add the secrets

```powershell
npm run secrets -- you@example.com
```

This prints five commands, each with a value. Run each `npx wrangler secret put ...` command and paste its value when asked. Keep the `SETUP_CODE`; you need it in the next step. Never commit these values.

| Secret | What it does |
|---|---|
| `PIN_PEPPER` | Secret key mixed into PIN hashes, so a leaked database can't be brute-forced |
| `SETUP_CODE` | One-time code that lets only you create the house |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_JWK` | Sign push notifications so browsers trust them |
| `VAPID_SUBJECT` | A contact address push services can reach if something goes wrong |

## 5. Set up your house

Open your app's address, enter the setup code, and follow the steps: house name, your name and PIN, your housemates, who uses each washroom, and how many people do the kitchen.

## 6. Invite everyone

In the app, go to **Me → People & invites** and tap **Invite** next to each person. Their link opens WhatsApp's share sheet (or is copied). Each link works once, for 7 days.

## 7. Each person installs the app and turns on reminders

**iPhone (Safari, iOS 16.4 or newer):** open the link, choose a PIN, tap the Share button, then **Add to Home Screen**. Open Rota from the Home Screen, go to **Me → Reminders** and turn them on. iPhones only allow notifications for apps added to the Home Screen.

**Android (Chrome):** open the link, choose a PIN, tap **Install app** when Chrome offers it (or menu → Add to Home screen), then **Me → Reminders**.

## Updating, logs and limits

- Update after code changes: `npm run deploy`. Add any new file in `migrations/` with `npm run cf:db:migrate` first.
- Live logs: `npx wrangler tail`.
- Free plan headroom: a house of 6 uses a tiny fraction of the daily request and database limits. The reminder job runs every 15 minutes.
- Back up the database: `npx wrangler d1 export house-rota --remote --output backup.sql`.
