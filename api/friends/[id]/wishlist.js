import { sql, requireDb } from '../../_db.js';
import { requireAuth } from '../../_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    requireDb();
    const user = await requireAuth(req, res);
    if (!user) return;

    const url = new URL(req.url, `http://${req.headers.host}`);
    const parts = url.pathname.split('/').filter(Boolean); // ['api','friends',':id','wishlist']
    const friendId = parts[2];

    const friendship = await sql`
      SELECT 1 FROM friendships WHERE user_id = ${user.id} AND friend_id = ${friendId} AND status = 'accepted'
    `;
    if (friendship.rows.length === 0) return res.status(403).json({ error: 'Not friends with this user' });

    const friend = await sql`SELECT id, name FROM users WHERE id = ${friendId}`;
    if (friend.rows.length === 0) return res.status(404).json({ error: 'User not found' });

    const { rows } = await sql`
      SELECT id, restaurant_name AS name, cuisine, price AS "priceLevel", city AS neighborhood, added_at
      FROM wish_list WHERE user_id = ${friendId} ORDER BY added_at DESC
    `;
    return res.status(200).json({ friend: friend.rows[0], places: rows });
  } catch (e) {
    console.error('Friend wishlist error:', e);
    return res.status(e.statusCode || 500).json({ error: e.message });
  }
}
