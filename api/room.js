import { kv } from '@vercel/kv';

function genCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { candidates, location } = body;
    if (!candidates || !Array.isArray(candidates) || candidates.length === 0) {
      return res.status(400).json({ error: 'Missing candidates' });
    }

    let code;
    for (let attempt = 0; attempt < 5; attempt++) {
      code = genCode();
      const existing = await kv.get(`room:${code}`);
      if (!existing) break;
    }

    const room = {
      code,
      location,
      candidates,
      participants: 1,
      votes: {},
      createdAt: Date.now(),
    };

    await kv.set(`room:${code}`, room, { ex: 3600 });

    return res.status(200).json({ code, candidates });
  } catch (e) {
    console.error('Room create error:', e);
    return res.status(500).json({ error: e.message });
  }
}
