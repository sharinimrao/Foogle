import { sql } from '@vercel/postgres';

// @vercel/postgres reads POSTGRES_URL (etc.) lazily per-query, so there's
// nothing to eagerly instantiate here — just re-export the tagged template
// with a clearer error if the Postgres integration isn't connected yet.
export { sql };

export function requireDb() {
  if (!process.env.POSTGRES_URL) {
    const err = new Error('Postgres is not connected yet — connect the Postgres/Neon integration in the Vercel dashboard.');
    err.statusCode = 503;
    throw err;
  }
}
