const CUISINES = ['Pizza','Burgers','Mexican','Chinese','Thai','Japanese','Italian','Indian','BBQ','Sushi','Mediterranean','Vietnamese','Korean','American','Breakfast','Seafood','Vegetarian','Dessert','Boba','Bars','Smoothies/Juice','Coffee','Gluten-Free'];
const PRICES = ['$','$$','$$$','$$$$'];
function icon(name, sizeClass = 'icon-md') { return `<svg class="icon ${sizeClass}"><use href="#i-${name}"></use></svg>`; }
const QUICKPICKS = [
  { label: 'Coffee', icon: icon('coffee', 'icon-sm'), cuisine: 'Coffee', variant: 'red' },
  { label: 'Drinks', icon: icon('cocktail', 'icon-sm'), cuisine: 'Bars', variant: 'orange' },
  { label: 'Sweet', icon: icon('cupcake', 'icon-sm'), cuisine: 'Dessert', variant: 'orange' },
];
const DIETARY_OPTIONS = ['Gluten-Free', 'Vegetarian'];
function foodIcon(sizeClass = 'icon-md') { return icon('ramen', sizeClass); }

const MOCK_FRIENDS = [
  { name: 'Maya Chen', wishlist: [
    { name: 'Ramen Shop', cuisine: 'Japanese', priceLevel: '$$', neighborhood: 'Berkeley, CA' },
    { name: 'Casa Verde', cuisine: 'Mexican', priceLevel: '$$', neighborhood: 'Oakland, CA' },
  ]},
  { name: 'Jordan Lee', wishlist: [
    { name: 'The Copper Pot', cuisine: 'American', priceLevel: '$$$', neighborhood: 'San Francisco, CA' },
  ]},
  { name: 'Priya Patel', wishlist: [
    { name: 'Spice Route', cuisine: 'Indian', priceLevel: '$$', neighborhood: 'Emeryville, CA' },
    { name: 'Bao House', cuisine: 'Chinese', priceLevel: '$', neighborhood: 'Berkeley, CA' },
  ]},
];

const TOPBAR_SCREENS = new Set(['home', 'room', 'match']);
const BOTTOM_NAV_SCREENS = new Set(['home', 'saved', 'wishlist', 'friends', 'profile']);

let PUSHER_CONFIG = null;
async function getPusherConfig() {
  if (PUSHER_CONFIG !== null) return PUSHER_CONFIG;
  try {
    const r = await fetch('/api/config');
    if (!r.ok) { PUSHER_CONFIG = false; return false; }
    PUSHER_CONFIG = await r.json();
    return PUSHER_CONFIG;
  } catch (e) { PUSHER_CONFIG = false; return false; }
}

function getOrCreateVoterId() {
  let id = localStorage.getItem('forknife:voterId');
  if (!id) {
    id = 'v_' + Math.random().toString(36).slice(2, 12);
    localStorage.setItem('forknife:voterId', id);
  }
  return id;
}

function getOrCreateUserName() {
  let name = localStorage.getItem('forknife:userName');
  if (!name) {
    const adjectives = ['Hungry', 'Picky', 'Curious', 'Easy', 'Snacky', 'Choosy', 'Ready', 'Patient'];
    const nouns = ['Diner', 'Friend', 'Guest', 'Pal', 'Eater', 'Voter'];
    name = `${adjectives[Math.floor(Math.random() * adjectives.length)]} ${nouns[Math.floor(Math.random() * nouns.length)]}`;
    localStorage.setItem('forknife:userName', name);
  }
  return name;
}

const state = {
  solo: {
    location: '',
    cuisines: new Set(),
    vetoes: new Set(),
    price: '$$',
    distance: 5,
    results: [],
    seenIds: new Set(),
    radiusBoost: 0,
  },
  group: {
    roomCode: null,
    isHost: false,
    location: '',
    cuisines: new Set(),
    price: '$$',
    distance: 5,
    candidates: [],
    swipeIndex: 0,
    myVotes: {},
    matchedSpots: [],
    voterId: getOrCreateVoterId(),
    userName: getOrCreateUserName(),
    pusherClient: null,
    channel: null,
    members: {},
    swipedMembers: new Set(),
    pollInterval: null,
    tallyBySpot: {},
  },
  lastMatch: null,
  recents: JSON.parse(localStorage.getItem('forknife:recents') || '[]'),
};

function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }

function show(screenId) {
  $$('.screen').forEach(s => s.classList.remove('active'));
  $(`#screen-${screenId}`).classList.add('active');
  $('#topbar').hidden = !TOPBAR_SCREENS.has(screenId);
  const showNav = BOTTOM_NAV_SCREENS.has(screenId);
  $('#bottom-nav').hidden = !showNav;
  document.body.classList.toggle('has-bottom-nav', showNav);
  $$('#bottom-nav button').forEach(b => b.classList.toggle('active', b.dataset.nav === screenId));
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.hidden = true, ms);
}

function renderPills(containerId, items, selectedSet, modifier, oppositeSet) {
  const c = $(containerId);
  c.innerHTML = '';
  items.forEach(item => {
    const b = document.createElement('button');
    b.className = 'pill' + (selectedSet.has(item) ? (modifier === 'veto' ? ' veto' : ' selected') : '');
    b.textContent = item;
    b.type = 'button';
    b.onclick = () => {
      if (selectedSet.has(item)) selectedSet.delete(item);
      else {
        selectedSet.add(item);
        if (oppositeSet) oppositeSet.delete(item);
      }
      renderPills(containerId, items, selectedSet, modifier, oppositeSet);
      if (oppositeSet) {
        const oppId = containerId === '#solo-cuisines' ? '#solo-vetoes' : '#solo-cuisines';
        const oppMod = oppId.includes('veto') ? 'veto' : null;
        renderPills(oppId, items, oppositeSet, oppMod, selectedSet);
      }
      if (containerId === '#solo-cuisines') {
        $('#solo-cuisine-count').textContent = selectedSet.size ? `${selectedSet.size} picked` : 'tap any that fit';
      }
    };
    c.appendChild(b);
  });
}

function renderQuickpicks(containerId, selectedSet, onToggle) {
  const c = $(containerId);
  c.innerHTML = '';
  QUICKPICKS.forEach(qp => {
    const b = document.createElement('button');
    b.className = 'quickpick-chip' + (qp.variant === 'red' ? ' red' : '') + (selectedSet.has(qp.cuisine) ? ' selected' : '');
    b.type = 'button';
    b.innerHTML = `${qp.icon} ${qp.label}`;
    b.onclick = () => onToggle(qp.cuisine);
    c.appendChild(b);
  });
}

function renderDietary(containerId, selectedSet, onToggle) {
  const c = $(containerId);
  c.innerHTML = '';
  DIETARY_OPTIONS.forEach(opt => {
    const b = document.createElement('button');
    b.className = 'dietary-chip' + (selectedSet.has(opt) ? ' selected' : '');
    b.type = 'button';
    b.textContent = opt;
    b.onclick = () => onToggle(opt);
    c.appendChild(b);
  });
}

function wirePreferencesSearch(inputId, pillRowId) {
  const input = $(inputId);
  if (!input || input._wired) return;
  input._wired = true;
  input.oninput = () => {
    const q = input.value.trim().toLowerCase();
    $$(`${pillRowId} .pill`).forEach(pill => {
      pill.hidden = q.length > 0 && !pill.textContent.toLowerCase().includes(q);
    });
  };
}

function renderPrice(containerId, selected, onChange) {
  const c = $(containerId);
  c.innerHTML = '';
  PRICES.forEach(p => {
    const b = document.createElement('button');
    b.className = 'price-pill' + (selected === p ? ' selected' : '');
    b.textContent = p;
    b.type = 'button';
    b.onclick = () => onChange(p);
    c.appendChild(b);
  });
}

function buildSoloScreen() {
  if (!state.solo._seededDietary) {
    state.solo._seededDietary = true;
    getDietaryPrefs().forEach(p => state.solo.cuisines.add(p));
  }
  renderPills('#solo-cuisines', CUISINES, state.solo.cuisines, null, state.solo.vetoes);
  renderPills('#solo-vetoes', CUISINES, state.solo.vetoes, 'veto', state.solo.cuisines);
  renderQuickpicks('#solo-quickpicks', state.solo.cuisines, (cuisine) => {
    if (state.solo.cuisines.has(cuisine)) state.solo.cuisines.delete(cuisine);
    else state.solo.cuisines.add(cuisine);
    buildSoloScreen();
  });
  renderDietary('#solo-dietary', state.solo.cuisines, (opt) => {
    if (state.solo.cuisines.has(opt)) state.solo.cuisines.delete(opt);
    else state.solo.cuisines.add(opt);
    buildSoloScreen();
  });
  const onSoloPrice = (p) => { state.solo.price = p; renderPrice('#solo-price', state.solo.price, onSoloPrice); };
  renderPrice('#solo-price', state.solo.price, onSoloPrice);
  wirePreferencesSearch('#solo-preferences-search', '#solo-cuisines');
}

function buildGroupSetupScreen() {
  if (!state.group._seededDietary) {
    state.group._seededDietary = true;
    getDietaryPrefs().forEach(p => state.group.cuisines.add(p));
  }
  renderPills('#group-cuisines', CUISINES, state.group.cuisines, null, null);
  renderQuickpicks('#group-quickpicks', state.group.cuisines, (cuisine) => {
    if (state.group.cuisines.has(cuisine)) state.group.cuisines.delete(cuisine);
    else state.group.cuisines.add(cuisine);
    buildGroupSetupScreen();
  });
  renderDietary('#group-dietary', state.group.cuisines, (opt) => {
    if (state.group.cuisines.has(opt)) state.group.cuisines.delete(opt);
    else state.group.cuisines.add(opt);
    buildGroupSetupScreen();
  });
  const onGroupPrice = (p) => { state.group.price = p; renderPrice('#group-price', state.group.price, onGroupPrice); };
  renderPrice('#group-price', state.group.price, onGroupPrice);
  wirePreferencesSearch('#group-preferences-search', '#group-cuisines');
}

$('#solo-distance').oninput = (e) => {
  state.solo.distance = parseInt(e.target.value);
  $('#solo-dist-out').textContent = `${state.solo.distance} mi`;
};
$('#group-distance').oninput = (e) => {
  state.group.distance = parseInt(e.target.value);
  $('#group-dist-out').textContent = `${state.group.distance} mi`;
};

$$('.mode-card').forEach(card => {
  card.onclick = () => {
    const mode = card.dataset.mode;
    if (mode === 'solo') {
      buildSoloScreen();
      show('solo');
    } else {
      show('group-start');
    }
  };
});

$$('.back-btn').forEach(b => {
  b.onclick = () => {
    disconnectRoom();
    show(b.dataset.back);
  };
});

$('#info-btn').onclick = () => $('#info-modal').showModal();
$('#close-info').onclick = () => $('#info-modal').close();

$('#use-my-location').onclick = () => {
  if (!navigator.geolocation) { toast('Geolocation not available'); return; }
  $('#use-my-location').textContent = 'Locating…';
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const { latitude, longitude } = pos.coords;
      $('#solo-location').dataset.coords = `${latitude},${longitude}`;
      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`);
        const data = await r.json();
        const addr = data.address;
        const readable = addr.neighbourhood || addr.suburb || addr.city_district || addr.city || addr.town || `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
        $('#solo-location').value = readable;
        $('#use-my-location').textContent = 'Location set ✓';
      } catch {
        $('#solo-location').value = `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
        $('#use-my-location').textContent = 'Location set ✓';
      }
    },
    () => {
      $('#use-my-location').textContent = 'Use my location';
      toast('Could not get location');
    }
  );
};
$('#use-my-location-group').onclick = () => {
  if (!navigator.geolocation) { toast('Geolocation not available'); return; }
  $('#use-my-location-group').textContent = 'Locating…';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      $('#group-location').value = `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
      $('#group-location').dataset.coords = `${latitude},${longitude}`;
      $('#use-my-location-group').textContent = 'Location set ✓';
    },
    (err) => {
      $('#use-my-location').textContent = 'Use my location';
      toast(`Location error: ${err.code} - ${err.message}`);
    }
  );
};

$('#solo-find').onclick = async () => {
  const loc = $('#solo-location').value.trim();
  if (!loc) { toast('Where are you?'); return; }
  state.solo.location = loc;
  state.solo.seenIds = new Set();
  state.solo.radiusBoost = 0;
  await runSoloSearch();
};

async function runSoloSearch() {
  const btn = $('#solo-find');
  btn.disabled = true;
  btn.querySelector('span').textContent = 'Thinking…';

  try {
    const effectiveDistance = Math.min(50, state.solo.distance + state.solo.radiusBoost);
    const data = await fetchRestaurants({
      location: state.solo.location,
      coords: $('#solo-location').dataset.coords,
      cuisines: Array.from(state.solo.cuisines),
      vetoes: Array.from(state.solo.vetoes),
      price: state.solo.price,
      distance: effectiveDistance,
      count: 6,
      excludeIds: Array.from(state.solo.seenIds),
    });
    state.solo.results = data.restaurants;
    data.restaurants.forEach(r => state.solo.seenIds.add(r.id));
    renderResults();
    show('results');
  } catch (e) {
    console.error(e);
    toast(e.message || 'Something glitched');
  } finally {
    btn.disabled = false;
    btn.querySelector('span').textContent = 'Find My Pick';
  }
}

async function reshuffleResults() {
  const reshuffleButtons = [$('#reroll-btn'), $('#reroll-top')];
  reshuffleButtons.forEach(b => { if (b) b.disabled = true; });
  try {
    const effectiveDistance = Math.min(50, state.solo.distance + state.solo.radiusBoost);
    const data = await fetchRestaurants({
      location: state.solo.location,
      coords: $('#solo-location').dataset.coords,
      cuisines: Array.from(state.solo.cuisines),
      vetoes: Array.from(state.solo.vetoes),
      price: state.solo.price,
      distance: effectiveDistance,
      count: 6,
      excludeIds: Array.from(state.solo.seenIds),
    });
    if (!data.restaurants || data.restaurants.length === 0) {
      if (state.solo.radiusBoost < 10) {
        state.solo.radiusBoost += 5;
        toast(`Expanding search to ${state.solo.distance + state.solo.radiusBoost} mi`);
        await reshuffleResults();
        return;
      } else {
        toast("That's all I've got. Try different cuisines?");
        return;
      }
    }
    state.solo.results = data.restaurants;
    data.restaurants.forEach(r => state.solo.seenIds.add(r.id));
    renderResults();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) {
    console.error(e);
    toast(e.message || 'Reshuffle failed');
  } finally {
    reshuffleButtons.forEach(b => { if (b) b.disabled = false; });
  }
}

async function fetchRestaurants(params) {
  const r = await fetch('/api/restaurants', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${r.status}`);
  }
  return r.json();
}

function renderResults() {
  const list = $('#results-list');
  list.innerHTML = '';
  const titleEl = $('#results-title');
  if (titleEl) titleEl.textContent = `${state.solo.results.length} results.`;
  const sub = state.solo.cuisines.size
    ? `In the mood for ${Array.from(state.solo.cuisines).slice(0, 3).join(', ')}${state.solo.cuisines.size > 3 ? '…' : ''}`
    : `Within ${state.solo.distance + state.solo.radiusBoost} miles of ${state.solo.location}`;
  $('#results-sub').textContent = sub;

  state.solo.results.forEach((spot, i) => {
    const card = document.createElement('div');
    card.className = 'result-card';
    card.innerHTML = `
      <div class="rc-name">${escapeHtml(spot.name)}</div>
      <div class="rc-price">${escapeHtml(spot.priceLevel || '$$')}</div>
      <div class="rc-meta">
        <span>${escapeHtml(spot.cuisine)}</span>
        <span class="rc-meta-dot"></span>
        <span>${escapeHtml(spot.neighborhood || '')}</span>
        ${spot.distance ? `<span class="rc-meta-dot"></span><span>${spot.distance} mi</span>` : ''}
      </div>
      <div class="rc-vibe">${escapeHtml(spot.vibe || spot.why || '')}</div>
      ${spot.rating ? `<div class="rc-rating"><span class="rc-stars">${starString(spot.rating)}</span><span>${spot.rating.toFixed(1)} · ${spot.reviewCount || 0} reviews</span></div>` : ''}
    `;
    card.onclick = () => showDetail(spot);
    list.appendChild(card);
  });
}

function starString(rating) {
  const full = Math.floor(rating);
  const half = rating - full >= 0.5;
  return '★'.repeat(full) + (half ? '⯨' : '') + '☆'.repeat(5 - full - (half ? 1 : 0));
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

$('#reroll-btn').onclick = () => reshuffleResults();
const rerollTop = $('#reroll-top');
if (rerollTop) rerollTop.onclick = () => reshuffleResults();

function showDetail(spot) {
  state.lastMatch = spot;
  const c = $('#detail-content');
  c.innerHTML = `
    <div class="detail-hero">
      <div class="detail-cuisine">${escapeHtml(spot.cuisine)}</div>
      <h1 class="detail-name">${escapeHtml(spot.name)}</h1>
      <div class="detail-meta-row">
        <span>${escapeHtml(spot.priceLevel || '$$')}</span>
        <span class="rc-meta-dot"></span>
        <span>${escapeHtml(spot.neighborhood || '')}</span>
        ${spot.rating ? `<span class="rc-meta-dot"></span><span class="rc-stars">${starString(spot.rating)}</span> <span>${spot.rating.toFixed(1)}</span>` : ''}
      </div>
    </div>
    <div class="detail-section">
      <h4>The vibe</h4>
      <p>${escapeHtml(spot.vibe || '—')}</p>
    </div>
    <div class="detail-section">
      <h4>Why this fits</h4>
      <p>${escapeHtml(spot.why || '—')}</p>
    </div>
    ${spot.address ? `<div class="detail-section"><h4>Address</h4><p>${escapeHtml(spot.address)}</p></div>` : ''}
    ${spot.openNow !== undefined ? `<div class="detail-section"><h4>Status</h4><p>${spot.openNow ? '<span style="color:var(--teal)">Open now</span>' : '<span style="color:var(--red)">Closed</span>'}</p></div>` : ''}
    <div class="detail-action-row">
      <button class="primary-btn" id="detail-directions">Directions</button>
      ${spot.phone ? `<button class="ghost-btn" id="detail-call">Call</button>` : `<button class="ghost-btn" id="detail-website">Website</button>`}
    </div>
  `;
  $('#detail-directions').onclick = () => {
    const q = encodeURIComponent(`${spot.name} ${spot.address || state.solo.location}`);
    window.open(`https://www.google.com/maps/search/?api=1&query=${q}`, '_blank');
  };
  if (spot.phone && $('#detail-call')) {
    $('#detail-call').onclick = () => window.location.href = `tel:${spot.phone}`;
  } else if ($('#detail-website')) {
    $('#detail-website').onclick = () => {
      if (spot.website) window.open(spot.website, '_blank');
      else {
        const q = encodeURIComponent(`${spot.name} ${state.solo.location}`);
        window.open(`https://www.google.com/search?q=${q}`, '_blank');
      }
    };
  }
  show('detail');
}

$('#create-room-btn').onclick = () => {
  state.group.isHost = true;
  buildGroupSetupScreen();
  show('group-setup');
};

$('#join-room-btn').onclick = () => {
  $('#room-code-input').focus();
};

$('#room-code-input').oninput = (e) => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  if (e.target.value.length === 4) $('#join-confirm').click();
};

$('#join-confirm').onclick = async () => {
  const code = $('#room-code-input').value.trim();
  if (code.length !== 4) { toast('Need a 4-character code'); return; }
  try {
    const r = await fetch(`/api/room/${code}?voterId=${encodeURIComponent(state.group.voterId)}`);
    if (!r.ok) throw new Error('Room not found');
    const room = await r.json();
    state.group.roomCode = code;
    state.group.isHost = false;
    state.group.candidates = room.candidates;
    state.group.swipeIndex = 0;
    state.group.myVotes = {};
    enterRoom();
  } catch (e) {
    toast(e.message);
  }
};

$('#create-confirm').onclick = async () => {
  const loc = $('#group-location').value.trim();
  if (!loc) { toast('Where are you?'); return; }
  state.group.location = loc;
  const btn = $('#create-confirm');
  btn.disabled = true;
  btn.querySelector('span').textContent = 'Building room…';

  try {
    const data = await fetchRestaurants({
      location: loc,
      cuisines: Array.from(state.group.cuisines),
      vetoes: [],
      price: state.group.price,
      distance: state.group.distance,
      count: 10,
    });
    const r = await fetch('/api/room', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidates: data.restaurants, location: loc, hostVoterId: state.group.voterId }),
    });
    const room = await r.json();
    state.group.roomCode = room.code;
    state.group.candidates = data.restaurants;
    state.group.swipeIndex = 0;
    state.group.myVotes = {};
    enterRoom();
  } catch (e) {
    toast(e.message || 'Failed to create room');
  } finally {
    btn.disabled = false;
    btn.querySelector('span').textContent = 'Generate room';
  }
};

function enterRoom() {
  state.group.markedFinished = false;
  state.group.sessionEndedShown = false;
  state.lastMatch = null;
  $('#rc-code').textContent = state.group.roomCode;
  $('#swipe-controls').hidden = false;
  show('room');
  buildSwipeStack();
  connectToRoom();
}

function buildSwipeStack() {
  const area = $('#swipe-area');
  area.innerHTML = '';
  const remaining = state.group.candidates.slice(state.group.swipeIndex);
  if (remaining.length === 0) {
    area.innerHTML = '<div class="swipe-loading">You\'ve swiped them all. Waiting on the others…</div>';
    $('#swipe-controls').hidden = true;
    state.group.swipedMembers.add(state.group.voterId);
    renderPresence();
    // Tell the server this voter is done with their stack
    if (!state.group.markedFinished) {
      state.group.markedFinished = true;
      postFinish();
    }
    return;
  }
  const visible = remaining.slice(0, 3);
  visible.reverse().forEach((spot, idx) => {
    const reverseIdx = visible.length - 1 - idx;
    const card = createSwipeCard(spot, reverseIdx);
    area.appendChild(card);
  });
  $('#rs-progress').textContent = `${state.group.swipeIndex}/${state.group.candidates.length}`;
  renderSwipeDots();
}

function renderSwipeDots() {
  const dots = $('#swipe-dots');
  const total = state.group.candidates.length;
  if (!total) { dots.hidden = true; return; }
  dots.hidden = false;
  const count = Math.min(total, 5);
  const current = state.group.swipeIndex % count;
  dots.innerHTML = Array.from({ length: count }, (_, i) => `<span class="${i === current ? 'active' : ''}"></span>`).join('');
}

async function postFinish() {
  try {
    const r = await fetch(`/api/room/${state.group.roomCode}/finish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voterId: state.group.voterId }),
    });
    if (!r.ok) return;
    const data = await r.json();
    // If we're the last one done, the server will publish a session-ended event
    // and the channel listener will handle it. But also handle it locally just in case.
    if (data.everyoneDone && data.finalMatches) {
      // Small delay so the server event arrives first if it's going to
      setTimeout(() => {
        if (!state.group.sessionEndedShown) {
          showSessionEnd(data.finalMatches);
        }
      }, 800);
    }
  } catch (e) { console.error(e); }
}

function sourceFriendFor(spot, index) {
  if (index % 3 !== 1) return null;
  return MOCK_FRIENDS[index % MOCK_FRIENDS.length];
}

function createSwipeCard(spot, stackPos) {
  const card = document.createElement('div');
  card.className = 'swipe-card' + (stackPos === 1 ? ' stacked-1' : stackPos === 2 ? ' stacked-2' : '');
  const curatedLabel = state.group.roomCode ? '-Curated for the Group-' : '-Curated for You-';
  const dietaryTag = getDietaryPrefs().values().next().value;
  const friend = sourceFriendFor(spot, state.group.swipeIndex);
  card.innerHTML = `
    <div class="sc-curated">${curatedLabel}</div>
    <hr class="sc-divider" />
    <div class="sc-name">${escapeHtml(spot.name)}</div>
    <div class="sc-meta">
      <span>${escapeHtml(spot.neighborhood || '')}</span>
      ${spot.distance ? `<span class="sc-meta-dot"></span><span>${spot.distance} mi</span>` : ''}
    </div>
    <div class="sc-vibe">${escapeHtml(spot.vibe || spot.why || '')}</div>
    <div class="sc-tags">
      <span class="sc-tag">${escapeHtml(spot.priceLevel || '$$')}</span>
      ${dietaryTag ? `<span class="sc-tag dietary">${escapeHtml(dietaryTag)}</span>` : ''}
    </div>
    ${friend ? `<div class="sc-via">Via ${escapeHtml(friend.name.split(' ')[0])}'s List</div>` : ''}
    <div class="sc-image">${foodIcon('icon-xl')}<span class="sc-image-caption">Insert Image</span></div>
    ${spot.rating ? `<div class="sc-rating"><span class="sc-rating-stars">${starString(spot.rating)}</span><span>${spot.rating.toFixed(1)} · ${spot.reviewCount || 0} reviews</span></div>` : ''}
    <div class="swipe-overlay yes">YES</div>
    <div class="swipe-overlay no">NOPE</div>
  `;
  if (stackPos === 0) attachSwipe(card, spot);
  return card;
}

function attachSwipe(card, spot) {
  let startX = 0, startY = 0, dx = 0, dy = 0, isDragging = false;

  const onStart = (clientX, clientY) => {
    startX = clientX;
    startY = clientY;
    isDragging = true;
    card.classList.add('dragging');
  };

  const onMove = (clientX, clientY) => {
    if (!isDragging) return;
    dx = clientX - startX;
    dy = clientY - startY;
    const rot = dx / 20;
    card.style.transform = `translate(${dx}px, ${dy}px) rotate(${rot}deg)`;
    const yesOv = card.querySelector('.swipe-overlay.yes');
    const noOv = card.querySelector('.swipe-overlay.no');
    yesOv.style.opacity = dx > 30 ? Math.min(1, (dx - 30) / 80) : 0;
    noOv.style.opacity = dx < -30 ? Math.min(1, (-dx - 30) / 80) : 0;
  };

  const onEnd = () => {
    if (!isDragging) return;
    isDragging = false;
    card.classList.remove('dragging');
    if (Math.abs(dx) > 100) {
      const direction = dx > 0 ? 'right' : 'left';
      doSwipe(card, spot, direction);
    } else {
      card.style.transform = '';
      card.querySelector('.swipe-overlay.yes').style.opacity = 0;
      card.querySelector('.swipe-overlay.no').style.opacity = 0;
    }
    dx = 0; dy = 0;
  };

  card.addEventListener('touchstart', e => onStart(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
  card.addEventListener('touchmove', e => onMove(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
  card.addEventListener('touchend', onEnd);
  card.addEventListener('mousedown', e => onStart(e.clientX, e.clientY));
  window.addEventListener('mousemove', e => { if (isDragging) onMove(e.clientX, e.clientY); });
  window.addEventListener('mouseup', onEnd);
}

function doSwipe(card, spot, direction) {
  card.classList.add(direction === 'right' ? 'gone-right' : 'gone-left');
  const vote = direction === 'right' ? 'yes' : 'no';
  state.group.myVotes[spot.id || spot.name] = vote;
  postVote(spot.id || spot.name, vote);
  setTimeout(() => {
    state.group.swipeIndex++;
    buildSwipeStack();
  }, 250);
}

$('#swipe-yes').onclick = () => {
  const card = $('#swipe-area .swipe-card:not(.stacked-1):not(.stacked-2):not(.gone-left):not(.gone-right)');
  if (!card) return;
  const spot = state.group.candidates[state.group.swipeIndex];
  if (spot) doSwipe(card, spot, 'right');
};
$('#swipe-no').onclick = () => {
  const card = $('#swipe-area .swipe-card:not(.stacked-1):not(.stacked-2):not(.gone-left):not(.gone-right)');
  if (!card) return;
  const spot = state.group.candidates[state.group.swipeIndex];
  if (spot) doSwipe(card, spot, 'left');
};

async function postVote(spotId, vote) {
  try {
    await fetch(`/api/room/${state.group.roomCode}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spotId, vote, voterId: state.group.voterId }),
    });
  } catch (e) { console.error(e); }
}

async function connectToRoom() {
  const config = await getPusherConfig();

  if (!config || !config.pusherKey) {
    console.warn('Pusher not configured, falling back to polling');
    startPollingFallback();
    return;
  }

  const Pusher = window.Pusher;
  if (!Pusher) {
    console.warn('Pusher SDK not loaded, falling back to polling');
    startPollingFallback();
    return;
  }

  if (state.group.pusherClient) {
    state.group.pusherClient.disconnect();
  }

  const pusher = new Pusher(config.pusherKey, {
    cluster: config.pusherCluster,
    channelAuthorization: {
      endpoint: '/api/pusher-auth',
      transport: 'ajax',
      params: { user_name: state.group.userName },
    },
  });
  state.group.pusherClient = pusher;

  const channelName = `presence-room-${state.group.roomCode}`;
  const channel = pusher.subscribe(channelName);
  state.group.channel = channel;

  channel.bind('pusher:subscription_succeeded', (members) => {
    state.group.members = {};
    members.each(m => { state.group.members[m.id] = m.info; });
    renderPresence();
  });

  channel.bind('pusher:member_added', (member) => {
    state.group.members[member.id] = member.info;
    renderPresence();
    showVoteFlash(`${member.info.name} joined`);
  });

  channel.bind('pusher:member_removed', (member) => {
    delete state.group.members[member.id];
    renderPresence();
  });

  channel.bind('vote', (data) => {
    if (data.tally) state.group.tallyBySpot[data.spotId] = data.tally.yes;
    if (data.vote === 'yes' && data.voterId !== state.group.voterId) {
      const tallyText = data.tally.yes > 1 ? ` (${data.tally.yes} now)` : '';
      showVoteFlash(`Someone said yes${tallyText}`);
    }
    $('#rs-progress').textContent = `${state.group.swipeIndex}/${state.group.candidates.length}`;
    if (typeof data.totalMatches === 'number') {
      renderMatchesCount(data.totalMatches);
    }
    if (typeof data.participants === 'number') {
      $('#rs-people').textContent = data.participants;
    }
  });

  channel.bind('participants', (data) => {
    if (typeof data.participants === 'number') {
      $('#rs-people').textContent = data.participants;
    }
  });

  channel.bind('match', async (data) => {
    if (Array.isArray(data.allMatches)) {
      state.group.matchedSpots = data.allMatches;
      renderMatchesCount(data.allMatches.length);
    }
    if (state.lastMatch) return;
    const matchSpot = state.group.candidates.find(c => (c.id || c.name) === data.spotId);
    if (matchSpot) showMatch(matchSpot);
  });

  channel.bind('voter-finished', (data) => {
    if (data.voterId && data.voterId !== state.group.voterId) {
      state.group.swipedMembers.add(data.voterId);
      renderPresence();
    }
  });

  channel.bind('session-ended', (data) => {
    if (state.group.sessionEndedShown) return;
    showSessionEnd(data.matches || []);
  });

  channel.bind('pusher:subscription_error', (err) => {
    console.error('Pusher subscription error:', err);
    startPollingFallback();
  });
}

function renderMatchesCount(count) {
  $('#rs-matches').textContent = count;
  const btn = $('#rs-matches-btn');
  if (btn) {
    if (count > 0) btn.classList.add('has-matches');
    else btn.classList.remove('has-matches');
  }
}

function openMatchesDialog() {
  const dialog = $('#matches-modal');
  const list = $('#matches-list');
  const empty = $('#matches-empty');
  list.innerHTML = '';

  const matchSpots = state.group.matchedSpots
    .map(id => state.group.candidates.find(c => (c.id || c.name) === id))
    .filter(Boolean);

  if (matchSpots.length === 0) {
    empty.hidden = false;
  } else {
    empty.hidden = true;
    matchSpots.forEach(spot => {
      const item = document.createElement('div');
      item.className = 'match-item';
      item.innerHTML = `
        <div class="match-item-name">${escapeHtml(spot.name)}</div>
        <div class="match-item-meta">${escapeHtml(spot.cuisine)} · ${escapeHtml(spot.priceLevel || '$$')} · ${escapeHtml(spot.neighborhood || '')}</div>
      `;
      item.onclick = () => {
        dialog.close();
        showMatch(spot);
      };
      list.appendChild(item);
    });
  }
  dialog.showModal();
}

$('#rs-matches-btn').onclick = openMatchesDialog;
$('#close-matches').onclick = () => $('#matches-modal').close();

function renderPresence() {
  const row = $('#presence-row');
  const memberCount = Object.keys(state.group.members).length || 1;
  $('#rs-people').textContent = memberCount;

  if (memberCount <= 1) {
    row.hidden = true;
    return;
  }
  row.hidden = false;
  row.innerHTML = Object.entries(state.group.members).map(([id, info]) => {
    const swiped = state.group.swipedMembers.has(id);
    return `<span class="presence-chip${swiped ? ' swiped' : ''}"><span class="dot"></span>${escapeHtml(info.name || 'Anon')}</span>`;
  }).join('');
}

function showVoteFlash(msg) {
  const el = document.createElement('div');
  el.className = 'vote-flash';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1400);
}

function startPollingFallback() {
  if (state.group.pollInterval) clearInterval(state.group.pollInterval);
  state.group.pollInterval = setInterval(async () => {
    try {
      const r = await fetch(`/api/room/${state.group.roomCode}/state`);
      if (!r.ok) return;
      const data = await r.json();
      $('#rs-people').textContent = data.participants;
      renderMatchesCount(data.matches.length);
      state.group.matchedSpots = data.matches;
      if (data.matches.length > 0 && !state.lastMatch) {
        const matchSpot = state.group.candidates.find(c => (c.id || c.name) === data.matches[0]);
        if (matchSpot) showMatch(matchSpot);
      }
    } catch (e) { console.error(e); }
  }, 2000);
}

function disconnectRoom() {
  if (state.group.pusherClient) {
    state.group.pusherClient.disconnect();
    state.group.pusherClient = null;
    state.group.channel = null;
  }
  if (state.group.pollInterval) {
    clearInterval(state.group.pollInterval);
    state.group.pollInterval = null;
  }
  state.group.members = {};
  state.group.swipedMembers = new Set();
}

function showSessionEnd(matchIds) {
  state.group.sessionEndedShown = true;
  const matchSpots = (matchIds || [])
    .map(id => state.group.candidates.find(c => (c.id || c.name) === id))
    .filter(Boolean);

  const title = $('#se-title');
  const sub = $('#se-sub');
  const list = $('#session-matches-list');
  list.innerHTML = '';

  if (matchSpots.length === 0) {
    title.textContent = 'No overlap.';
    sub.textContent = "You all had different tastes. Time to compromise — or try again.";
    list.innerHTML = `
      <div class="no-matches-state">
        <div class="icon">${foodIcon('icon-xl')}</div>
        <div>Nobody agreed on anything. Maybe expand the cuisines next time?</div>
      </div>
    `;
  } else {
    if (matchSpots.length === 1) {
      title.textContent = 'One match.';
      sub.textContent = "Looks like the only place you all agreed on.";
    } else {
      title.textContent = `${matchSpots.length} matches.`;
      sub.textContent = "Places you all agreed on. Pick one together.";
    }
    matchSpots.forEach(spot => {
      const card = document.createElement('div');
      card.className = 'session-match-card';
      card.innerHTML = `
        <div class="smc-name">${escapeHtml(spot.name)}</div>
        <div class="smc-meta">${escapeHtml(spot.cuisine)} · ${escapeHtml(spot.priceLevel || '$$')} · ${escapeHtml(spot.neighborhood || '')}</div>
        <div class="smc-vibe">${escapeHtml(spot.vibe || spot.why || '')}</div>
        <div class="smc-actions">
          <button class="smc-btn primary" data-action="directions">Directions</button>
          <button class="smc-btn" data-action="details">Details</button>
        </div>
      `;
      card.querySelector('[data-action="directions"]').onclick = (e) => {
        e.stopPropagation();
        const q = encodeURIComponent(`${spot.name} ${spot.address || state.group.location}`);
        window.open(`https://www.google.com/maps/search/?api=1&query=${q}`, '_blank');
      };
      card.querySelector('[data-action="details"]').onclick = (e) => {
        e.stopPropagation();
        showMatch(spot);
      };
      list.appendChild(card);
    });
  }
  show('session-end');
}

$('#se-restart').onclick = () => {
  disconnectRoom();
  state.lastMatch = null;
  state.group.roomCode = null;
  state.group.candidates = [];
  state.group.swipeIndex = 0;
  state.group.myVotes = {};
  state.group.matchedSpots = [];
  state.group.markedFinished = false;
  state.group.sessionEndedShown = false;
  show('home');
  renderRecents();
};

function showMatch(spot) {
  state.lastMatch = spot;
  // Don't disconnect — user might want to keep swiping for more matches
  $('#match-image').innerHTML = foodIcon('icon-xl');
  $('#match-name').textContent = spot.name;
  $('#match-meta').textContent = `${spot.cuisine} · ${spot.priceLevel || '$$'} · ${spot.neighborhood || ''}`;
  $('#match-why').textContent = spot.why || spot.vibe || '';
  const dietaryTag = getDietaryPrefs().values().next().value;
  const spotIndex = state.group.candidates.findIndex(c => (c.id || c.name) === (spot.id || spot.name));
  const friend = sourceFriendFor(spot, spotIndex >= 0 ? spotIndex : 0);
  $('#match-tags').innerHTML = `
    <span class="match-tag">${escapeHtml(dietaryTag || spot.cuisine)}</span>
    ${friend ? `<span class="match-tag">${escapeHtml(friend.name.split(' ')[0])}'s list</span>` : ''}
  `;
  const tally = state.group.tallyBySpot && state.group.tallyBySpot[spot.id || spot.name];
  const votesEl = $('#match-votes');
  if (typeof tally === 'number' && tally > 0) {
    votesEl.hidden = false;
    votesEl.textContent = `${tally} Vote${tally === 1 ? '' : 's'}`;
  } else {
    votesEl.hidden = true;
  }
  $('#match-room-code').textContent = state.group.roomCode ? `ROOM ${state.group.roomCode} ~` : '';
  $('#match-directions').onclick = () => {
    const q = encodeURIComponent(`${spot.name} ${spot.address || state.group.location}`);
    window.open(`https://www.google.com/maps/search/?api=1&query=${q}`, '_blank');
  };
  $('#match-call').onclick = () => {
    if (spot.phone) window.location.href = `tel:${spot.phone}`;
    else toast('No phone number on file');
  };
  const recents = state.recents.filter(r => r.name !== spot.name).slice(0, 4);
  recents.unshift({ name: spot.name, cuisine: spot.cuisine, when: Date.now() });
  state.recents = recents;
  localStorage.setItem('forknife:recents', JSON.stringify(recents));
  show('match');
}

$('#match-keep-swiping').onclick = () => {
  state.lastMatch = null; // Allow showing future matches
  show('room');
};

$('#match-reset').onclick = () => {
  disconnectRoom();
  state.lastMatch = null;
  state.group.roomCode = null;
  state.group.candidates = [];
  state.group.swipeIndex = 0;
  state.group.myVotes = {};
  state.group.matchedSpots = [];
  state.group.markedFinished = false;
  state.group.sessionEndedShown = false;
  show('home');
  renderRecents();
};

$('#share-room-btn').onclick = async () => {
  const url = `${window.location.origin}/?join=${state.group.roomCode}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Fed Up', text: `Help us decide where to eat. Room code: ${state.group.roomCode}`, url });
    } catch (e) {}
  } else {
    await navigator.clipboard.writeText(url);
    toast('Link copied');
  }
};

function renderRecents() {
  if (state.recents.length === 0) return;
  $('#recents-section').hidden = false;
  const list = $('#recents-list');
  list.innerHTML = state.recents.map(r => `<div style="font-family:var(--display);font-weight:600;font-size:16px;color:var(--ink-soft);margin-bottom:4px;">${escapeHtml(r.name)} <span style="color:var(--ink-fade);font-size:13px;">— ${escapeHtml(r.cuisine)}</span></div>`).join('');
}

// Overrides the generic `.back-btn` disconnect-and-navigate behavior —
// leaving the match screen shouldn't drop the live room connection.
$('#match-back').onclick = () => {
  state.lastMatch = null;
  show('room');
};

/* ---------- Onboarding / Login ----------
   Cosmetic only — there's no account backend. "Logging in" just captures
   a local display name (same mechanism group mode already uses) and
   unlocks the app; nothing is sent anywhere or verified. */
$('#onboarding-start').onclick = () => {
  localStorage.setItem('forknife:onboarded', '1');
  show(localStorage.getItem('forknife:loggedIn') ? 'home' : 'login');
};

function completeLogin() {
  localStorage.setItem('forknife:loggedIn', '1');
  getOrCreateUserName();
  show('home');
  buildProfileScreen();
  renderRecents();
}
$('#login-google-btn').onclick = completeLogin;
$('#login-submit').onclick = completeLogin;
$('#login-signup-toggle').onclick = completeLogin;

/* ---------- Bottom nav ---------- */
$$('#bottom-nav button').forEach(b => {
  b.onclick = () => {
    const target = b.dataset.nav;
    if (target === 'saved') buildSavedScreen();
    if (target === 'profile') buildProfileScreen();
    show(target);
  };
});

/* ---------- Saved: Been There / Wish List (localStorage-backed) ---------- */
function savedKey(tab) { return tab === 'been' ? 'forknife:beenThere' : 'forknife:wishlist'; }
function getSavedList(tab) { return JSON.parse(localStorage.getItem(savedKey(tab)) || '[]'); }
function setSavedList(tab, list) { localStorage.setItem(savedKey(tab), JSON.stringify(list)); }

function renderPlaceList(containerSel, items, { emptyText, onRemove }) {
  const list = $(containerSel);
  if (items.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="icon">${foodIcon('icon-xl')}</div><p>${emptyText}</p></div>`;
    return;
  }
  list.innerHTML = items.map((r, i) => `
    <div class="saved-item">
      <div class="saved-item-icon">${foodIcon('icon-md')}</div>
      <div class="saved-item-body"><div class="saved-item-name">${escapeHtml(r.name)}</div></div>
      <div class="saved-item-meta">${escapeHtml(r.cuisine)} ${escapeHtml(r.priceLevel || '')}<br>${escapeHtml(r.neighborhood || '')}</div>
      ${onRemove ? `<button class="saved-item-remove" data-remove="${i}" aria-label="Remove">×</button>` : ''}
    </div>
  `).join('');
  if (onRemove) {
    $$(`${containerSel} [data-remove]`).forEach(btn => {
      btn.onclick = () => onRemove(parseInt(btn.dataset.remove));
    });
  }
}

function buildSavedScreen() {
  const q = $('#saved-search').value.trim().toLowerCase();
  const items = getSavedList('been').filter(r => !q || r.name.toLowerCase().includes(q));
  renderPlaceList('#saved-list', items, {
    emptyText: "You haven't marked anywhere as visited yet.",
    onRemove: (i) => { setSavedList('been', getSavedList('been').filter((_, idx) => idx !== i)); buildSavedScreen(); },
  });
}
$('#saved-search').oninput = () => buildSavedScreen();
$('#mark-visited-btn').onclick = () => openMarkVisitedModal('been');

state.viewingFriend = null;

function buildWishlistScreen(friend = null) {
  state.viewingFriend = friend;
  const backBtn = $('#wishlist-back');
  const searchBar = $('#wishlist-search-bar');
  if (friend) {
    const first = friend.name.split(' ')[0];
    $('#wishlist-title').textContent = `${first}'s Wishlist`;
    $('#wishlist-sub').textContent = `Places ${first} wants to try…`;
    backBtn.hidden = false;
    searchBar.hidden = true;
    renderPlaceList('#wishlist-list', friend.wishlist, { emptyText: 'Nothing on this wish list yet.' });
  } else {
    $('#wishlist-title').textContent = 'Wish List';
    $('#wishlist-sub').textContent = 'Places on the bucket list….';
    backBtn.hidden = true;
    searchBar.hidden = false;
    const q = $('#wishlist-search').value.trim().toLowerCase();
    const items = getSavedList('wish').filter(r => !q || r.name.toLowerCase().includes(q));
    renderPlaceList('#wishlist-list', items, {
      emptyText: 'Nothing on your wish list yet — search above to add a place.',
      onRemove: (i) => { setSavedList('wish', getSavedList('wish').filter((_, idx) => idx !== i)); buildWishlistScreen(); },
    });
  }
}
$('#wishlist-search').oninput = () => buildWishlistScreen();
$('#wishlist-search-bar').addEventListener('click', () => { if (!state.viewingFriend) openMarkVisitedModal('wish'); });
$('#wishlist-back').onclick = () => { state.viewingFriend = null; buildFriendsScreen(); show('friends'); };

let markVisitedTargetTab = 'been';
function openMarkVisitedModal(tab) {
  markVisitedTargetTab = tab;
  $('#mark-visited-modal h3').textContent = tab === 'been' ? 'Mark a place as visited' : 'Add to your wish list';
  $('#mark-visited-location').value = state.solo.location || '';
  $('#mark-visited-input').value = '';
  $('#mark-visited-results').innerHTML = '';
  $('#mark-visited-modal').showModal();
}
$('#mark-visited-search-btn').onclick = async () => {
  const loc = $('#mark-visited-location').value.trim();
  const q = $('#mark-visited-input').value.trim();
  if (!loc) { toast('Where are you?'); return; }
  const btn = $('#mark-visited-search-btn');
  btn.disabled = true;
  try {
    const data = await fetchRestaurants({ location: loc, cuisines: q ? [q] : [], vetoes: [], price: '$$$$', distance: 25, count: 6 });
    const results = data.restaurants || [];
    const resultsEl = $('#mark-visited-results');
    resultsEl.innerHTML = results.length
      ? results.map((r, i) => `<div class="saved-item" data-add="${i}" style="cursor:pointer;"><div class="saved-item-icon">${foodIcon('icon-md')}</div><div class="saved-item-body"><div class="saved-item-name">${escapeHtml(r.name)}</div></div><div class="saved-item-meta">${escapeHtml(r.cuisine)}</div></div>`).join('')
      : '<p class="modal-fine">No results — try a different search.</p>';
    $$('#mark-visited-results [data-add]').forEach(el => {
      el.onclick = () => {
        const spot = results[parseInt(el.dataset.add)];
        const list = getSavedList(markVisitedTargetTab);
        if (!list.some(x => x.name === spot.name)) list.push(spot);
        setSavedList(markVisitedTargetTab, list);
        $('#mark-visited-modal').close();
        if (markVisitedTargetTab === 'been') buildSavedScreen(); else buildWishlistScreen();
        toast(markVisitedTargetTab === 'been' ? 'Marked as visited' : 'Added to wish list');
      };
    });
  } catch (e) {
    toast(e.message || 'Search failed');
  } finally {
    btn.disabled = false;
  }
};

/* ---------- Friends ---------- */
function buildFriendsScreen() {
  const q = $('#friends-search').value.trim().toLowerCase();
  const friends = MOCK_FRIENDS.filter(f => !q || f.name.toLowerCase().includes(q));
  const list = $('#friends-list');
  if (friends.length === 0) {
    list.innerHTML = `<div class="empty-state"><p>No friends match "${escapeHtml(q)}".</p></div>`;
    return;
  }
  list.innerHTML = friends.map((f, i) => `
    <div class="friend-row">
      <span class="friend-name">${escapeHtml(f.name)}</span>
      <button class="friend-list-chip" data-friend="${i}">${escapeHtml(f.name.split(' ')[0])}'s Wishlist</button>
    </div>
  `).join('');
  $$('#friends-list [data-friend]').forEach(btn => {
    btn.onclick = () => {
      buildWishlistScreen(friends[parseInt(btn.dataset.friend)]);
      show('wishlist');
    };
  });
}
$('#friends-search').oninput = () => buildFriendsScreen();

/* ---------- Profile ---------- */
function getDietaryPrefs() { return new Set(JSON.parse(localStorage.getItem('forknife:dietaryPrefs') || '[]')); }

function buildProfileScreen() {
  const name = getOrCreateUserName();
  $('#profile-name').textContent = name;
  $('#profile-avatar').textContent = (name.trim()[0] || '?').toUpperCase();
  $('#profile-been-count').textContent = getSavedList('been').length;
  $('#profile-wishlist-count').textContent = getSavedList('wish').length;
  renderDietary('#profile-dietary', getDietaryPrefs(), (opt) => {
    const set = getDietaryPrefs();
    if (set.has(opt)) set.delete(opt); else set.add(opt);
    localStorage.setItem('forknife:dietaryPrefs', JSON.stringify(Array.from(set)));
    buildProfileScreen();
  });
}

$('#profile-edit-btn').onclick = () => {
  $('#profile-name-input').value = getOrCreateUserName();
  $('#edit-profile-modal').showModal();
};
$('#profile-name-save').onclick = () => {
  const val = $('#profile-name-input').value.trim();
  if (val) localStorage.setItem('forknife:userName', val);
  $('#edit-profile-modal').close();
  buildProfileScreen();
};
$('#profile-been-link').onclick = () => { buildSavedScreen(); show('saved'); };
$('#profile-wishlist-link').onclick = () => { buildWishlistScreen(); show('wishlist'); };
$('#profile-friends-link').onclick = () => { buildFriendsScreen(); show('friends'); };
$('#profile-settings-link').onclick = () => toast('Settings coming soon');

/* ---------- Init ---------- */
const urlParams = new URLSearchParams(window.location.search);
const joinCode = urlParams.get('join');
if (joinCode) {
  show('group-start');
  $('#room-code-input').value = joinCode.toUpperCase().slice(0, 4);
  if ($('#room-code-input').value.length === 4) $('#join-confirm').click();
} else if (!localStorage.getItem('forknife:onboarded')) {
  show('onboarding');
} else if (!localStorage.getItem('forknife:loggedIn')) {
  show('login');
} else {
  show('home');
}

renderRecents();
