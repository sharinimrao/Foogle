// Consolidated: GET /api/friends, POST /api/friends/add (send a request),
// POST /api/friends?action=accept, POST /api/friends?action=decline,
// GET /api/friends?action=requests (incoming pending), GET
// /api/friends/:id/wishlist — one function (dispatched by ?action=/?id=) to
// stay under the Hobby plan's 12-function deployment cap.
import { sql, requireDb } from './_db.js';
import { requireAuth } from './_auth.js';

export default async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const action = url.searchParams.get('action');

  if (action === 'add') return handleAdd(req, res);
  if (action === 'accept') return handleAccept(req, res);
  if (action === 'decline') return handleDecline(req, res);
  if (action === 'requests') return handleRequests(req, res);
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

// Sends a friend request: one row, status='pending'. Does not touch an
// existing row (so re-tapping "Add" can't downgrade an accepted friendship
// or re-open a declined one) — ON CONFLICT DO NOTHING.
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
      INSERT INTO friendships (user_id, friend_id, status) VALUES (${user.id}, ${friendId}, 'pending')
      ON CONFLICT (user_id, friend_id) DO NOTHING
    `;
    return res.status(200).json({ friend: target.rows[0], status: 'pending' });
  } catch (e) {
    console.error('Add friend error:', e);
    return res.status(e.statusCode || 500).json({ error: e.message });
  }
}

// Accepts an incoming request: flips the requester's row to 'accepted' and
// inserts the reciprocal row, so both people's friend lists see each other.
async function handleAccept(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    requireDb();
    const user = await requireAuth(req, res);
    if (!user) return;

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const requesterId = body.requesterId;
    if (!requesterId) return res.status(400).json({ error: 'Missing requesterId' });

    const pending = await sql`
      SELECT 1 FROM friendships WHERE user_id = ${requesterId} AND friend_id = ${user.id} AND status = 'pending'
    `;
    if (pending.rows.length === 0) return res.status(404).json({ error: 'No pending request from this user' });

    await sql`UPDATE friendships SET status = 'accepted' WHERE user_id = ${requesterId} AND friend_id = ${user.id}`;
    await sql`
      INSERT INTO friendships (user_id, friend_id, status) VALUES (${user.id}, ${requesterId}, 'accepted')
      ON CONFLICT (user_id, friend_id) DO UPDATE SET status = 'accepted'
    `;
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('Accept friend error:', e);
    return res.status(e.statusCode || 500).json({ error: e.message });
  }
}

// Declines an incoming request: just removes the pending row. The requester
// can send another request later (ON CONFLICT DO NOTHING in handleAdd won't
// re-add it while there's nothing there to conflict with).
async function handleDecline(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    requireDb();
    const user = await requireAuth(req, res);
    if (!user) return;

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const requesterId = body.requesterId;
    if (!requesterId) return res.status(400).json({ error: 'Missing requesterId' });

    await sql`DELETE FROM friendships WHERE user_id = ${requesterId} AND friend_id = ${user.id} AND status = 'pending'`;
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('Decline friend error:', e);
    return res.status(e.statusCode || 500).json({ error: e.message });
  }
}

async function handleRequests(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    requireDb();
    const user = await requireAuth(req, res);
    if (!user) return;

    const { rows } = await sql`
      SELECT u.id, u.name
      FROM friendships f JOIN users u ON u.id = f.user_id
      WHERE f.friend_id = ${user.id} AND f.status = 'pending'
      ORDER BY f.created_at DESC
    `;
    return res.status(200).json({ requests: rows });
  } catch (e) {
    console.error('Friend requests error:', e);
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
