import { kv } from '@vercel/kv';
import { publish } from '../_pusher.js';

export default async function handler(req, res) {
  const url = new URL(req.url, `https://${req.headers.host}`);
  const parts = url.pathname.split('/').filter(Boolean);
  const code = parts[2];
  const action = parts[3];

  if (!code) {
    return res.status(400).json({ error: 'Missing room code' });
  }

  const key = `room:${code.toUpperCase()}`;
  const room = await kv.get(key);
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }

  if (req.method === 'GET' && !action) {
    return res.status(200).json({
      candidates: room.candidates,
      code: room.code,
      location: room.location,
    });
  }

  if (req.method === 'GET' && action === 'state') {
    const matches = computeMatches(room);
    return res.status(200).json({
      participants: room.participants || 1,
      matches,
      totalSwiped: Object.keys(room.votes || {}).length,
    });
  }

  if (req.method === 'POST' && action === 'vote') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { spotId, vote, voterId } = body;

    if (!room.votes) room.votes = {};
    if (!room.votes[spotId]) room.votes[spotId] = { yes: [], no: [] };
    if (!Array.isArray(room.votes[spotId].yes)) room.votes[spotId].yes = [];
    if (!Array.isArray(room.votes[spotId].no)) room.votes[spotId].no = [];

    const list = room.votes[spotId][vote];
    if (voterId && !list.includes(voterId)) list.push(voterId);

    const prevMatches = new Set(computeMatches(room));
    await kv.set(key, room, { ex: 3600 });
    const newMatches = computeMatches(room);
    const firstNew = newMatches.find(m => !prevMatches.has(m));

    await publish(`presence-room-${room.code}`, 'vote', {
      spotId,
      vote,
      tally: {
        yes: room.votes[spotId].yes.length,
        no: room.votes[spotId].no.length,
      },
    });

    if (firstNew) {
      await publish(`presence-room-${room.code}`, 'match', { spotId: firstNew });
    }

    return res.status(200).json({ ok: true, matched: !!firstNew, matchSpot: firstNew || null });
  }

  return res.status(404).json({ error: 'Not found' });
}

function computeMatches(room) {
  const matches = [];
  const votes = room.votes || {};
  const participants = room.participants || 2;
  const needed = Math.max(2, participants);
  for (const [spotId, tally] of Object.entries(votes)) {
    const yes = Array.isArray(tally.yes) ? tally.yes.length : (tally.yes || 0);
    const no = Array.isArray(tally.no) ? tally.no.length : (tally.no || 0);
    if (yes >= needed && no === 0) {
      matches.push(spotId);
    }
  }
  return matches;
}
