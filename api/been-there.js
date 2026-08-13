import { sql, requireDb } from './_db.js';
import { requireAuth } from './_auth.js';

export default async function handler(req, res) {
  try {
    requireDb();
    const user = await requireAuth(req, res);
    if (!user) return;

    if (req.method === 'GET') {
      const { rows } = await sql`
        SELECT id, restaurant_name AS name, cuisine, price AS "priceLevel", city AS neighborhood, marked_at
        FROM been_there WHERE user_id = ${user.id} ORDER BY marked_at DESC
      `;
      return res.status(200).json({ places: rows });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const name = (body.name || '').trim();
      if (!name) return res.status(400).json({ error: 'Missing restaurant name' });

      const { rows } = await sql`
        INSERT INTO been_there (user_id, restaurant_name, cuisine, price, city)
        VALUES (${user.id}, ${name}, ${body.cuisine || null}, ${body.priceLevel || null}, ${body.neighborhood || null})
        ON CONFLICT (user_id, restaurant_name) DO UPDATE SET marked_at = been_there.marked_at
        RETURNING id, restaurant_name AS name, cuisine, price AS "priceLevel", city AS neighborhood, marked_at
      `;
      return res.status(200).json({ place: rows[0] });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('Been-there error:', e);
    return res.status(e.statusCode || 500).json({ error: e.message });
  }
}
