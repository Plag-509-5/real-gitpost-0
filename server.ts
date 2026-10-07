import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pendingOAuthStates = new Map();
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const getPublicOrigin = (req) => {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = forwardedProto || req.protocol;
  return `${protocol}://${req.get('host')}`;
};

async function startServer() {
  const app = express();
  const PORT = Number.parseInt(process.env.PORT || process.env.SERVER_PORT || '3000', 10);
  app.set('trust proxy', true);
  app.use(express.json());

  app.get('/api/auth/config', (_req, res) => res.json({
    oauthConfigured: Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
    clientId: process.env.GITHUB_CLIENT_ID || null,
  }));

  app.get('/api/auth/url', (req, res) => {
    const { GITHUB_CLIENT_ID: clientId } = process.env;
    if (!clientId || !process.env.GITHUB_CLIENT_SECRET) {
      return res.status(503).json({ error: 'GitHub OAuth n’est pas configuré sur le serveur.' });
    }
    const state = crypto.randomBytes(32).toString('hex');
    const origin = getPublicOrigin(req);
    const redirectUri = `${origin}/auth/callback`;
    pendingOAuthStates.set(state, { redirectUri, origin, expiresAt: Date.now() + 10 * 60 * 1000 });
    const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, state, scope: 'repo,user' });
    res.json({ url: `https://github.com/login/oauth/authorize?${params}` });
  });

  app.get(['/auth/callback', '/auth/callback/'], async (req, res) => {
    const { code, state, error, error_description: errorDescription } = req.query;
    const pending = typeof state === 'string' ? pendingOAuthStates.get(state) : undefined;
    if (typeof state !== 'string' || !pending || pending.expiresAt < Date.now()) {
      return res.status(400).send('État OAuth invalide ou expiré. Recommencez la connexion depuis GitPost.');
    }
    pendingOAuthStates.delete(state);
    if (error || typeof code !== 'string') {
      return sendPopup(res, pending.origin, 'OAUTH_AUTH_ERROR', String(errorDescription || error || 'Connexion annulée par GitHub.'));
    }
    try {
      const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST', headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: process.env.GITHUB_CLIENT_ID, client_secret: process.env.GITHUB_CLIENT_SECRET, code, redirect_uri: pending.redirectUri }),
      });
      const data = await tokenResponse.json();
      if (!tokenResponse.ok || data.error || !data.access_token) throw new Error(data.error_description || data.error || 'Échange du code OAuth impossible.');
      return sendPopup(res, pending.origin, 'OAUTH_AUTH_SUCCESS', data.access_token);
    } catch (err) {
      console.error('OAuth error:', err);
      return sendPopup(res, pending.origin, 'OAUTH_AUTH_ERROR', err instanceof Error ? err.message : 'Erreur OAuth inconnue.');
    }
  });

  const distPath = path.join(process.cwd(), 'dist');
  const hasDist = fs.existsSync(path.join(distPath, 'index.html'));
  if (process.env.NODE_ENV === 'production' || hasDist) {
    app.use(express.static(distPath));
    app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  }
  app.listen(PORT, '0.0.0.0', () => console.log(`[GitPost Server] running on port ${PORT}`));
}

function sendPopup(res, origin, type, value) {
  const message = JSON.stringify({ type, ...(type === 'OAUTH_AUTH_SUCCESS' ? { token: value } : { error: value }) });
  res.type('html').send(`<!doctype html><html><body><p>Traitement de la connexion…</p><script>const message=${message};if(window.opener){window.opener.postMessage(message,${JSON.stringify(origin)});window.close();}else{window.location.href='/';}</script></body></html>`);
}

startServer();
