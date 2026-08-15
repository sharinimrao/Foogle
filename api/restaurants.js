import { sql } from './_db.js';
import { getSessionUser } from './_auth.js';

const GOOGLE_KEY = process.env.GOOGLE_PLACES_API_KEY;

const PRICE_MAP = {
  '$':  { min: 0, max: 1 },
  '$$': { min: 1, max: 2 },
  '$$$':{ min: 2, max: 3 },
  '$$$$':{ min: 3, max: 4 },
};

function priceToSymbol(level) {
  if (level === undefined || level === null) return '$$';
  return ['$', '$', '$$', '$$$', '$$$$'][level] || '$$';
}

async function geocode(query) {
  if (/^-?\d+\.?\d*,-?\d+\.?\d*$/.test(query)) {
    const [lat, lng] = query.split(',').map(Number);
    return { lat, lng, formatted: query };
  }
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${GOOGLE_KEY}`;
  const r = await fetch(url);
  const data = await r.json();
  if (!data.results || data.results.length === 0) throw new Error('Could not find that location');
  const top = data.results[0];
  return { lat: top.geometry.location.lat, lng: top.geometry.location.lng, formatted: top.formatted_address };
}

async function searchPlaces({ lat, lng, radiusMeters, query, minPrice, maxPrice }) {
  const url = 'https://places.googleapis.com/v1/places:searchText';
  const body = {
    textQuery: query,
    locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: radiusMeters } },
    pageSize: 20,
    minRating: 3.5,
  };
  if (minPrice !== undefined) {
    body.priceLevels = [];
    const levels = ['PRICE_LEVEL_FREE','PRICE_LEVEL_INEXPENSIVE','PRICE_LEVEL_MODERATE','PRICE_LEVEL_EXPENSIVE','PRICE_LEVEL_VERY_EXPENSIVE'];
    for (let i = minPrice; i <= maxPrice; i++) body.priceLevels.push(levels[i]);
  }
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_KEY,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.priceLevel,places.rating,places.userRatingCount,places.types,places.location,places.currentOpeningHours,places.nationalPhoneNumber,places.websiteUri,places.editorialSummary,places.photos',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const errText = await r.text();
    console.error('Places API error:', errText);
    return [];
  }
  const data = await r.json();
  return data.places || [];
}

function distanceMiles(lat1, lng1, lat2, lng2) {
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)) * 10) / 10;
}

function inferCuisine(types, name) {
  const t = (types || []).map(x => x.toLowerCase()).join(' ');
  const n = (name || '').toLowerCase();
  const combo = t + ' ' + n;
  const map = [
    ['boba', 'Boba'], ['bubble_tea', 'Boba'], ['bubble tea', 'Boba'],
    ['juice', 'Smoothies/Juice'], ['smoothie', 'Smoothies/Juice'],
    ['bar', 'Bars'], ['cocktail', 'Bars'], ['pub', 'Bars'],
    ['pizza', 'Pizza'], ['burger', 'Burgers'], ['mexican', 'Mexican'], ['chinese', 'Chinese'],
    ['thai', 'Thai'], ['japanese', 'Japanese'], ['sushi', 'Sushi'], ['italian', 'Italian'],
    ['indian', 'Indian'], ['barbecue', 'BBQ'], ['bbq', 'BBQ'], ['mediterranean', 'Mediterranean'],
    ['vietnamese', 'Vietnamese'], ['korean', 'Korean'], ['breakfast', 'Breakfast'],
    ['seafood', 'Seafood'], ['steak', 'Steakhouse'], ['cafe', 'Café'], ['bakery', 'Bakery'],
    ['vegan', 'Vegan'], ['vegetarian', 'Vegetarian'],
  ];
  for (const [needle, label] of map) if (combo.includes(needle)) return label;
  if (t.includes('restaurant')) return 'American';
  return 'Restaurant';
}

function generateVibe(p, cuisine) {
  const rating = p.rating || 0;
  const reviews = p.userRatingCount || 0;
  const editorial = p.editorialSummary?.text;
  if (editorial) return editorial;
  if (rating >= 4.7 && reviews >= 300) return `A standout ${cuisine.toLowerCase()} spot locals can't stop talking about.`;
  if (rating >= 4.5 && reviews >= 100) return `Well-loved ${cuisine.toLowerCase()} place with a loyal following.`;
  if (rating >= 4.3) return `Solid ${cuisine.toLowerCase()} option with consistently good reviews.`;
  if (reviews >= 500) return `A long-standing neighborhood ${cuisine.toLowerCase()} spot.`;
  return `Local ${cuisine.toLowerCase()} restaurant worth a try.`;
}

function generateWhy(p, params, cuisine, personalization) {
  const reasons = [];
  const key = (p.displayName?.text || '').toLowerCase();
  const inCravings = params.cuisines.some(c => c.toLowerCase() === cuisine.toLowerCase());
  if (personalization.wishlistNames.has(key)) reasons.push('on your wish list');
  const friendSource = personalization.friendSourceByLowerName.get(key);
  if (friendSource) reasons.push(`${friendSource.name.split(' ')[0]} wants to try it`);
  if (inCravings) reasons.push(`matches your ${cuisine.toLowerCase()} craving`);
  if (p.rating >= 4.6) reasons.push('crowd favorite');
  if (p.currentOpeningHours?.openNow) reasons.push('open now');
  if (params.price && priceToSymbol({ 'PRICE_LEVEL_FREE': 0, 'PRICE_LEVEL_INEXPENSIVE': 1, 'PRICE_LEVEL_MODERATE': 2, 'PRICE_LEVEL_EXPENSIVE': 3, 'PRICE_LEVEL_VERY_EXPENSIVE': 4 }[p.priceLevel]) === params.price) {
    reasons.push(`fits your ${params.price} budget`);
  }
  if (reasons.length === 0) return `Highly rated nearby option.`;
  return `Good pick — ${reasons.slice(0, 3).join(', ')}.`;
}

function formatRestaurant(p, params, personalization) {
  const cuisine = inferCuisine(p.types, p.displayName?.text);
  const key = (p.displayName?.text || '').toLowerCase();
  const friendSource = personalization.friendSourceByLowerName.get(key);
  return {
    id: p.id,
    name: p.displayName?.text || 'Unknown',
    cuisine,
    priceLevel: priceToSymbol({ 'PRICE_LEVEL_FREE': 0, 'PRICE_LEVEL_INEXPENSIVE': 1, 'PRICE_LEVEL_MODERATE': 2, 'PRICE_LEVEL_EXPENSIVE': 3, 'PRICE_LEVEL_VERY_EXPENSIVE': 4 }[p.priceLevel]),
    rating: p.rating,
    reviewCount: p.userRatingCount,
    address: p.formattedAddress,
    neighborhood: (p.formattedAddress || '').split(',').slice(-3, -2)[0]?.trim() || '',
    phone: p.nationalPhoneNumber,
    website: p.websiteUri,
    openNow: p.currentOpeningHours?.openNow,
    location: p.location,
    photoRef: p.photos && p.photos.length > 0 ? p.photos[0].name : null,
    vibe: generateVibe(p, cuisine),
    why: generateWhy(p, params, cuisine, personalization),
    ...(friendSource ? { sourceFriend: friendSource } : {}),
  };
}

// Pulls the signals that let recommendations reflect what this user (and
// their friends) actually want, not just raw Google ratings:
//  - beenThereNames: exclude these from results entirely
//  - wishlistNames: boost these in ranking (own wish list)
//  - friendSourceByLowerName: boost + tag places a friend has saved
// Best-effort — a signal-fetch failure should never block the core search.
async function fetchPersonalizationSignals(req) {
  const empty = { beenThereNames: new Set(), wishlistNames: new Set(), friendSourceByLowerName: new Map() };
  try {
    if (!process.env.POSTGRES_URL) return empty;
    const user = await getSessionUser(req);
    if (!user) return empty;

    const [beenThere, wishlist, friends] = await Promise.all([
      sql`SELECT restaurant_name FROM been_there WHERE user_id = ${user.id}`,
      sql`SELECT restaurant_name FROM wish_list WHERE user_id = ${user.id}`,
      sql`SELECT u.id, u.name FROM friendships f JOIN users u ON u.id = f.friend_id WHERE f.user_id = ${user.id} AND f.status = 'accepted'`,
    ]);

    const beenThereNames = new Set(beenThere.rows.map(r => r.restaurant_name.toLowerCase()));
    const wishlistNames = new Set(wishlist.rows.map(r => r.restaurant_name.toLowerCase()));

    const friendSourceByLowerName = new Map();
    if (friends.rows.length > 0) {
      const friendIds = friends.rows.map(f => f.id);
      const friendNameById = new Map(friends.rows.map(f => [f.id, f.name]));
      const { rows: matches } = await sql`
        SELECT user_id, restaurant_name FROM (
          SELECT user_id, restaurant_name FROM been_there
          UNION
          SELECT user_id, restaurant_name FROM wish_list
        ) t WHERE user_id = ANY(${friendIds})
      `;
      for (const m of matches) {
        const key = m.restaurant_name.toLowerCase();
        if (!friendSourceByLowerName.has(key)) {
          friendSourceByLowerName.set(key, { id: m.user_id, name: friendNameById.get(m.user_id) });
        }
      }
    }
    return { beenThereNames, wishlistNames, friendSourceByLowerName };
  } catch (e) {
    console.error('Personalization signals skipped:', e);
    return empty;
  }
}

function rankingBoost(name, personalization) {
  const key = name.toLowerCase();
  let boost = 1;
  if (personalization.wishlistNames.has(key)) boost *= 1.5;
  if (personalization.friendSourceByLowerName.has(key)) boost *= 1.25;
  return boost;
}

// GET /api/restaurants?photo=places/XXX/photos/YYY&w=400 — proxies a Places
// photo without exposing GOOGLE_PLACES_API_KEY to the browser. Google's photo
// endpoint 302s to a public googleusercontent.com URL that needs no key, so
// this just forwards that redirect straight to the client.
const PHOTO_REF_RE = /^places\/[^/]+\/photos\/[^/]+$/;

async function handlePhotoProxy(req, res) {
  try {
    if (!GOOGLE_KEY) return res.status(500).json({ error: 'Server missing GOOGLE_PLACES_API_KEY' });
    const url = new URL(req.url, `http://${req.headers.host}`);
    const ref = url.searchParams.get('photo') || '';
    if (!PHOTO_REF_RE.test(ref)) return res.status(400).json({ error: 'Invalid photo reference' });
    const width = Math.min(1200, Math.max(100, parseInt(url.searchParams.get('w'), 10) || 400));

    const photoUrl = `https://places.googleapis.com/v1/${ref}/media?maxWidthPx=${width}&key=${GOOGLE_KEY}`;
    const upstream = await fetch(photoUrl, { redirect: 'manual' });
    const location = upstream.headers.get('location');

    if (upstream.status >= 300 && upstream.status < 400 && location) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.redirect(302, location);
    }
    if (upstream.ok) {
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.setHeader('Content-Type', upstream.headers.get('content-type') || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.status(200).send(buf);
    }
    return res.status(404).json({ error: 'Photo not found' });
  } catch (e) {
    console.error('Photo proxy error:', e);
    return res.status(500).json({ error: 'Photo proxy failed' });
  }
}

export default async function handler(req, res) {
  if (req.method === 'GET') return handlePhotoProxy(req, res);
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const params = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!GOOGLE_KEY) {
      return res.status(500).json({ error: 'Server missing GOOGLE_PLACES_API_KEY' });
    }

    const geo = params.coords
      ? { lat: parseFloat(params.coords.split(',')[0]), lng: parseFloat(params.coords.split(',')[1]), formatted: params.location }
      : await geocode(params.location);

    const radiusMeters = Math.min(50000, (params.distance || 5) * 1609);
    // No price filter at all when the caller doesn't specify one (e.g. the
    // "mark a place as visited" / "add to wish list" search, which should
    // find ANY place regardless of cost) — omitting it entirely, rather than
    // defaulting to a specific tier, avoids silently excluding real results.
    const priceRange = params.price ? (PRICE_MAP[params.price] || PRICE_MAP['$$']) : null;

    const CATEGORY_QUERIES = {
      'Boba': ['boba tea shop', 'bubble tea'],
      'Bars': ['cocktail bar', 'bar'],
      'Smoothies/Juice': ['smoothie shop', 'juice bar'],
    };

    let searchQueries;
    if (params.cuisines && params.cuisines.length > 0) {
      searchQueries = params.cuisines.slice(0, 3).flatMap(c => {
        if (CATEGORY_QUERIES[c]) return CATEGORY_QUERIES[c];
        return [`${c} restaurant`];
      });
    } else {
      searchQueries = ['restaurant'];
    }

    const personalization = await fetchPersonalizationSignals(req);

    const allPlaces = [];
    const seen = new Set();
    const excludeIds = new Set(params.excludeIds || []);
    for (const q of searchQueries) {
      const places = await searchPlaces({
        lat: geo.lat,
        lng: geo.lng,
        radiusMeters,
        query: q,
        minPrice: priceRange?.min,
        maxPrice: priceRange?.max,
      });
      for (const p of places) {
        if (seen.has(p.id)) continue;
        if (excludeIds.has(p.id)) continue;
        seen.add(p.id);
        const name = (p.displayName?.text || '').toLowerCase();
        if (personalization.beenThereNames.has(name)) continue;
        const cuisine = inferCuisine(p.types, p.displayName?.text);
        const vetoed = (params.vetoes || []).some(v => name.includes(v.toLowerCase()) || cuisine.toLowerCase() === v.toLowerCase());
        if (vetoed) continue;
        allPlaces.push(p);
      }
    }

    const placesWithDist = allPlaces.map(p => ({
      ...p,
      _distance: p.location ? distanceMiles(geo.lat, geo.lng, p.location.latitude, p.location.longitude) : 999,
    })).filter(p => p._distance <= params.distance);

    placesWithDist.sort((a, b) => {
      const scoreA = (a.rating || 0) * Math.log10((a.userRatingCount || 0) + 10) * rankingBoost(a.displayName?.text || '', personalization);
      const scoreB = (b.rating || 0) * Math.log10((b.userRatingCount || 0) + 10) * rankingBoost(b.displayName?.text || '', personalization);
      return scoreB - scoreA;
    });

    const count = params.count || 6;
    const top = placesWithDist.slice(0, count);
    const restaurants = top.map(p => ({ ...formatRestaurant(p, params, personalization), distance: p._distance }));

    return res.status(200).json({ restaurants, location: geo.formatted });
  } catch (e) {
    console.error('Handler error:', e);
    return res.status(500).json({ error: e.message || 'Server error' });
  }
}
