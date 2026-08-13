import { sql, requireDb } from '../_db.js';
import { hashPassword, createSession, setSessionCookie } from '../_auth.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    requireDb();
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const email = (body.email || '').trim().toLowerCase();
    const password = body.password || '';
    const name = (body.name || '').trim();

    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email' });
    if (password.length < 8) return res.status(400).json({ error: 'Password needs at least 8 characters' });
    if (!name) return res.status(400).json({ error: 'Name is required' });

    const existing = await sql`SELECT id FROM users WHERE email = ${email}`;
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'An account with that email already exists' });
    }

    const passwordHash = await hashPassword(password);
    const { rows } = await sql`
      INSERT INTO users (email, name, auth_provider, password_hash)
      VALUES (${email}, ${name}, 'local', ${passwordHash})
      RETURNING id, email, name, auth_provider, created_at
    `;
    const user = rows[0];
    const sessionId = await createSession(user.id);
    setSessionCookie(res, sessionId);

    return res.status(200).json({ user });
  } catch (e) {
    console.error('Signup error:', e);
    return res.status(e.statusCode || 500).json({ error: e.message });
  }
}
