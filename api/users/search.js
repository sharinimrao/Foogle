import { sql, requireDb } from '../_db.js';
import { requireAuth } from '../_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    requireDb();
    const user = await requireAuth(req, res);
    if (!user) return;

    const url = new URL(req.url, `http://${req.headers.host}`);
    const q = (url.searchParams.get('q') || '').trim();
    if (q.length < 2) return res.status(200).json({ users: [] });

    const { rows } = await sql`
      SELECT u.id, u.name,
        EXISTS(SELECT 1 FROM friendships f WHERE f.user_id = ${user.id} AND f.friend_id = u.id) AS "isFriend"
      FROM users u
      WHERE u.id != ${user.id} AND (u.name ILIKE ${'%' + q + '%'} OR u.email ILIKE ${'%' + q + '%'})
      ORDER BY u.name
      LIMIT 20
    `;
    return res.status(200).json({ users: rows });
  } catch (e) {
    console.error('User search error:', e);
    return res.status(e.statusCode || 500).json({ error: e.message });
  }
}
