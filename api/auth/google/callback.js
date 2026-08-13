import { sql, requireDb } from '../../_db.js';
import { getOrigin, parseCookies, cookieString, createSession, setSessionCookie } from '../../_auth.js';

const OAUTH_STATE_COOKIE = 'fedup_oauth_state';

function decodeIdToken(idToken) {
  const payload = idToken.split('.')[1];
  const json = Buffer.from(payload, 'base64url').toString('utf8');
  return JSON.parse(json);
}

export default async function handler(req, res) {
  const origin = getOrigin(req);
  const url = new URL(req.url, origin);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const errorParam = url.searchParams.get('error');

  // Always clear the one-time state cookie regardless of outcome.
  res.setHeader('Set-Cookie', cookieString(OAUTH_STATE_COOKIE, '', 0));

  if (errorParam) {
    return res.redirect(302, `/?authError=${encodeURIComponent(errorParam)}`);
  }

  const expectedState = parseCookies(req)[OAUTH_STATE_COOKIE];
  if (!code || !state || !expectedState || state !== expectedState) {
    return res.redirect(302, '/?authError=invalid_state');
  }

  try {
    requireDb();
    const redirectUri = `${origin}/api/auth/google/callback`;
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) {
      console.error('Google token exchange failed:', await tokenRes.text());
      return res.redirect(302, '/?authError=token_exchange_failed');
    }
    const tokens = await tokenRes.json();
    const claims = decodeIdToken(tokens.id_token);
    const googleId = claims.sub;
    const email = (claims.email || '').toLowerCase();
    const name = claims.name || email.split('@')[0] || 'Fed Up user';

    let { rows } = await sql`SELECT id FROM users WHERE google_id = ${googleId}`;
    let user = rows[0];

    if (!user && email) {
      const byEmail = await sql`SELECT id FROM users WHERE email = ${email}`;
      if (byEmail.rows[0]) {
        await sql`UPDATE users SET google_id = ${googleId} WHERE id = ${byEmail.rows[0].id}`;
        user = byEmail.rows[0];
      }
    }

    if (!user) {
      const inserted = await sql`
        INSERT INTO users (email, name, auth_provider, google_id)
        VALUES (${email}, ${name}, 'google', ${googleId})
        RETURNING id
      `;
      user = inserted.rows[0];
    }

    const sessionId = await createSession(user.id);
    setSessionCookie(res, sessionId);
    return res.redirect(302, '/?authed=google');
  } catch (e) {
    console.error('Google callback error:', e);
    return res.redirect(302, '/?authError=server_error');
  }
}
