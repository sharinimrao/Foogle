// Consolidated: PATCH /api/users/me, PUT /api/users/dietary,
// GET /api/users/search — one function (dispatched by ?action=) to stay
// under the Hobby plan's 12-function deployment cap.
import { sql, requireDb } from './_db.js';
import { requireAuth, clearSessionCookie } from './_auth.js';

export default async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const action = url.searchParams.get('action');

  if (action === 'me') return handleMe(req, res);
  if (action === 'dietary') return handleDietary(req, res);
  if (action === 'search') return handleSearch(req, res, url);
  return res.status(404).json({ error: 'Not found' });
}

async function handleMe(req, res) {
  if (req.method === 'PATCH') return handleMePatch(req, res);
  if (req.method === 'DELETE') return handleMeDelete(req, res);
  return res.status(405).json({ error: 'Method not allowed' });
}

async function handleMePatch(req, res) {
  try {
    requireDb();
    const user = await requireAuth(req, res);
    if (!user) return;

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const hasName = typeof body.name === 'string';
    const hasAvatar = typeof body.avatarDataUrl === 'string' || body.avatarDataUrl === null;
    if (!hasName && !hasAvatar) return res.status(400).json({ error: 'Nothing to update' });

    let name = user.name;
    if (hasName) {
      name = body.name.trim();
      if (!name) return res.status(400).json({ error: 'Name is required' });
    }

    const { rows } = hasAvatar
      ? await sql`
          UPDATE users SET name = ${name}, avatar_url = ${body.avatarDataUrl}
          WHERE id = ${user.id}
          RETURNING id, email, name, auth_provider, avatar_url, created_at
        `
      : await sql`
          UPDATE users SET name = ${name} WHERE id = ${user.id}
          RETURNING id, email, name, auth_provider, avatar_url, created_at
        `;
    return res.status(200).json({ user: rows[0] });
  } catch (e) {
    console.error('Update profile error:', e);
    return res.status(e.statusCode || 500).json({ error: e.message });
  }
}

async function handleMeDelete(req, res) {
  try {
    requireDb();
    const user = await requireAuth(req, res);
    if (!user) return;
    await sql`DELETE FROM users WHERE id = ${user.id}`;
    clearSessionCookie(res);
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('Delete account error:', e);
    return res.status(e.statusCode || 500).json({ error: e.message });
  }
}

async function handleDietary(req, res) {
  if (req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });
  try {
    requireDb();
    const user = await requireAuth(req, res);
    if (!user) return;

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const preferences = Array.isArray(body.preferences) ? body.preferences.filter(Boolean) : [];

    await sql`DELETE FROM dietary_preferences WHERE user_id = ${user.id}`;
    for (const preference of preferences) {
      await sql`INSERT INTO dietary_preferences (user_id, preference) VALUES (${user.id}, ${preference}) ON CONFLICT DO NOTHING`;
    }
    return res.status(200).json({ dietaryPreferences: preferences });
  } catch (e) {
    console.error('Update dietary error:', e);
    return res.status(e.statusCode || 500).json({ error: e.message });
  }
}

async function handleSearch(req, res, url) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    requireDb();
    const user = await requireAuth(req, res);
    if (!user) return;

    const q = (url.searchParams.get('q') || '').trim();
    if (q.length < 2) return res.status(200).json({ users: [] });

    const { rows } = await sql`
      SELECT u.id, u.name,
        (SELECT status FROM friendships f WHERE f.user_id = ${user.id} AND f.friend_id = u.id) AS "friendStatus"
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
