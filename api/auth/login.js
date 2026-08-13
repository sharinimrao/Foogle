import { sql, requireDb } from '../_db.js';
import { verifyPassword, createSession, setSessionCookie } from '../_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    requireDb();
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const email = (body.email || '').trim().toLowerCase();
    const password = body.password || '';

    const { rows } = await sql`SELECT * FROM users WHERE email = ${email}`;
    const user = rows[0];

    if (!user || user.auth_provider !== 'local') {
      return res.status(401).json({ error: user ? 'That account uses Google sign-in' : 'Wrong email or password' });
    }
    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Wrong email or password' });

    const sessionId = await createSession(user.id);
    setSessionCookie(res, sessionId);

    return res.status(200).json({ user: { id: user.id, email: user.email, name: user.name, auth_provider: user.auth_provider, created_at: user.created_at } });
  } catch (e) {
    console.error('Login error:', e);
    return res.status(e.statusCode || 500).json({ error: e.message });
  }
}
