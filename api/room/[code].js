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

  // GET /api/room/{code} — fetch room data; increment participant count if voterId is new
  if (req.method === 'GET' && !action) {
    const voterId = url.searchParams.get('voterId');
    if (!room.voters) room.voters = [];
    if (voterId && !room.voters.includes(voterId)) {
      room.voters.push(voterId);
      room.participants = room.voters.length;
      await kv.set(key, room, { ex: 3600 });
      // Notify other clients that someone joined
      await publish(`presence-room-${room.code}`, 'participants', {
        participants: room.participants,
      });
    }
    return res.status(200).json({
      candidates: room.candidates,
      code: room.code,
      location: room.location,
      participants: room.participants || 1,
    });
  }

  // GET /api/room/{code}/state — current state snapshot (used by polling fallback)
  if (req.method === 'GET' && action === 'state') {
    const matches = computeMatches(room);
    return res.status(200).json({
      participants: room.participants || 1,
      matches,
      totalSwiped: Object.keys(room.votes || {}).length,
    });
  }

  // POST /api/room/{code}/vote — record a vote
  if (req.method === 'POST' && action === 'vote') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { spotId, vote, voterId } = body;

    if (!room.votes) room.votes = {};
    if (!room.votes[spotId]) room.votes[spotId] = { yes: [], no: [] };
    if (!Array.isArray(room.votes[spotId].yes)) room.votes[spotId].yes = [];
    if (!Array.isArray(room.votes[spotId].no)) room.votes[spotId].no = [];

    // Make sure this voter is registered as a participant
    if (!room.voters) room.voters = [];
    if (voterId && !room.voters.includes(voterId)) {
      room.voters.push(voterId);
      room.participants = room.voters.length;
    }

    // De-dup: if voter already voted on this spot, remove old vote first
    const oppositeVote = vote === 'yes' ? 'no' : 'yes';
    room.votes[spotId][oppositeVote] = room.votes[spotId][oppositeVote].filter(v => v !== voterId);
    const list = room.votes[spotId][vote];
    if (voterId && !list.includes(voterId)) list.push(voterId);

    const prevMatches = new Set(computeMatches(room));
    await kv.set(key, room, { ex: 3600 });
    const newMatchList = computeMatches(room);
    const firstNew = newMatchList.find(m => !prevMatches.has(m));

    // Push real-time updates to everyone in the room
    await publish(`presence-room-${room.code}`, 'vote', {
      spotId,
      vote,
      voterId,
      tally: {
        yes: room.votes[spotId].yes.length,
        no: room.votes[spotId].no.length,
      },
      totalMatches: newMatchList.length,
      participants: room.participants,
    });

    if (firstNew) {
      await publish(`presence-room-${room.code}`, 'match', {
        spotId: firstNew,
        allMatches: newMatchList,
      });
    }

    return res.status(200).json({
      ok: true,
      matched: !!firstNew,
      matchSpot: firstNew || null,
      totalMatches: newMatchList.length,
      participants: room.participants,
    });
  }

  return res.status(404).json({ error: 'Not found' });
}

function computeMatches(room) {
  const matches = [];
  const votes = room.votes || {};
  // A match is a place where at least 2 unique people said yes AND nobody said no.
  // This is more robust than requiring ALL participants to vote (since people leave tabs open, drop off, etc).
  for (const [spotId, tally] of Object.entries(votes)) {
    const yesVoters = Array.isArray(tally.yes) ? tally.yes : [];
    const noVoters = Array.isArray(tally.no) ? tally.no : [];
    if (yesVoters.length >= 2 && noVoters.length === 0) {
      matches.push(spotId);
    }
  }
  return matches;
}
