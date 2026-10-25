import { pipeline, redisConfigured } from './_redis.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const RATE_LIMIT = 20; // signups per IP per hour
const clip = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');

// Rough device / OS / browser / in-app-browser from the user agent. Good enough for "where do signups come from".
function parseUA(ua) {
  const inApp = /Instagram/i.test(ua) ? 'Instagram'
    : /FBAN|FBAV|FB_IAB|FBIOS/i.test(ua) ? 'Facebook'
    : /musical_ly|TikTok|BytedanceWebview|trill/i.test(ua) ? 'TikTok'
    : /Snapchat/i.test(ua) ? 'Snapchat'
    : /Pinterest/i.test(ua) ? 'Pinterest'
    : /LinkedInApp/i.test(ua) ? 'LinkedIn'
    : /Twitter/i.test(ua) ? 'X' : '';
  const os = /iPhone|iPad|iPod/i.test(ua) ? 'iOS'
    : /Android/i.test(ua) ? 'Android'
    : /Windows/i.test(ua) ? 'Windows'
    : /Mac OS X|Macintosh/i.test(ua) ? 'macOS'
    : /CrOS/i.test(ua) ? 'ChromeOS'
    : /Linux/i.test(ua) ? 'Linux' : '';
  const device = /iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua)) ? 'tablet'
    : /Mobi|iPhone|iPod|Android/i.test(ua) ? 'mobile' : ua ? 'desktop' : '';
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /SamsungBrowser/.test(ua) ? 'Samsung'
    : /OPR\/|Opera/.test(ua) ? 'Opera'
    : /Firefox|FxiOS/.test(ua) ? 'Firefox'
    : /Chrome|CriOS/.test(ua) ? 'Chrome'
    : /Safari/.test(ua) ? 'Safari' : '';
  return { inApp, os, device, browser };
}

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
    const ctx = body.ctx && typeof body.ctx === 'object' ? body.ctx : {};
    const ft = ctx.first_utm && typeof ctx.first_utm === 'object' ? ctx.first_utm : {};
    const ua = String(req.headers['user-agent'] || '');
    const dev = parseUA(ua);
    const num = (v, max) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 0 ? String(Math.min(n, max)) : ''; };
    let city = String(req.headers['x-vercel-ip-city'] || '');
    try { city = decodeURIComponent(city); } catch {}
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
        'fbclid', clip(utm.fbclid, 200),
        'ttclid', clip(utm.ttclid, 200),
        'gclid', clip(utm.gclid, 200),
        'msclkid', clip(utm.msclkid, 200),
        'city', clip(city, 60),
        'device', dev.device,
        'os', dev.os,
        'browser', dev.browser,
        'in_app', dev.inApp,
        'user_agent', clip(ua, 300),
        'screen', clip(ctx.screen, 20),
        'viewport', clip(ctx.viewport, 20),
        'language', clip(ctx.language, 20),
        'timezone', clip(ctx.timezone, 50),
        'landing_page', clip(ctx.landing_page, 300),
        'visit_count', num(ctx.visit_count, 100000),
        'seconds_on_page', num(ctx.seconds_on_page, 86400),
        'scroll_depth', num(ctx.scroll_depth, 100),
        'first_visit_at', clip(ctx.first_visit_at, 30),
        'first_landing_page', clip(ctx.first_landing_page, 300),
        'first_referrer', clip(ctx.first_referrer, 200),
        'first_utm_source', clip(ft.utm_source, 100),
        'first_utm_medium', clip(ft.utm_medium, 100),
        'first_utm_campaign', clip(ft.utm_campaign, 100),
        'first_utm_content', clip(ft.utm_content, 100),
      ],
    ]);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Signup failed', err);
    return res.status(500).json({ ok: false, error: 'Something went wrong. Please try again in a moment.' });
  }
}
