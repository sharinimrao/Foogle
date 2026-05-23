import { getPusher } from './_pusher.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const pusher = getPusher();
  if (!pusher) {
    return res.status(500).json({ error: 'Pusher not configured' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    const params = new URLSearchParams(body);
    body = Object.fromEntries(params);
  }

  const { socket_id, channel_name } = body;
  if (!socket_id || !channel_name) {
    return res.status(400).json({ error: 'Missing socket_id or channel_name' });
  }

  const userId = `u_${Math.random().toString(36).slice(2, 10)}`;
  const userInfo = {
    name: body.user_name || randomName(),
  };

  try {
    const auth = pusher.authorizeChannel(socket_id, channel_name, {
      user_id: userId,
      user_info: userInfo,
    });
    return res.status(200).json(auth);
  } catch (e) {
    console.error('Auth error:', e);
    return res.status(500).json({ error: 'Auth failed' });
  }
}

function randomName() {
  const adjectives = ['Hungry', 'Picky', 'Curious', 'Easy', 'Snacky', 'Choosy', 'Ready', 'Patient'];
  const nouns = ['Diner', 'Friend', 'Guest', 'Pal', 'Eater', 'Voter'];
  return `${adjectives[Math.floor(Math.random() * adjectives.length)]} ${nouns[Math.floor(Math.random() * nouns.length)]}`;
}
