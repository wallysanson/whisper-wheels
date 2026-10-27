# Whisper Wheels

Store for Whisper Wheels — "Make Trash Day Silent." Static site on Vercel, preorders paid through Whop.

- `index.html` — homepage
- `shop.html` — product page with quantity picker and embedded Whop checkout (`/shop`)
- `order-confirmed.html` — where Whop sends buyers after paying (`/order-confirmed`)
- `shipping-returns.html`, `terms.html`, `privacy.html`, `contact.html` — policy pages
- `shop-config.js` — **store settings: Whop plan ID, price, max kits per order, shipping text**
- `assets/shop.css` — shared styles for the shop and policy pages (same tokens as the homepage)
- `api/subscribe.js` — email-list signups → Upstash Redis
- `api/whop-webhook.js` — records paid orders from Whop → Upstash Redis
- `api/export.js` — signups CSV: `/api/export?key=EXPORT_KEY`; orders CSV: add `&type=orders` (`&format=count` for totals, `&format=health` to check the database)

## Turning on checkout (Whop)
1. Done: product "Whisper Wheels Sound-Dampening Band Kit" (`prod_hcXM78XgFOJJv`), pricing option "2-pack kit" (`plan_F5v6fUW7QfOIm`) — one-time $29.99, more than one per order allowed, "Collect shipping address" on. Sales tax is collected by Whop at checkout (exclusive).
2. Done: that plan ID is in `whopPlanId` in `shop-config.js`. If you change the price in Whop, change `price` there too.
3. Whop → Developer → Webhooks → Done: webhook "Whisper Wheels orders" → `https://www.whisperwheels.shop/api/whop-webhook` (www — the bare domain redirects), event `payment.succeeded`. Copy its secret (starts `ws_`).
4. Vercel → Settings → Environment Variables → add `WHOP_WEBHOOK_SECRET` with that secret. Redeploy.
5. Place a test order and check it shows in Whop and in `/api/export?key=…&type=orders`.

Until a plan ID is set, `/shop` shows "preorders open shortly" with an email signup instead of checkout.

## Deploy (Vercel)
1. Import this repo in Vercel and deploy (no settings to change).
2. Storage → Create Database → Upstash for Redis → connect to this project.
3. Settings → Environment Variables → add `EXPORT_KEY` (a long secret) and `WHOP_WEBHOOK_SECRET`.
4. Redeploy.
