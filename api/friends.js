import { sql, requireDb } from './_db.js';
import { requireAuth } from './_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    requireDb();
    const user = await requireAuth(req, res);
    if (!user) return;

    const { rows } = await sql`
      SELECT u.id, u.name
      FROM friendships f JOIN users u ON u.id = f.friend_id
      WHERE f.user_id = ${user.id} AND f.status = 'accepted'
      ORDER BY u.name
    `;
    return res.status(200).json({ friends: rows });
  } catch (e) {
    console.error('Friends list error:', e);
    return res.status(e.statusCode || 500).json({ error: e.message });
  }
}
