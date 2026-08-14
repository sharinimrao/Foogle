// Consolidated auth endpoint: signup / login / logout / google (redirect
// initiator) all live here as one Serverless Function, dispatched by
// ?action=, to stay under the Hobby plan's 12-function deployment cap.
// /api/auth/google/callback stays a separate file since its path is
// registered as a fixed redirect URI in Google Cloud Console.
import { randomBytes } from 'node:crypto';
import { sql, requireDb } from './_db.js';
import {
  hashPassword, verifyPassword, createSession, setSessionCookie,
  clearSessionCookie, parseCookies, SESSION_COOKIE, getOrigin, cookieString, requireAuth,
} from './_auth.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OAUTH_STATE_COOKIE = 'fedup_oauth_state';

export default async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const action = url.searchParams.get('action');

  if (action === 'google') return handleGoogleStart(req, res);
  if (action === 'signup') return handleSignup(req, res);
  if (action === 'login') return handleLogin(req, res);
  if (action === 'logout') return handleLogout(req, res);
  if (action === 'change-password') return handleChangePassword(req, res);
  return res.status(404).json({ error: 'Not found' });
}

function handleGoogleStart(req, res) {
  if (!process.env.GOOGLE_CLIENT_ID) {
    return res.status(503).send('Google sign-in is not configured yet — missing GOOGLE_CLIENT_ID.');
  }
  const state = randomBytes(16).toString('hex');
  res.setHeader('Set-Cookie', cookieString(OAUTH_STATE_COOKIE, state, 600));

  const redirectUri = `${getOrigin(req)}/api/auth/google/callback`;
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  res.redirect(302, `https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}

async function handleSignup(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    requireDb();
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const email = (body.email || '').trim().toLowerCase();
    const password = body.password || '';
    const name = (body.name || '').trim();

    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email' });
    if (password.length < 8) return res.status(400).json({ error: 'Password needs at least 8 characters' });
    if (!name) return res.status(400).json({ error: 'Name is required' });

    const existing = await sql`SELECT id FROM users WHERE email = ${email}`;
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'An account with that email already exists' });
    }

    const passwordHash = await hashPassword(password);
    const { rows } = await sql`
      INSERT INTO users (email, name, auth_provider, password_hash)
      VALUES (${email}, ${name}, 'local', ${passwordHash})
      RETURNING id, email, name, auth_provider, created_at
    `;
    const user = rows[0];
    const sessionId = await createSession(user.id);
    setSessionCookie(res, sessionId);
    return res.status(200).json({ user });
  } catch (e) {
    console.error('Signup error:', e);
    return res.status(e.statusCode || 500).json({ error: e.message });
  }
}

async function handleLogin(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    requireDb();
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const email = (body.email || '').trim().toLowerCase();
    const password = body.password || '';

    const { rows } = await sql`SELECT * FROM users WHERE email = ${email}`;
    const user = rows[0];

    if (!user || user.auth_provider !== 'local') {
      return res.status(401).json({ error: user ? 'That account uses Google sign-in' : 'Wrong email or password' });
    }
    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Wrong email or password' });

    const sessionId = await createSession(user.id);
    setSessionCookie(res, sessionId);
    return res.status(200).json({ user: { id: user.id, email: user.email, name: user.name, auth_provider: user.auth_provider, created_at: user.created_at } });
  } catch (e) {
    console.error('Login error:', e);
    return res.status(e.statusCode || 500).json({ error: e.message });
  }
}

async function handleChangePassword(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    requireDb();
    const user = await requireAuth(req, res);
    if (!user) return;

    const { rows } = await sql`SELECT auth_provider, password_hash FROM users WHERE id = ${user.id}`;
    const row = rows[0];
    if (!row || row.auth_provider !== 'local') {
      return res.status(400).json({ error: 'This account signs in with Google — no password to change' });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const currentPassword = body.currentPassword || '';
    const newPassword = body.newPassword || '';

    const ok = await verifyPassword(currentPassword, row.password_hash);
    if (!ok) return res.status(401).json({ error: 'Current password is incorrect' });
    if (newPassword.length < 8) return res.status(400).json({ error: 'New password needs at least 8 characters' });

    const newHash = await hashPassword(newPassword);
    await sql`UPDATE users SET password_hash = ${newHash} WHERE id = ${user.id}`;
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('Change password error:', e);
    return res.status(e.statusCode || 500).json({ error: e.message });
  }
}

async function handleLogout(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const sessionId = parseCookies(req)[SESSION_COOKIE];
    if (sessionId) await sql`DELETE FROM sessions WHERE id = ${sessionId}`;
    clearSessionCookie(res);
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('Logout error:', e);
    clearSessionCookie(res);
    return res.status(200).json({ ok: true });
  }
}
