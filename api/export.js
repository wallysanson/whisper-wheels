import { pipeline, redisConfigured, redisSource } from './_redis.js';

// Download all signups as CSV:  https://YOUR-DOMAIN/api/export?key=YOUR_EXPORT_KEY
// Check the database connection: add &format=health  ·  Just the total: add &format=count
// Set EXPORT_KEY in Vercel > Project > Settings > Environment Variables.
const COLS = ['email', 'created_at', 'source', 'country', 'region', 'referrer',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

const csvCell = (v) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@]/.test(s)) s = `'${s}`; // block spreadsheet formula injection
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const key = process.env.EXPORT_KEY;
  if (!key || key.length < 12 || req.query.key !== key) {
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

  const [emails] = await pipeline([['ZRANGE', 'ww:signups', '0', '-1']]);
  if (req.query.format === 'count') return res.status(200).json({ signups: emails.length });

  const rows = [];
  for (let i = 0; i < emails.length; i += 500) {
    const chunk = emails.slice(i, i + 500);
    const results = await pipeline(chunk.map((e) => ['HGETALL', `ww:signup:${e}`]));
    results.forEach((flat, j) => {
      const o = {};
      for (let k = 0; k < (flat || []).length; k += 2) o[flat[k]] = flat[k + 1];
      if (!o.email) o.email = chunk[j];
      rows.push(COLS.map((c) => csvCell(o[c])).join(','));
    });
  }

  const date = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="whisper-wheels-signups-${date}.csv"`);
  return res.status(200).send([COLS.join(','), ...rows].join('\n'));
}
