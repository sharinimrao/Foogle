import { sql, requireDb } from './_db.js';
import { requireAuth } from './_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    requireDb();
    const user = await requireAuth(req, res);
    if (!user) return;

    const [dietary, beenCount, wishCount] = await Promise.all([
      sql`SELECT preference FROM dietary_preferences WHERE user_id = ${user.id} ORDER BY preference`,
      sql`SELECT count(*)::int AS n FROM been_there WHERE user_id = ${user.id}`,
      sql`SELECT count(*)::int AS n FROM wish_list WHERE user_id = ${user.id}`,
    ]);

    return res.status(200).json({
      user,
      dietaryPreferences: dietary.rows.map(r => r.preference),
      beenThereCount: beenCount.rows[0].n,
      wishlistCount: wishCount.rows[0].n,
    });
  } catch (e) {
    console.error('Me error:', e);
    return res.status(e.statusCode || 500).json({ error: e.message });
  }
}
