const CUISINES = ['Pizza','Burgers','Mexican','Chinese','Thai','Japanese','Italian','Indian','BBQ','Sushi','Mediterranean','Vietnamese','Korean','American','Breakfast','Seafood','Vegetarian','Dessert'];
const PRICES = ['$','$$','$$$','$$$$'];

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
  },
  lastMatch: null,
  recents: JSON.parse(localStorage.getItem('forknife:recents') || '[]'),
};

function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }

function show(screenId) {
  $$('.screen').forEach(s => s.classList.remove('active'));
  $(`#screen-${screenId}`).classList.add('active');
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
  renderPills('#solo-cuisines', CUISINES, state.solo.cuisines, null, state.solo.vetoes);
  renderPills('#solo-vetoes', CUISINES, state.solo.vetoes, 'veto', state.solo.cuisines);
  const onSoloPrice = (p) => { state.solo.price = p; renderPrice('#solo-price', state.solo.price, onSoloPrice); };
  renderPrice('#solo-price', state.solo.price, onSoloPrice);
}

function buildGroupSetupScreen() {
  renderPills('#group-cuisines', CUISINES, state.group.cuisines, null, null);
  const onGroupPrice = (p) => { state.group.price = p; renderPrice('#group-price', state.group.price, onGroupPrice); };
  renderPrice('#group-price', state.group.price, onGroupPrice);
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
    (pos) => {
      const { latitude, longitude } = pos.coords;
      $('#solo-location').value = `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
      $('#solo-location').dataset.coords = `${latitude},${longitude}`;
      $('#use-my-location').textContent = 'Location set ✓';
    },
    () => {
      $('#use-my-location').textContent = 'Use my location';
      toast('Could not get location');
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
    btn.querySelector('span').textContent = 'Foogle it';
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
    ${spot.openNow !== undefined ? `<div class="detail-section"><h4>Status</h4><p>${spot.openNow ? '<span style="color:var(--olive)">Open now</span>' : '<span style="color:var(--accent)">Closed</span>'}</p></div>` : ''}
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
  $('#join-input-wrap').hidden = false;
  $('#room-code-input').focus();
};

$('#room-code-input').oninput = (e) => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
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

function createSwipeCard(spot, stackPos) {
  const card = document.createElement('div');
  card.className = 'swipe-card' + (stackPos === 1 ? ' stacked-1' : stackPos === 2 ? ' stacked-2' : '');
  card.innerHTML = `
    <div class="sc-cuisine">${escapeHtml(spot.cuisine)}</div>
    <div class="sc-name">${escapeHtml(spot.name)}</div>
    <div class="sc-meta">
      <span>${escapeHtml(spot.priceLevel || '$$')}</span>
      <span class="sc-meta-dot"></span>
      <span>${escapeHtml(spot.neighborhood || '')}</span>
    </div>
    <div class="sc-vibe">${escapeHtml(spot.vibe || spot.why || '')}</div>
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
        <div class="icon">🤷</div>
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
  $('#match-name').textContent = spot.name;
  $('#match-meta').textContent = `${spot.cuisine} · ${spot.priceLevel || '$$'} · ${spot.neighborhood || ''}`;
  $('#match-why').textContent = spot.why || spot.vibe || '';
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
      await navigator.share({ title: 'Foogle', text: `Help us decide where to eat. Room code: ${state.group.roomCode}`, url });
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
  list.innerHTML = state.recents.map(r => `<div style="font-family:var(--serif);font-size:16px;color:var(--ink-soft);margin-bottom:4px;">${escapeHtml(r.name)} <span style="color:var(--ink-fade);font-size:13px;">— ${escapeHtml(r.cuisine)}</span></div>`).join('');
}

const urlParams = new URLSearchParams(window.location.search);
const joinCode = urlParams.get('join');
if (joinCode) {
  show('group-start');
  $('#join-input-wrap').hidden = false;
  $('#room-code-input').value = joinCode.toUpperCase();
}

renderRecents();
