import { pipeline, redisConfigured } from './_redis.js';

// Used by /order-confirmed to show the right message. Answers only "is this payment paid?",
// from the order copies /api/whop-webhook saves. Never returns personal details.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const id = String((req.query && req.query.payment) || '');
  if (!/^pay_[A-Za-z0-9]{6,40}$/.test(id)) return res.status(400).json({ ok: false });
  if (!redisConfigured()) return res.status(200).json({ ok: true, known: false });
  try {
    const [[lastEvent, status]] = await pipeline([['HMGET', `ww:order:${id}`, 'last_event', 'status']]);
    const known = Boolean(lastEvent || status);
    const paid = lastEvent === 'payment.succeeded' || /^(paid|succeeded)$/i.test(status || '');
    return res.status(200).json({ ok: true, known, paid });
  } catch (err) {
    console.error('order-status failed', err);
    return res.status(200).json({ ok: true, known: false });
  }
}
