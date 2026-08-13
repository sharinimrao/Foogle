// Consolidated: GET /api/friends, POST /api/friends/add,
// GET /api/friends/:id/wishlist — one function (dispatched by ?action=/?id=)
// to stay under the Hobby plan's 12-function deployment cap.
import { sql, requireDb } from './_db.js';
import { requireAuth } from './_auth.js';

export default async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const action = url.searchParams.get('action');

  if (action === 'add') return handleAdd(req, res);
  if (action === 'wishlist') return handleFriendWishlist(req, res, url.searchParams.get('id'));
  return handleList(req, res);
}

async function handleList(req, res) {
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

// No request/approval flow yet (no Figma screen for a request inbox) — adding
// a friend writes both directions as 'accepted' immediately.
async function handleAdd(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    requireDb();
    const user = await requireAuth(req, res);
    if (!user) return;

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const friendId = body.friendId;
    if (!friendId || friendId === user.id) return res.status(400).json({ error: 'Invalid friend id' });

    const target = await sql`SELECT id, name FROM users WHERE id = ${friendId}`;
    if (target.rows.length === 0) return res.status(404).json({ error: 'User not found' });

    await sql`
      INSERT INTO friendships (user_id, friend_id, status) VALUES (${user.id}, ${friendId}, 'accepted')
      ON CONFLICT (user_id, friend_id) DO UPDATE SET status = 'accepted'
    `;
    await sql`
      INSERT INTO friendships (user_id, friend_id, status) VALUES (${friendId}, ${user.id}, 'accepted')
      ON CONFLICT (user_id, friend_id) DO UPDATE SET status = 'accepted'
    `;
    return res.status(200).json({ friend: target.rows[0] });
  } catch (e) {
    console.error('Add friend error:', e);
    return res.status(e.statusCode || 500).json({ error: e.message });
  }
}

async function handleFriendWishlist(req, res, friendId) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    requireDb();
    const user = await requireAuth(req, res);
    if (!user) return;
    if (!friendId) return res.status(400).json({ error: 'Missing friend id' });

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
