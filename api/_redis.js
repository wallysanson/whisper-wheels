// Minimal Upstash Redis REST client (no dependencies).
// Finds the connection settings however Vercel named them:
//  - KV_REST_API_URL / KV_REST_API_TOKEN            (Vercel Marketplace "Upstash for Redis")
//  - UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN (Upstash's own names)
//  - any of the above with a custom prefix, e.g. STORAGE_KV_REST_API_URL
//  - or only a redis:// / rediss:// URL (REDIS_URL, KV_URL) pointing at Upstash
function findConfig() {
  const env = process.env;
  const keys = Object.keys(env);
  const pick = (suffixes) => {
    for (const s of suffixes) if (env[s]) return { key: s, value: env[s] };
    for (const s of suffixes) {
      const k = keys.find((k) => k.endsWith('_' + s) && env[k]);
      if (k) return { key: k, value: env[k] };
    }
    return null;
  };
  const url = pick(['KV_REST_API_URL', 'UPSTASH_REDIS_REST_URL']);
  const token = pick(['KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_TOKEN']);
  if (url && token) return { url: url.value, token: token.value, source: `${url.key} + ${token.key}` };

  // Fall back to a redis:// connection string (Upstash: REST host = same host, REST token = password)
  const conn = pick(['REDIS_URL', 'KV_URL']);
  if (conn) {
    try {
      const u = new URL(conn.value);
      if (u.hostname.endsWith('upstash.io') && u.password) {
        return { url: `https://${u.hostname}`, token: decodeURIComponent(u.password), source: conn.key };
      }
    } catch { /* ignore */ }
  }
  return null;
}

const CONFIG = findConfig();

export function redisConfigured() {
  return Boolean(CONFIG);
}

// Which setting names were used (never the values) — for troubleshooting.
export function redisSource() {
  if (CONFIG) return CONFIG.source;
  const names = Object.keys(process.env).filter((k) => /KV|REDIS|UPSTASH/i.test(k));
  return names.length ? `not usable; found: ${names.join(', ')}` : 'no database settings found';
}

// Run several commands in one round trip. Returns an array of results.
export async function pipeline(commands) {
  const res = await fetch(`${CONFIG.url.replace(/\/$/, '')}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${CONFIG.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error(`Redis HTTP ${res.status}`);
  const out = await res.json();
  return out.map((r) => {
    if (r.error) throw new Error(`Redis error: ${r.error}`);
    return r.result;
  });
}
