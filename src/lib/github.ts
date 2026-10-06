/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GitHubUser, GitHubRepo, ZipFileEntry } from '../types';

/**
 * Convertit un Uint8Array en chaîne Base64 de manière synchrone et optimisée par blocs.
 * Évite les débordements de pile d'exécution et réduit la mémoire consommée.
 */
export function uint8ArrayToBase64(uint8Array: Uint8Array): string {
  let binary = '';
  const len = uint8Array.byteLength;
  const chunk_size = 0xffff; // 65535
  for (let i = 0; i < len; i += chunk_size) {
    const chunk = uint8Array.subarray(i, i + chunk_size);
    binary += String.fromCharCode.apply(null, chunk as any);
  }
  return window.btoa(binary);
}

/**
 * Convertit un Uint8Array en chaîne Base64 de manière asynchrone ultra-rapide
 * en délégant la conversion au moteur natif du navigateur via un FileReader.
 */
export function uint8ArrayToBase64Async(uint8Array: Uint8Array): Promise<string> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([uint8Array], { type: 'application/octet-stream' });
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.substring(dataUrl.indexOf(',') + 1);
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error || new Error("Erreur de conversion Base64"));
    reader.readAsDataURL(blob);
  });
}

/**
 * Effectue un fetch avec relance automatique en cas d'erreur réseau ou de limite de débit (Rate Limit).
 */
export async function fetchWithRetry(url: string, options: RequestInit, retries = 4, delay = 800): Promise<Response> {
  let lastError: any;
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      
      if (!response.ok) {
        const status = response.status;
        // Relancer pour les erreurs de rate limit (403, 429) ou de serveur (5xx)
        if (status === 403 || status === 429 || status >= 500) {
          const jitter = Math.random() * 250;
          const currentDelay = Math.round(delay + jitter);
          console.warn(`[GitHub API] Erreur ${status}. Tentative de relance ${i + 1}/${retries} dans ${currentDelay}ms...`);
          await new Promise(resolve => setTimeout(resolve, currentDelay));
          delay *= 1.8; // augmentation progressive du délai
          lastError = new Error(`HTTP ${status}: ${response.statusText}`);
          continue;
        }
      }
      return response;
    } catch (err: any) {
      const jitter = Math.random() * 250;
      const currentDelay = Math.round(delay + jitter);
      console.warn(`[GitHub API] Erreur de connexion (${err.message || err}). Tentative de relance ${i + 1}/${retries} dans ${currentDelay}ms...`);
      await new Promise(resolve => setTimeout(resolve, currentDelay));
      delay *= 1.8;
      lastError = err;
    }
  }
  throw lastError || new Error(`Échec de la requête après ${retries} tentatives.`);
}

/**
 * Calcule le SHA-1 Git d'un fichier représenté par un Uint8Array de manière ultra-rapide.
 * Formule Git : SHA1("blob " + size + "\0" + content)
 */
export async function computeGitSha(content: Uint8Array): Promise<string> {
  if (!window.crypto || !window.crypto.subtle) {
    return ''; // Ne pas utiliser l'optimisation si l'API Web Crypto n'est pas disponible
  }
  const header = `blob ${content.length}\0`;
  const headerBytes = new TextEncoder().encode(header);
  const combinedBytes = new Uint8Array(headerBytes.length + content.length);
  combinedBytes.set(headerBytes, 0);
  combinedBytes.set(content, headerBytes.length);
  
  const hashBuffer = await window.crypto.subtle.digest('SHA-1', combinedBytes);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Récupère de manière récursive l'index des fichiers (chemins et SHAs) d'un arbre Git existant.
 */
export async function fetchExistingTree(
  token: string,
  owner: string,
  repo: string,
  treeSha: string
): Promise<Map<string, string>> {
  const fileHashMap = new Map<string, string>();
  try {
    const response = await fetchWithRetry(`https://api.github.com/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`, {
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json',
      },
    });

    if (response.ok) {
      const data = await response.json();
      if (data && Array.isArray(data.tree)) {
        for (const item of data.tree) {
          if (item.type === 'blob' && item.path && item.sha) {
            fileHashMap.set(item.path, item.sha);
          }
        }
      }
    }
  } catch (err) {
    console.warn("[GitHub API] Impossible d'indexer l'arbre distant récursivement (l'envoi continuera sans cache) :", err);
  }
  return fileHashMap;
}

/**
 * Valide un jeton d'accès personnel GitHub (PAT) et récupère le profil utilisateur.
 * Endpoint : GET https://api.github.com/user
 */
export async function verifyGitHubToken(token: string): Promise<GitHubUser> {
  const response = await fetchWithRetry('https://api.github.com/user', {
    headers: {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github.v3+json',
    },
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Jeton d\'accès invalide ou expiré.');
    }
    throw new Error(`Erreur GitHub (${response.status}) : ${response.statusText}`);
  }

  return response.json();
}

/**
 * Récupère les dépôts de l'utilisateur connecté.
 * Endpoint : GET https://api.github.com/user/repos
 */
export async function fetchUserRepos(token: string): Promise<GitHubRepo[]> {
  const response = await fetchWithRetry('https://api.github.com/user/repos?per_page=100&sort=updated', {
    headers: {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github.v3+json',
    },
  });

  if (!response.ok) {
    throw new Error(`Impossible de récupérer vos dépôts (${response.status})`);
  }

  return response.json();
}

/**
 * Crée un nouveau dépôt pour l'utilisateur connecté.
 * Endpoint : POST https://api.github.com/user/repos
 */
export async function createGitHubRepo(
  token: string,
  config: { name: string; description: string; private: boolean; auto_init: boolean }
): Promise<GitHubRepo> {
  const response = await fetchWithRetry('https://api.github.com/user/repos', {
    method: 'POST',
    headers: {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: config.name,
      description: config.description,
      private: config.private,
      auto_init: config.auto_init, // Si true, crée un commit initial avec un README.md
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const message = errorData.message || response.statusText;
    throw new Error(`Erreur lors de la création du dépôt : ${message}`);
  }

  return response.json();
}

/**
 * Initialise un dépôt vide avec un premier fichier (README.md) pour créer la branche par défaut.
 * Endpoint : PUT https://api.github.com/repos/{owner}/{repo}/contents/{path}
 */
export async function initializeEmptyRepo(
  token: string,
  owner: string,
  repo: string,
  branch: string = 'main'
): Promise<string> {
  const content = '# ' + repo + '\n\nInitialisé via le Décompresseur & Exportateur GitHub.';
  const base64Content = window.btoa(unescape(encodeURIComponent(content)));

  const response = await fetchWithRetry(`https://api.github.com/repos/${owner}/${repo}/contents/README.md`, {
    method: 'PUT',
    headers: {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: 'Initial commit (README.md)',
      content: base64Content,
      branch: branch,
    }),
  });

  if (!response.ok) {
    throw new Error(`Impossible d'initialiser le dépôt vide (${response.status})`);
  }

  const data = await response.json();
  return data.commit.sha;
}

/**
 * Vérifie si une branche spécifique existe dans un dépôt.
 */
export async function checkIfBranchExists(
  token: string,
  owner: string,
  repo: string,
  branch: string
): Promise<boolean> {
  const response = await fetchWithRetry(`https://api.github.com/repos/${owner}/${repo}/branches/${branch}`, {
    headers: {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github.v3+json',
    },
  });

  return response.ok;
}

interface GitCommitInfo {
  commitSha: string;
  treeSha: string;
}

/**
 * Récupère le dernier commit d'une branche pour obtenir son SHA et le SHA de son arbre (tree).
 */
export async function getLatestCommitInfo(
  token: string,
  owner: string,
  repo: string,
  branch: string
): Promise<GitCommitInfo> {
  // Récupérer la référence de la branche
  const refResponse = await fetchWithRetry(`https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${branch}`, {
    headers: {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github.v3+json',
    },
  });

  if (!refResponse.ok) {
    throw new Error(`Branche "${branch}" introuvable ou inaccessible (${refResponse.status})`);
  }

  const refData = await refResponse.json();
  const commitSha = refData.object.sha;

  // Récupérer le commit
  const commitResponse = await fetchWithRetry(`https://api.github.com/repos/${owner}/${repo}/git/commits/${commitSha}`, {
    headers: {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github.v3+json',
    },
  });

  if (!commitResponse.ok) {
    throw new Error(`Impossible de récupérer les détails du commit (${commitResponse.status})`);
  }

  const commitData = await commitResponse.json();
  const treeSha = commitData.tree.sha;

  return { commitSha, treeSha };
}

/**
 * Étape A : Crée un blob Git pour un fichier et retourne son SHA.
 * Endpoint : POST https://api.github.com/repos/{owner}/{repo}/git/blobs
 */
export async function createGitBlob(
  token: string,
  owner: string,
  repo: string,
  file: ZipFileEntry
): Promise<string> {
  const base64Content = await uint8ArrayToBase64Async(file.content);

  const response = await fetchWithRetry(`https://api.github.com/repos/${owner}/${repo}/git/blobs`, {
    method: 'POST',
    headers: {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      content: base64Content,
      encoding: 'base64',
    }),
  });

  if (!response.ok) {
    throw new Error(`Échec de la création du blob pour "${file.path}" (${response.status})`);
  }

  const data = await response.json();
  return data.sha;
}

interface TreeItem {
  path: string;
  mode: '100644' | '100755' | '040000' | '160000' | '120000';
  type: 'blob' | 'tree' | 'commit';
  sha: string;
}

/**
 * Étape B : Crée un arbre Git (tree) reliant les blobs créés.
 * Endpoint : POST https://api.github.com/repos/{owner}/{repo}/git/trees
 */
export async function createGitTree(
  token: string,
  owner: string,
  repo: string,
  treeItems: TreeItem[],
  baseTreeSha?: string
): Promise<string> {
  const body: any = {
    tree: treeItems,
  };
  
  if (baseTreeSha) {
    body.base_tree = baseTreeSha; // Permet de fusionner avec l'historique existant au lieu d'écraser tout le dépôt
  }

  const response = await fetchWithRetry(`https://api.github.com/repos/${owner}/${repo}/git/trees`, {
    method: 'POST',
    headers: {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`Échec de la création de l'arbre Git: ${err.message || response.statusText}`);
  }

  const data = await response.json();
  return data.sha;
}

/**
 * Étape C : Crée un nouveau commit pointant vers le nouvel arbre et ayant pour parent le commit précédent.
 * Endpoint : POST https://api.github.com/repos/{owner}/{repo}/git/commits
 */
export async function createGitCommit(
  token: string,
  owner: string,
  repo: string,
  message: string,
  treeSha: string,
  parentCommitShas: string[]
): Promise<string> {
  const response = await fetchWithRetry(`https://api.github.com/repos/${owner}/${repo}/git/commits`, {
    method: 'POST',
    headers: {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message,
      tree: treeSha,
      parents: parentCommitShas,
    }),
  });

  if (!response.ok) {
    throw new Error(`Échec de la création du commit (${response.status})`);
  }

  const data = await response.json();
  return data.sha;
}

/**
 * Étape D : Met à jour la référence de la branche (ex: heads/main) pour pointer vers le nouveau commit.
 * Endpoint : PATCH https://api.github.com/repos/{owner}/{repo}/git/refs/heads/{branch}
 */
export async function updateBranchReference(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  commitSha: string
): Promise<void> {
  const response = await fetchWithRetry(`https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sha: commitSha,
      force: true, // Force la mise à jour s'il y a des divergences (attention !)
    }),
  });

  if (!response.ok) {
    throw new Error(`Échec de la mise à jour de la branche "${branch}" (${response.status})`);
  }
}
