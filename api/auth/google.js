import { randomBytes } from 'node:crypto';
import { getOrigin, cookieString } from '../_auth.js';

const OAUTH_STATE_COOKIE = 'fedup_oauth_state';

export default function handler(req, res) {
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
