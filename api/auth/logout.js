import { sql } from '../_db.js';
import { SESSION_COOKIE, parseCookies, clearSessionCookie } from '../_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const sessionId = parseCookies(req)[SESSION_COOKIE];
    if (sessionId) {
      await sql`DELETE FROM sessions WHERE id = ${sessionId}`;
    }
    clearSessionCookie(res);
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('Logout error:', e);
    clearSessionCookie(res);
    return res.status(200).json({ ok: true });
  }
}
