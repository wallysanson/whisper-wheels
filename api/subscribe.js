import { pipeline, redisConfigured } from './_redis.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const RATE_LIMIT = 20; // signups per IP per hour
const clip = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};

  // Honeypot: real visitors never fill the hidden "website" field.
  if (body.website) return res.status(200).json({ ok: true });

  const email = clip(body.email, 254).trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ ok: false, error: 'Please enter a valid email address.' });
  }

  if (!redisConfigured()) {
    console.error('Signup storage not configured: add Upstash for Redis in Vercel > Storage.');
    return res.status(500).json({ ok: false, error: 'Signups are temporarily unavailable. Please try again later.' });
  }

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';

  try {
    const [count] = await pipeline([
      ['INCR', `ww:rl:${ip}`],
      ['EXPIRE', `ww:rl:${ip}`, '3600', 'NX'],
    ]);
    if (count > RATE_LIMIT) {
      return res.status(429).json({ ok: false, error: 'Too many attempts. Please try again later.' });
    }

    const [added] = await pipeline([['SADD', 'ww:emails', email]]);
    if (added === 0) return res.status(200).json({ ok: true, already: true });

    const utm = body.utm && typeof body.utm === 'object' ? body.utm : {};
    const now = Date.now();
    await pipeline([
      ['ZADD', 'ww:signups', String(now), email],
      ['HSET', `ww:signup:${email}`,
        'email', email,
        'created_at', new Date(now).toISOString(),
        'source', clip(body.source, 40),
        'referrer', clip(body.referrer, 200),
        'country', clip(String(req.headers['x-vercel-ip-country'] || ''), 8),
        'region', clip(String(req.headers['x-vercel-ip-country-region'] || ''), 16),
        'utm_source', clip(utm.utm_source, 100),
        'utm_medium', clip(utm.utm_medium, 100),
        'utm_campaign', clip(utm.utm_campaign, 100),
        'utm_content', clip(utm.utm_content, 100),
        'utm_term', clip(utm.utm_term, 100),
      ],
    ]);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Signup failed', err);
    return res.status(500).json({ ok: false, error: 'Something went wrong. Please try again in a moment.' });
  }
}
