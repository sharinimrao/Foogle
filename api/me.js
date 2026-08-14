import { sql, requireDb } from './_db.js';
import { requireAuth } from './_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    requireDb();
    const user = await requireAuth(req, res);
    if (!user) return;

    // avatar_url is fetched separately (not via getSessionUser, which runs on
    // nearly every authenticated request) since it can be a sizeable base64
    // blob — no reason to pull it on requests that don't need it.
    const [dietary, beenCount, wishCount, avatar] = await Promise.all([
      sql`SELECT preference FROM dietary_preferences WHERE user_id = ${user.id} ORDER BY preference`,
      sql`SELECT count(*)::int AS n FROM been_there WHERE user_id = ${user.id}`,
      sql`SELECT count(*)::int AS n FROM wish_list WHERE user_id = ${user.id}`,
      sql`SELECT avatar_url FROM users WHERE id = ${user.id}`,
    ]);

    return res.status(200).json({
      user: { ...user, avatar_url: avatar.rows[0]?.avatar_url || null },
      dietaryPreferences: dietary.rows.map(r => r.preference),
      beenThereCount: beenCount.rows[0].n,
      wishlistCount: wishCount.rows[0].n,
    });
  } catch (e) {
    console.error('Me error:', e);
    return res.status(e.statusCode || 500).json({ error: e.message });
  }
}
