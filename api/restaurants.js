export const config = { runtime: 'edge' };

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
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.priceLevel,places.rating,places.userRatingCount,places.types,places.location,places.currentOpeningHours,places.nationalPhoneNumber,places.websiteUri,places.editorialSummary',
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

function generateWhy(p, params, cuisine) {
  const reasons = [];
  const inCravings = params.cuisines.some(c => c.toLowerCase() === cuisine.toLowerCase());
  if (inCravings) reasons.push(`matches your ${cuisine.toLowerCase()} craving`);
  if (p.rating >= 4.6) reasons.push('crowd favorite');
  if (p.currentOpeningHours?.openNow) reasons.push('open now');
  if (params.price && priceToSymbol({ 'PRICE_LEVEL_FREE': 0, 'PRICE_LEVEL_INEXPENSIVE': 1, 'PRICE_LEVEL_MODERATE': 2, 'PRICE_LEVEL_EXPENSIVE': 3, 'PRICE_LEVEL_VERY_EXPENSIVE': 4 }[p.priceLevel]) === params.price) {
    reasons.push(`fits your ${params.price} budget`);
  }
  if (reasons.length === 0) return `Highly rated nearby option.`;
  return `Good pick — ${reasons.slice(0, 3).join(', ')}.`;
}

function formatRestaurant(p, params) {
  const cuisine = inferCuisine(p.types, p.displayName?.text);
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
    vibe: generateVibe(p, cuisine),
    why: generateWhy(p, params, cuisine),
  };
}

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  try {
    const params = await req.json();
    if (!GOOGLE_KEY) {
      return new Response(JSON.stringify({ error: 'Server missing GOOGLE_PLACES_API_KEY' }), { status: 500 });
    }

    const geo = params.coords
      ? { lat: parseFloat(params.coords.split(',')[0]), lng: parseFloat(params.coords.split(',')[1]), formatted: params.location }
      : await geocode(params.location);

    const radiusMeters = Math.min(50000, (params.distance || 5) * 1609);
    const priceRange = PRICE_MAP[params.price] || PRICE_MAP['$$'];

    let searchQueries;
    if (params.cuisines && params.cuisines.length > 0) {
      searchQueries = params.cuisines.slice(0, 3).map(c => `${c} restaurant`);
    } else {
      searchQueries = ['restaurant'];
    }

    const allPlaces = [];
    const seen = new Set();
    const excludeIds = new Set(params.excludeIds || []);
    for (const q of searchQueries) {
      const places = await searchPlaces({
        lat: geo.lat,
        lng: geo.lng,
        radiusMeters,
        query: q,
        minPrice: priceRange.min,
        maxPrice: priceRange.max,
      });
      for (const p of places) {
        if (seen.has(p.id)) continue;
        if (excludeIds.has(p.id)) continue;
        seen.add(p.id);
        const name = (p.displayName?.text || '').toLowerCase();
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
      const scoreA = (a.rating || 0) * Math.log10((a.userRatingCount || 0) + 10);
      const scoreB = (b.rating || 0) * Math.log10((b.userRatingCount || 0) + 10);
      return scoreB - scoreA;
    });

    const count = params.count || 6;
    const top = placesWithDist.slice(0, count);
    const restaurants = top.map(p => ({ ...formatRestaurant(p, params), distance: p._distance }));

    return new Response(JSON.stringify({ restaurants, location: geo.formatted }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('Handler error:', e);
    return new Response(JSON.stringify({ error: e.message || 'Server error' }), { status: 500 });
  }
}
