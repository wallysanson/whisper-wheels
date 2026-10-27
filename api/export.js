import { pipeline, redisConfigured, redisSource } from './_redis.js';

// Download all signups as CSV:  https://YOUR-DOMAIN/api/export?key=YOUR_EXPORT_KEY
// Check the database connection: add &format=health  ·  Just the total: add &format=count
// Set EXPORT_KEY in Vercel > Project > Settings > Environment Variables.
const COLS = ['email', 'created_at', 'source', 'country', 'region', 'city', 'referrer',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  'fbclid', 'ttclid', 'gclid', 'msclkid',
  'device', 'os', 'browser', 'in_app', 'screen', 'viewport', 'language', 'timezone',
  'landing_page', 'visit_count', 'seconds_on_page', 'scroll_depth',
  'first_visit_at', 'first_landing_page', 'first_referrer',
  'first_utm_source', 'first_utm_medium', 'first_utm_campaign', 'first_utm_content',
  'user_agent'];

const csvCell = (v) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@]/.test(s)) s = `'${s}`; // block spreadsheet formula injection
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const key = process.env.EXPORT_KEY;
  const given = String(req.headers['x-export-key'] || req.query.key || '');
  if (!key || key.length < 12 || given !== key) {
    return res.status(401).send('Unauthorized');
  }
  if (req.query.format === 'health') {
    let ping = 'skipped';
    if (redisConfigured()) {
      try { const [r] = await pipeline([['PING']]); ping = r; } catch (e) { ping = `error: ${e.message}`; }
    }
    return res.status(200).json({ database: redisSource(), ping });
  }
  if (!redisConfigured()) return res.status(500).send(`Storage not configured (${redisSource()})`);

  // Preorders recorded by /api/whop-webhook:  &type=orders  (with &format=count or &format=json)
  if (req.query.type === 'orders') {
    const OCOLS = ['payment_id', 'created_at', 'status', 'last_event', 'email', 'name', 'quantity',
      'total', 'currency', 'plan_id', 'shipping', 'metadata', 'updated_at'];
    const [ids] = await pipeline([['ZRANGE', 'ww:orders', '0', '-1']]);
    if (req.query.format === 'count') return res.status(200).json({ orders: ids.length });
    const orders = [];
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const results = await pipeline(chunk.map((id) => ['HGETALL', `ww:order:${id}`]));
      results.forEach((flat) => {
        const o = {};
        for (let k = 0; k < (flat || []).length; k += 2) o[flat[k]] = flat[k + 1];
        orders.push(Object.fromEntries(OCOLS.map((c) => [c, o[c] || ''])));
      });
    }
    if (req.query.format === 'json') return res.status(200).json({ orders });
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="whisper-wheels-orders-${date}.csv"`);
    return res.status(200).send([OCOLS.join(','), ...orders.map((o) => OCOLS.map((c) => csvCell(o[c])).join(','))].join('\n'));
  }

  const [emails] = await pipeline([['ZRANGE', 'ww:signups', '0', '-1']]);
  if (req.query.format === 'count') return res.status(200).json({ signups: emails.length });

  const records = [];
  for (let i = 0; i < emails.length; i += 500) {
    const chunk = emails.slice(i, i + 500);
    const results = await pipeline(chunk.map((e) => ['HGETALL', `ww:signup:${e}`]));
    results.forEach((flat, j) => {
      const o = {};
      for (let k = 0; k < (flat || []).length; k += 2) o[flat[k]] = flat[k + 1];
      if (!o.email) o.email = chunk[j];
      records.push(o);
    });
  }

  // Private dashboard (/dashboard) reads this
  if (req.query.format === 'json') {
    return res.status(200).json({ signups: records.map((o) => Object.fromEntries(COLS.map((c) => [c, o[c] || '']))) });
  }

  const rows = records.map((o) => COLS.map((c) => csvCell(o[c])).join(','));

  const date = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="whisper-wheels-signups-${date}.csv"`);
  return res.status(200).send([COLS.join(','), ...rows].join('\n'));
}
