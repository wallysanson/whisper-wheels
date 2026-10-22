# Whisper Wheels

Coming-soon landing page for Whisper Wheels — "Make Trash Day Quieter."

- `index.html` — landing page (static, no build step)
- `privacy.html` — privacy policy
- `api/subscribe.js` — saves early-access signups to Upstash Redis
- `api/export.js` — download signups as CSV: `/api/export?key=EXPORT_KEY` (add `&format=count` for the total, or `&format=health` to check the database connection)

## Deploy (Vercel)
1. Import this repo in Vercel and deploy (no settings to change).
2. Storage → Create Database → Upstash for Redis → connect to this project.
3. Settings → Environment Variables → add `EXPORT_KEY` (a long secret).
4. Redeploy.
