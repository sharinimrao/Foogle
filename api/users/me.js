import { sql, requireDb } from '../_db.js';
import { requireAuth } from '../_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });

  try {
    requireDb();
    const user = await requireAuth(req, res);
    if (!user) return;

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const name = (body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Name is required' });

    const { rows } = await sql`
      UPDATE users SET name = ${name} WHERE id = ${user.id}
      RETURNING id, email, name, auth_provider, created_at
    `;
    return res.status(200).json({ user: rows[0] });
  } catch (e) {
    console.error('Update profile error:', e);
    return res.status(e.statusCode || 500).json({ error: e.message });
  }
}
