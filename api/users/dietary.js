import { sql, requireDb } from '../_db.js';
import { requireAuth } from '../_auth.js';

export default async function handler(req, res) {
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
