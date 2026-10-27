import crypto from 'node:crypto';
import { pipeline, redisConfigured } from './_redis.js';

// Receives Whop webhooks and records preorders in the same Redis database as the email list.
// Setup: Whop dashboard → Developer → Webhooks → add https://whisperwheels.shop/api/whop-webhook
// with the payment events selected, then copy its secret into Vercel as WHOP_WEBHOOK_SECRET.
// Whop's own dashboard stays the source of truth for orders; this copy powers /api/export?type=orders.

export const config = { api: { bodyParser: false } };

const TOLERANCE_S = 5 * 60;

function readRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Whop signs `${webhook-id}.${webhook-timestamp}.${raw body}` with HMAC-SHA256 (base64),
// sent as "v1,<sig>" (several may be space-separated). Whop's docs say to use the secret exactly
// as given; standard-webhooks libraries base64-decode the part after the prefix. Accept either.
export function verifySignature(secret, headers, raw) {
  const id = headers['webhook-id'];
  const ts = headers['webhook-timestamp'];
  const sigHeader = headers['webhook-signature'];
  if (!secret || !id || !ts || !sigHeader) return false;
  const age = Math.abs(Date.now() / 1000 - Number(ts));
  if (!Number.isFinite(age) || age > TOLERANCE_S) return false;

  const payload = Buffer.concat([Buffer.from(`${id}.${ts}.`), raw]);
  const keys = [Buffer.from(secret, 'utf8')];
  const tail = secret.includes('_') ? secret.slice(secret.indexOf('_') + 1) : secret;
  try { const b = Buffer.from(tail, 'base64'); if (b.length) keys.push(b); } catch {}

  const given = String(sigHeader).split(' ').map((s) => s.split(',')[1]).filter(Boolean);
  for (const key of keys) {
    const expected = crypto.createHmac('sha256', key).update(payload).digest();
    for (const g of given) {
      const buf = Buffer.from(g, 'base64');
      if (buf.length === expected.length && crypto.timingSafeEqual(buf, expected)) return true;
    }
  }
  return false;
}

const str = (v, n = 200) => (v == null ? '' : String(typeof v === 'object' ? JSON.stringify(v) : v).slice(0, n));
const first = (...vals) => vals.find((v) => v !== undefined && v !== null && v !== '');

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false });
  }

  const raw = await readRaw(req);
  if (!verifySignature(process.env.WHOP_WEBHOOK_SECRET, req.headers, raw)) {
    return res.status(401).json({ ok: false, error: 'Bad signature' });
  }

  let event;
  try { event = JSON.parse(raw.toString('utf8')); } catch { return res.status(400).json({ ok: false }); }
  const type = String(event.type || event.action || '');
  const p = event.data || {};
  if (!/^payment\./.test(type) || !p.id) return res.status(200).json({ ok: true, ignored: type });

  if (!redisConfigured()) {
    console.error('Order received but storage not configured', type, p.id);
    return res.status(500).json({ ok: false }); // Whop will retry
  }

  const key = `ww:order:${p.id}`;
  const user = p.user || p.member || {};
  const fields = {
    payment_id: str(p.id, 60),
    last_event: type,
    status: str(first(p.status, type.replace('payment.', '')), 40),
    updated_at: new Date().toISOString(),
  };
  if (type === 'payment.succeeded') {
    Object.assign(fields, {
      created_at: str(first(p.paid_at, p.created_at, event.timestamp, fields.updated_at), 40),
      email: str(first(p.email, user.email, p.billing_email), 254),
      name: str(first(user.name, p.billing_name), 120),
      total: str(first(p.final_amount, p.total, p.amount, p.subtotal), 20),
      currency: str(p.currency, 8),
      quantity: str(first(p.quantity, p.metadata && p.metadata.quantity), 8),
      plan_id: str(first(p.plan && p.plan.id, p.plan_id), 60),
      metadata: str(p.metadata, 1000),
      shipping: str(first(p.shipping_address, p.shipping, p.custom_field_responses), 1000),
    });
  }

  try {
    await pipeline([
      ['ZADD', 'ww:orders', 'NX', String(Date.now()), p.id],
      ['HSET', key, ...Object.entries(fields).flat()],
    ]);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Order save failed', err);
    return res.status(500).json({ ok: false });
  }
}
