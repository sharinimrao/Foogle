import { createClient } from '@vercel/kv';

// The project's original Upstash/KV integration shows "Uninstalled" in
// Vercel but its stale KV_URL/KV_REST_API_* env vars are still present, so
// when a fresh Redis store was connected, Vercel auto-namespaced its vars as
// REDIS2_* to avoid colliding with the dead ones. Prefer those; fall back to
// the plain KV_* names in case the old integration is ever cleaned up and
// the naming reverts to normal.
const url = process.env.REDIS2_KV_REST_API_URL || process.env.KV_REST_API_URL;
const token = process.env.REDIS2_KV_REST_API_TOKEN || process.env.KV_REST_API_TOKEN;

export const kv = createClient({ url, token });
