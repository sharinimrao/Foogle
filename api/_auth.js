import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { sql } from './_db.js';

const scrypt = promisify(scryptCb);

export const SESSION_COOKIE = 'fedup_session';
const SESSION_DAYS = 30;

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${derived.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  if (!stored) return false;
  const [scheme, salt, hashHex] = stored.split(':');
  if (scheme !== 'scrypt' || !salt || !hashHex) return false;
  const derived = await scrypt(password, salt, 64);
  const stored_ = Buffer.from(hashHex, 'hex');
  if (derived.length !== stored_.length) return false;
  return timingSafeEqual(derived, stored_);
}

export function getOrigin(req) {
  const host = req.headers.host;
  const proto = host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https';
  return `${proto}://${host}`;
}

export function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(';').forEach(part => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    out[key] = decodeURIComponent(val);
  });
  return out;
}

export function cookieString(name, value, maxAgeSeconds) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Secure'];
  if (maxAgeSeconds !== undefined) parts.push(`Max-Age=${maxAgeSeconds}`);
  return parts.join('; ');
}

export async function createSession(userId) {
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  const { rows } = await sql`
    INSERT INTO sessions (user_id, expires_at) VALUES (${userId}, ${expiresAt.toISOString()})
    RETURNING id
  `;
  return rows[0].id;
}

export function setSessionCookie(res, sessionId) {
  res.setHeader('Set-Cookie', cookieString(SESSION_COOKIE, sessionId, SESSION_DAYS * 24 * 60 * 60));
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', cookieString(SESSION_COOKIE, '', 0));
}

export async function getSessionUser(req) {
  const cookies = parseCookies(req);
  const sessionId = cookies[SESSION_COOKIE];
  if (!sessionId) return null;
  const { rows } = await sql`
    SELECT u.id, u.email, u.name, u.auth_provider, u.created_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.id = ${sessionId} AND s.expires_at > now()
  `;
  return rows[0] || null;
}

// Route helper: resolves the current user or writes a 401 and returns null.
export async function requireAuth(req, res) {
  const user = await getSessionUser(req);
  if (!user) {
    res.status(401).json({ error: 'Not signed in' });
    return null;
  }
  return user;
}
