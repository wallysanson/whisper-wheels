// Minimal Upstash Redis REST client (no dependencies).
// Works with the env vars Vercel injects when you add "Upstash for Redis"
// from the Vercel Marketplace (KV_REST_API_*), or Upstash's own names.
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

export function redisConfigured() {
  return Boolean(URL_ && TOKEN);
}

// Run several commands in one round trip. Returns an array of results.
export async function pipeline(commands) {
  const res = await fetch(`${URL_.replace(/\/$/, '')}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error(`Redis HTTP ${res.status}`);
  const out = await res.json();
  return out.map((r) => {
    if (r.error) throw new Error(`Redis error: ${r.error}`);
    return r.result;
  });
}
