import { sql, requireDb } from '../_db.js';
import { requireAuth } from '../_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });

  try {
    requireDb();
    const user = await requireAuth(req, res);
    if (!user) return;

    const url = new URL(req.url, `http://${req.headers.host}`);
    const id = parseInt(url.pathname.split('/').filter(Boolean).pop(), 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });

    await sql`DELETE FROM wish_list WHERE id = ${id} AND user_id = ${user.id}`;
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('Delete wish-list error:', e);
    return res.status(e.statusCode || 500).json({ error: e.message });
  }
}
