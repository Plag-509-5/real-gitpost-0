# GitPost

GitPost décompresse une archive puis la publie dans un dépôt GitHub. L'interface React est servie par Express et l'authentification GitHub OAuth est effectuée exclusivement côté serveur.

## Prérequis

- Node.js 20+ (ou Bun)
- Une GitHub OAuth App (et non une GitHub App)
- Une URL publique pour un déploiement ; `http://localhost:3000` suffit en local

## Configuration exacte de GitHub OAuth

1. Sur GitHub, ouvrir **Settings → Developer settings → OAuth Apps → New OAuth App**.
2. Renseigner :
   - **Application name** : par exemple `GitPost local` ;
   - **Homepage URL** : `http://localhost:3000` en local (ou l'URL publique exacte en production) ;
   - **Authorization callback URL** : `http://localhost:3000/auth/callback`.
3. Cliquer sur **Register application**, puis copier le **Client ID** et générer un **Client secret**.
4. Copier `.env.example` vers `.env` et remplacer les deux valeurs :

```dotenv
GITHUB_CLIENT_ID="..."
GITHUB_CLIENT_SECRET="..."
PORT=3000
```

Ne jamais committer `.env`, publier le secret, ni remettre des identifiants dans `.env.example`. En production, l'URL de callback doit être exactement `https://votre-domaine.example/auth/callback` et être enregistrée telle quelle dans GitHub (pas de variante avec un slash final). Le proxy doit transmettre le schéma HTTPS via `X-Forwarded-Proto`.

Le serveur construit la callback depuis l'origine de la requête, génère un `state` aléatoire à usage unique (protection CSRF), le valide au retour, et n'expose jamais le secret au navigateur. Le token OAuth est transmis à la fenêtre d'origine uniquement ; l'écouteur frontend vérifie également l'origine et la source du message.

> Les permissions demandées sont `repo,user`. `repo` donne un accès important aux dépôts privés : réduisez-les si l'application n'a besoin que de dépôts publics.

## Démarrer

```bash
npm install
npm run dev
```

Puis ouvrir http://localhost:3000. Pour vérifier la configuration, l'application utilise `GET /api/auth/config` (il ne renvoie jamais le secret).

## Production

```bash
npm run build
NODE_ENV=production npm start
```

Configurez `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` et `PORT` dans le gestionnaire de secrets de votre hébergeur. Servez l'application en HTTPS et ajoutez l'URL publique exacte à la GitHub OAuth App.

## Structure utile

- `server.js` : serveur Express et routes OAuth (`/api/auth/url`, `/auth/callback`).
- `src/App.tsx` : popup OAuth et validation stricte de `postMessage`.
- `.env.example` : modèle sans secret.
- `server.ts` : version TypeScript de référence historique ; le script `npm run dev` exécute `server.js`.
