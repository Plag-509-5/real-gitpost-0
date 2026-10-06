/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : (process.env.SERVER_PORT ? parseInt(process.env.SERVER_PORT, 10) : 3000);

  app.use(express.json());

  // API Route for OAuth link creation
  app.get('/api/auth/url', (req, res) => {
    const clientId = process.env.GITHUB_CLIENT_ID || 'Ov23lij9FV7cWuIhzmYs';
    if (!clientId) {
      return res.status(400).json({ error: 'GITHUB_CLIENT_ID non configuré sur le serveur.' });
    }

    // Dynamic redirect URI construction
    const host = req.get('host');
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const redirectUri = `${protocol}://${host}/auth/callback`;

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: 'repo,user',
    });

    res.json({ url: `https://github.com/login/oauth/authorize?${params.toString()}` });
  });

  // API Route to check if GitHub OAuth is configured on this deployment
  app.get('/api/auth/config', (req, res) => {
    const clientId = process.env.GITHUB_CLIENT_ID || 'Ov23lij9FV7cWuIhzmYs';
    const clientSecret = process.env.GITHUB_CLIENT_SECRET || 'c429644effb5dbb6f99bd9b1fbea9ad987ea0e46';
    res.json({
      oauthConfigured: !!(clientId && clientSecret),
      clientId: clientId || null,
    });
  });

  // OAuth Callback Route
  app.get(['/auth/callback', '/auth/callback/'], async (req, res) => {
    const { code } = req.query;

    if (!code) {
      return res.send(`
        <!DOCTYPE html>
        <html>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'OAUTH_AUTH_ERROR', error: 'Code de vérification manquant' }, '*');
                window.close();
              } else {
                window.location.href = '/';
              }
            </script>
            <p>Erreur d'authentification : code manquant.</p>
          </body>
        </html>
      `);
    }

    try {
      const clientId = process.env.GITHUB_CLIENT_ID || 'Ov23lij9FV7cWuIhzmYs';
      const clientSecret = process.env.GITHUB_CLIENT_SECRET || 'c429644effb5dbb6f99bd9b1fbea9ad987ea0e46';

      if (!clientId || !clientSecret) {
        throw new Error('GITHUB_CLIENT_ID ou GITHUB_CLIENT_SECRET non configuré sur le serveur.');
      }

      // Exchange code for token
      const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
        }),
      });

      if (!tokenResponse.ok) {
        throw new Error(`Erreur lors de l'échange de jeton : ${tokenResponse.statusText}`);
      }

      const data = await tokenResponse.json();

      if (data.error) {
        throw new Error(`Erreur GitHub : ${data.error_description || data.error}`);
      }

      const accessToken = data.access_token;

      // HTML response sending the token via postMessage to parent window
      res.send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Connexion GitPost Réussie</title>
            <style>
              body { font-family: sans-serif; text-align: center; padding: 40px; color: #1e293b; background: #f8fafc; }
              .spinner { border: 4px solid #f3f3f3; border-top: 4px solid #0284c7; border-radius: 50%; width: 30px; height: 30px; animation: spin 1s linear infinite; margin: 20px auto; }
              @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
            </style>
          </head>
          <body>
            <div class="spinner"></div>
            <h2>Connexion réussie !</h2>
            <p>Transmission de l'accès à GitPost, cette fenêtre va se fermer...</p>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', token: '${accessToken}' }, '*');
                setTimeout(() => {
                  window.close();
                }, 100);
              } else {
                window.location.href = '/';
              }
            </script>
          </body>
        </html>
      `);
    } catch (err) {
      console.error('OAuth error:', err);
      res.send(`
        <!DOCTYPE html>
        <html>
          <body style="font-family: sans-serif; text-align: center; padding: 40px; color: #e11d48;">
            <h2>Erreur de Connexion</h2>
            <p>${err?.message || "Impossible d'échanger le code contre un jeton d'accès."}</p>
            <button onclick="window.close()" style="margin-top: 20px; padding: 10px 20px; background: #1e293b; color: white; border: none; border-radius: 8px; cursor: pointer;">Fermer la fenêtre</button>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'OAUTH_AUTH_ERROR', error: '${err?.message || "Échec de l'authentification"}' }, '*');
              }
            </script>
          </body>
        </html>
      `);
    }
  });

  // Serve static files in production or when dist exists
  const distPath = path.join(process.cwd(), 'dist');
  const hasDist = fs.existsSync(distPath) && fs.existsSync(path.join(distPath, 'index.html'));

  if (process.env.NODE_ENV === 'production' || hasDist) {
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    try {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    } catch (e) {
      if (hasDist) {
        app.use(express.static(distPath));
        app.get('*', (req, res) => {
          res.sendFile(path.join(distPath, 'index.html'));
        });
      } else {
        app.get('*', (req, res) => {
          res.send('GitPost: Veuillez exécuter `npm run build` pour compiler les fichiers de production.');
        });
      }
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[GitPost Server] En cours d'exécution sur http://0.0.0.0:${PORT} (mode: ${process.env.NODE_ENV || 'production'})`);
  });
}

startServer();
