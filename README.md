# Daily Spark

An installable Next.js PWA with a daily quote (from ZenQuotes) and pep talk, plus reminders delivered as push notifications, including on iPhone (iOS 16.4+, after adding to the Home Screen).

iOS PWAs can't schedule notifications on the device, so reminders are stored on the server and an external cron calls `/api/cron` every minute to send the ones that are due.

## Local development

```bash
npm install
cp .env.example .env.local   # then fill in the values (see below)
npm run dev -- --experimental-https
```

- Push needs HTTPS, hence `--experimental-https`.
- Without Upstash env vars, data is kept in memory and lost on restart.
- In dev, `src/instrumentation.ts` checks for due reminders every 15 seconds, so no cron is needed.

### Environment variables

| Variable | What it is |
|---|---|
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Generate with `npx web-push generate-vapid-keys` |
| `VAPID_SUBJECT` | Contact for push services, e.g. `mailto:you@example.com` |
| `CRON_SECRET` | Any long random string; protects `/api/cron` |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Free Upstash Redis database ([console.upstash.com](https://console.upstash.com)) |

## Deploying (free)

1. Push this repo to GitHub and import it on [Vercel](https://vercel.com) (Hobby plan).
2. Add the environment variables above in the Vercel project settings.
3. Create a free job on [cron-job.org](https://cron-job.org) that runs **every minute** and calls
   `https://<your-app>.vercel.app/api/cron` with the header `Authorization: Bearer <CRON_SECRET>`.
   Vercel's built-in cron only runs once a day on the Hobby plan, which is too coarse for reminders.

## Installing on iPhone

1. Open the app's URL in **Safari**.
2. Tap **Share → Add to Home Screen**.
3. Open **Daily Spark** from the Home Screen and tap **Enable notifications**.

Notifications don't work from a normal Safari tab, only from the Home Screen app.

## Layout

- `src/app/app-shell.tsx`: header and bottom tab bar
- `src/app/today.tsx`: daily quote and pep talk screen
- `src/app/api/daily/route.ts`: returns the day's quote and pep talk
- `src/lib/daily.ts`: fetches quotes from ZenQuotes (cached), falls back to `src/lib/quotes.ts`
- `src/app/reminders-app.tsx`: client UI (enable notifications, schedule, list, delete)
- `src/app/actions.ts`: server actions
- `src/app/api/cron/route.ts`: sends due reminders (called by cron)
- `src/lib/push.ts`: web-push sending and rescheduling
- `src/lib/store.ts`: Upstash Redis storage with an in-memory fallback
- `public/sw.js`: service worker that shows notifications
- `src/app/manifest.ts`: web app manifest
- `scripts/generate-icons.mjs`: regenerates the PNG icons in `public/`
