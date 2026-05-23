# Forknife

> Where should we eat? Settled.

A web app that solves the group restaurant decision problem two ways:

- **Solo mode** — Tell it what you're craving, what you're not, your price ceiling and distance. Get six real curated picks. No infinite scroll.
- **Group mode** — Host creates a room with a 4-letter code. Everyone joins on their own phone and swipes through the candidates. First mutual yes wins. The match screen pops on every phone at once.

## How it works

```
[Your inputs] → [Google Places search]
                      ↓
              [Filter + rank by quality]
                      ↓
            [Claude curates top 6 with vibe/why]
                      ↓
              [Tappable result cards]
```

For group mode, room state lives in Vercel KV (Redis). Phones poll every 2 seconds for updates. When every participant has voted yes on the same spot (and nobody voted no), it's declared the match.

## Deploy in 5 minutes

### 1. Get API keys

- **Anthropic API key** — [console.anthropic.com](https://console.anthropic.com) → API Keys → Create. Used for the curation step.
- **Google Places API key** — [console.cloud.google.com](https://console.cloud.google.com) → enable the **Places API (New)** and **Geocoding API** → Credentials → Create API key. Restrict to those two APIs.
- **Pusher app** (for real-time group mode) — [pusher.com](https://pusher.com) → sign up (free) → Channels → Create app → grab the **app ID, key, secret, and cluster** from "App Keys". Free tier covers 200k messages/day and 100 concurrent connections, way more than you need.

### 2. Deploy to Vercel

```bash
git clone <this-repo> forknife
cd forknife
npx vercel
```

Or use the Vercel dashboard: New Project → Import this repo → Deploy.

### 3. Add KV storage (for group rooms)

In your Vercel dashboard for the project:

1. Go to **Storage** → **Create Database** → **KV**
2. Vercel auto-injects the `KV_*` env vars
3. Redeploy

### 4. Set the API key env vars

In Vercel dashboard → Project → Settings → Environment Variables, add:

- `ANTHROPIC_API_KEY`
- `GOOGLE_PLACES_API_KEY`
- `PUSHER_APP_ID`
- `PUSHER_KEY`
- `PUSHER_SECRET`
- `PUSHER_CLUSTER` (e.g. `us2` — whatever you chose in Pusher)

Redeploy. Done.

> **Note**: If you skip the Pusher setup, group mode still works — it automatically falls back to 2-second polling.

## Local development

```bash
npm install
cp .env.example .env.local
# Fill in your keys
npx vercel dev
```

Visit `http://localhost:3000`.

## What's not built yet (future work)

- **Group preferences memory** — Persist veto lists per room/user. Right now state lives in localStorage on the host's device only.
- **Auth** — No login. Rooms expire after 1 hour. For a real product, add Clerk or Auth.js and tie rooms to user accounts.
- **Photos** — Google Places returns photo references; we ignore them to keep the layout tight. Easy to wire in.
- **Tiebreakers** — If two spots tie, the app picks the first. A real product would do a runoff swipe round.
- **Push notifications** — Group members get notified when the room reaches a match. Needs a service worker + Web Push.

## File map

```
forknife/
├── public/
│   ├── index.html      # All screens, single-page
│   ├── styles.css      # Editorial diner aesthetic
│   └── app.js          # State, screens, swipe gestures, Pusher subscription
├── api/
│   ├── restaurants.js  # POST: Places search + Claude curation
│   ├── room.js         # POST: create room
│   ├── room/
│   │   └── [code].js   # GET/POST: room state, votes, join
│   ├── pusher-auth.js  # Presence channel authorization
│   ├── config.js       # Returns public Pusher key/cluster to frontend
│   └── _pusher.js      # Shared server-side Pusher helper
├── vercel.json
├── package.json
└── .env.example
```

## Design notes

The aesthetic is intentionally not "another food app." Most are clinical-bright with stock food photography. This one is paper-warm — `#f5efe4` cream background, Fraunces serif headlines with optical sizing and slight `WONK` axis flex, oxblood `#9a2a2a` accents. Dark mode auto-flips to coffee-brown with warm orange.

The point: the app should feel like a confident waiter handing you a short menu, not a search engine.
