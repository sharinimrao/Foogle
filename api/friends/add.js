import { sql, requireDb } from '../_db.js';
import { requireAuth } from '../_auth.js';

// No request/approval flow yet (no Figma screen for a request inbox) — adding
// a friend writes both directions as 'accepted' immediately.
export default async function handler(req, res) {
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
