/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { decompressArchive } from './lib/decompress';
import { 
  KeyRound, 
  Database, 
  FileArchive, 
  GitCommit, 
  ShieldCheck, 
  HelpCircle, 
  Terminal, 
  Lock, 
  Compass, 
  Cpu, 
  ArrowRight, 
  CheckCircle2, 
  AlertTriangle, 
  Loader2, 
  LogOut, 
  RefreshCw, 
  ExternalLink, 
  Plus, 
  Search, 
  FolderGit2, 
  ChevronRight, 
  Sparkles, 
  Github, 
  Folder,
  ChevronLeft,
  Check,
  Eye,
  EyeOff
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

import { GitHubUser, GitHubRepo, ZipFileEntry, LogEntry, WizardStep, RepositoryConfig } from './types';
import { 
  verifyGitHubToken, 
  fetchUserRepos, 
  createGitHubRepo, 
  checkIfBranchExists, 
  getLatestCommitInfo, 
  createGitBlob, 
  createGitTree, 
  createGitCommit, 
  updateBranchReference,
  initializeEmptyRepo,
  computeGitSha,
  fetchExistingTree
} from './lib/github';
import ExplanationPanel from './components/ExplanationPanel';
import FileTree from './components/FileTree';

export default function App() {
  // --- État de l'application ---
  const [currentStep, setCurrentStep] = useState<WizardStep>('token');
  const [token, setToken] = useState<string>('');
  const [showToken, setShowToken] = useState<boolean>(false);
  const [user, setUser] = useState<GitHubUser | null>(null);
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isLoadingUser, setIsLoadingUser] = useState<boolean>(false);
  const [isLoadingRepos, setIsLoadingRepos] = useState<boolean>(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [oauthConfigured, setOauthConfigured] = useState<boolean>(false);
  const [isOauthConnecting, setIsOauthConnecting] = useState<boolean>(false);

  // Configuration du dépôt cible
  const [repoConfig, setRepoConfig] = useState<RepositoryConfig>({
    mode: 'existing',
    existingRepo: null,
    newName: '',
    newDescription: 'Créé automatiquement via le Décompresseur & Exportateur ZIP pour GitHub.',
    newPrivate: true,
    newAutoInitialize: true
  });

  // Archive ZIP & Décompression
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [unzippedFiles, setUnzippedFiles] = useState<ZipFileEntry[]>([]);
  const [isUnzipping, setIsUnzipping] = useState<boolean>(false);
  const [unzipProgress, setUnzipProgress] = useState<number>(0);
  const [dragActive, setDragActive] = useState<boolean>(false);

  // Déploiement
  const [targetBranch, setTargetBranch] = useState<string>('main');
  const [commitMessage, setCommitMessage] = useState<string>('Déploiement initial de l\'archive compressée ZIP');
  const [isDeploying, setIsDeploying] = useState<boolean>(false);
  const [deployProgress, setDeployProgress] = useState<number>(0);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [deployedCommitUrl, setDeployedCommitUrl] = useState<string>('');
  const [activeDeployingFile, setActiveDeployingFile] = useState<string>('');

  // --- Fonctions utilitaires ---
  const addLog = useCallback((level: 'info' | 'success' | 'warning' | 'error', message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev, { timestamp, level, message }]);
  }, []);

  const autoLogin = async (savedToken: string) => {
    setIsLoadingUser(true);
    setTokenError(null);
    try {
      const gitHubUser = await verifyGitHubToken(savedToken);
      setUser(gitHubUser);
      setCurrentStep('repo');
      loadRepositories(savedToken);
    } catch (err: any) {
      localStorage.removeItem('github_pat');
      setTokenError(err.message || 'La connexion automatique a échoué.');
    } finally {
      setIsLoadingUser(false);
    }
  };

  // --- Chargement initial ---
  useEffect(() => {
    const savedToken = localStorage.getItem('github_pat');
    if (savedToken) {
      setToken(savedToken);
      autoLogin(savedToken);
    }

    // Vérifier la configuration OAuth côté serveur
    const checkOauthConfig = async () => {
      try {
        const response = await fetch('/api/auth/config');
        if (response.ok) {
          const data = await response.json();
          setOauthConfigured(data.oauthConfigured);
        }
      } catch (err) {
        console.error('Erreur lors de la vérification de la configuration OAuth:', err);
      }
    };
    checkOauthConfig();
  }, []);

  // Écouteur pour la popup OAuth
  useEffect(() => {
    const handleOAuthMessage = async (event: MessageEvent) => {
      const origin = event.origin;
      // Valider l'origine
      if (origin !== window.location.origin || event.source !== window) {
        return;
      }

      if (event.data?.type === 'OAUTH_AUTH_SUCCESS' && event.data?.token) {
        const accessToken = event.data.token;
        setToken(accessToken);
        setIsLoadingUser(true);
        setTokenError(null);
        try {
          const gitHubUser = await verifyGitHubToken(accessToken);
          setUser(gitHubUser);
          localStorage.setItem('github_pat', accessToken);
          addLog('success', `Authentifié avec succès via GitHub en tant que ${gitHubUser.login}`);
          setCurrentStep('repo');
          loadRepositories(accessToken);
        } catch (err: any) {
          setTokenError(err.message || 'Échec de la validation de l\'utilisateur GitHub.');
        } finally {
          setIsLoadingUser(false);
          setIsOauthConnecting(false);
        }
      } else if (event.data?.type === 'OAUTH_AUTH_ERROR') {
        setTokenError(event.data.error || 'La connexion GitHub a échoué ou a été annulée.');
        setIsOauthConnecting(false);
      }
    };

    window.addEventListener('message', handleOAuthMessage);
    return () => window.removeEventListener('message', handleOAuthMessage);
  }, [addLog]);

  // --- Fonctions de chargement ---

  const handleVerifyToken = async () => {
    if (!token.trim()) {
      setTokenError('Veuillez entrer un jeton d\'accès.');
      return;
    }
    setIsLoadingUser(true);
    setTokenError(null);
    try {
      const gitHubUser = await verifyGitHubToken(token);
      setUser(gitHubUser);
      localStorage.setItem('github_pat', token);
      addLog('success', `Authentifié avec succès en tant que ${gitHubUser.login}`);
      setCurrentStep('repo');
      loadRepositories(token);
    } catch (err: any) {
      setTokenError(err.message || 'Échec de la validation du jeton.');
    } finally {
      setIsLoadingUser(false);
    }
  };

  const handleConnectOauth = async () => {
    setIsOauthConnecting(true);
    setTokenError(null);
    try {
      const response = await fetch('/api/auth/url');
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || 'Erreur lors de la récupération de l\'URL d\'authentification.');
      }
      const { url } = await response.json();
      
      const authWindow = window.open(
        url,
        'github_oauth_popup',
        'width=600,height=700,status=yes,resizable=yes,scrollbars=yes'
      );
      
      if (!authWindow) {
        alert('Veuillez autoriser les fenêtres popups pour ce site afin de vous connecter avec GitHub.');
        setIsOauthConnecting(false);
      }
    } catch (err: any) {
      setTokenError(err.message || 'Impossible de se connecter à GitHub.');
      setIsOauthConnecting(false);
    }
  };

  const handleDisconnect = () => {
    localStorage.removeItem('github_pat');
    setToken('');
    setUser(null);
    setRepos([]);
    setRepoConfig({
      mode: 'existing',
      existingRepo: null,
      newName: '',
      newDescription: 'Créé automatiquement via le Décompresseur & Exportateur ZIP pour GitHub.',
      newPrivate: true,
      newAutoInitialize: true
    });
    setZipFile(null);
    setUnzippedFiles([]);
    setCurrentStep('token');
  };

  const loadRepositories = async (accessToken: string) => {
    setIsLoadingRepos(true);
    try {
      const repositories = await fetchUserRepos(accessToken);
      setRepos(repositories);
    } catch (err: any) {
      addLog('error', `Impossible de lister vos dépôts : ${err.message}`);
    } finally {
      setIsLoadingRepos(false);
    }
  };

  // --- Extraction de l'archive ---
  const processZipFile = async (file: File) => {
    const filenameLower = file.name.toLowerCase();
    const isZip = filenameLower.endsWith('.zip');
    const isTarGz = filenameLower.endsWith('.tar.gz') || filenameLower.endsWith('.tgz');
    const isTar = filenameLower.endsWith('.tar') && !isTarGz;

    if (!isZip && !isTarGz && !isTar) {
      alert('Veuillez sélectionner un fichier d\'archive valide (.zip, .tar, .tar.gz, ou .tgz).');
      return;
    }

    setZipFile(file);
    setIsUnzipping(true);
    setUnzipProgress(10);
    setUnzippedFiles([]);
    
    const initialLogs: LogEntry[] = [
      {
        timestamp: new Date().toLocaleTimeString(),
        level: 'info',
        message: `Lecture de l'archive "${file.name}" (${(file.size / 1024 / 1024).toFixed(2)} Mo)...`
      }
    ];
    setLogs(initialLogs);

    try {
      addLog('info', `Décompression locale de l'archive en cours (Traitement en mémoire dans votre navigateur)...`);
      const entries = await decompressArchive(file, (progress) => {
        setUnzipProgress(progress);
      });

      setUnzippedFiles(entries);
      addLog('success', `Décompression achevée ! ${entries.length} fichiers valides ont été extraits et stockés localement.`);
    } catch (error: any) {
      addLog('error', `Une erreur est survenue lors de la décompression : ${error.message}`);
    } finally {
      setIsUnzipping(false);
    }
  };

  // Drag & Drop
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processZipFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processZipFile(e.target.files[0]);
    }
  };

  // --- Déploiement vers GitHub ---
  const handleDeploy = async () => {
    if (!token) return;
    
    const isNew = repoConfig.mode === 'new';
    if (!isNew && !repoConfig.existingRepo) {
      alert('Veuillez sélectionner un dépôt existant de destination.');
      return;
    }
    if (isNew && !repoConfig.newName.trim()) {
      alert('Veuillez spécifier le nom du dépôt à créer.');
      return;
    }
    if (unzippedFiles.length === 0) {
      alert('Veuillez d\'abord charger et décompresser un fichier ZIP valide.');
      return;
    }

    setIsDeploying(true);
    setDeployProgress(5);
    setLogs([
      {
        timestamp: new Date().toLocaleTimeString(),
        level: 'info',
        message: 'Initialisation du pipeline de déploiement atomique Git...'
      }
    ]);

    try {
      let repoName = '';
      let repoOwner = '';
      let activeRepo: GitHubRepo;

      // Étape 1 : Obtenir ou créer le dépôt cible
      if (isNew) {
        addLog('info', `Requête de création d'un dépôt GitHub : "${repoConfig.newName}"...`);
        activeRepo = await createGitHubRepo(token, {
          name: repoConfig.newName.trim(),
          description: repoConfig.newDescription,
          private: repoConfig.newPrivate,
          auto_init: repoConfig.newAutoInitialize
        });
        repoName = activeRepo.name;
        repoOwner = user!.login;
        addLog('success', `Dépôt "${repoOwner}/${repoName}" créé avec succès ! URL: ${activeRepo.html_url}`);
      } else {
        activeRepo = repoConfig.existingRepo!;
        repoName = activeRepo.name;
        repoOwner = activeRepo.full_name.split('/')[0];
        addLog('info', `Cible sélectionnée : dépôt existant "${repoOwner}/${repoName}"`);
      }

      setDeployProgress(15);

      // Étape 2 : Vérifier ou initialiser la branche
      addLog('info', `Vérification de l'existence de la branche cible "${targetBranch}"...`);
      let branchExists = await checkIfBranchExists(token, repoOwner, repoName, targetBranch);
      
      let baseCommitSha = '';
      let baseTreeSha = '';

      if (!branchExists) {
        addLog('warning', `La branche "${targetBranch}" n'existe pas encore.`);
        
        // Si c'est un nouveau dépôt et qu'on n'a pas coché auto_init, il est 100% vide (pas de commit du tout)
        // Nous l'initialisons avec un fichier d'accueil pour générer la branche
        try {
          addLog('info', `Création d'un commit initial pour démarrer la branche "${targetBranch}"...`);
          baseCommitSha = await initializeEmptyRepo(token, repoOwner, repoName, targetBranch);
          branchExists = true;
          addLog('success', `Branche "${targetBranch}" initialisée avec succès.`);
        } catch (err: any) {
          // Si le dépôt avait une autre branche par défaut (ex: créée par auto_init comme 'main'),
          // on va brancher notre nouvelle branche à partir du commit de cette branche par défaut
          const defaultBranch = activeRepo.default_branch || 'main';
          addLog('info', `Tentative de récupération de la branche par défaut "${defaultBranch}" pour embranchement...`);
          try {
            const defaultBranchInfo = await getLatestCommitInfo(token, repoOwner, repoName, defaultBranch);
            baseCommitSha = defaultBranchInfo.commitSha;
            baseTreeSha = defaultBranchInfo.treeSha;

            // Création de la branche sur GitHub
            addLog('info', `Création de la branche "${targetBranch}" à partir de "${defaultBranch}"...`);
            const createRefResponse = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/git/refs`, {
              method: 'POST',
              headers: {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                ref: `refs/heads/${targetBranch}`,
                sha: baseCommitSha
              })
            });

            if (!createRefResponse.ok) {
              throw new Error(`Code ${createRefResponse.status} lors de la création de la branche.`);
            }
            addLog('success', `Branche "${targetBranch}" créée.`);
          } catch (branchErr: any) {
            // Si tout échoue, on tente une initialisation directe
            addLog('info', `Seconde tentative d'initialisation directe de la base de données...`);
            baseCommitSha = await initializeEmptyRepo(token, repoOwner, repoName, targetBranch);
          }
        }
      } else {
        // La branche existe déjà, on récupère le dernier commit pour bâtir l'historique par-dessus
        const latestInfo = await getLatestCommitInfo(token, repoOwner, repoName, targetBranch);
        baseCommitSha = latestInfo.commitSha;
        baseTreeSha = latestInfo.treeSha;
        addLog('info', `Dernier commit existant trouvé : ${baseCommitSha.substring(0, 7)}`);
      }

      setDeployProgress(30);

      // Étape 3 : Indexer l'arbre existant pour éviter les téléversements redondants (Optimisation incrémentale)
      let existingFileHashMap = new Map<string, string>();
      if (baseTreeSha) {
        addLog('info', `Indexation de l'arborescence distante pour optimiser le transfert...`);
        existingFileHashMap = await fetchExistingTree(token, repoOwner, repoName, baseTreeSha);
        addLog('info', `${existingFileHashMap.size} fichiers existants trouvés sur GitHub.`);
      }

      addLog('info', `Analyse et calcul des empreintes locales (Git SHA-1)...`);
      const filesToUpload: ZipFileEntry[] = [];
      const treeItems: any[] = [];
      
      let hashedCount = 0;
      for (const file of unzippedFiles) {
        const localSha = await computeGitSha(file.content);
        const remoteSha = existingFileHashMap.get(file.path);
        
        if (remoteSha && remoteSha === localSha) {
          // Le fichier existe déjà et est identique, on réutilise son SHA directement
          treeItems.push({
            path: file.path,
            mode: '100644',
            type: 'blob',
            sha: remoteSha
          });
        } else {
          // Fichier nouveau ou modifié
          filesToUpload.push(file);
        }
        
        hashedCount++;
        if (hashedCount % 50 === 0 || hashedCount === unzippedFiles.length) {
          setDeployProgress(Math.floor(30 + (hashedCount / unzippedFiles.length) * 10));
        }
      }

      const cachedCount = unzippedFiles.length - filesToUpload.length;
      if (cachedCount > 0) {
        addLog('success', `⚡ Optimisation active : ${cachedCount}/${unzippedFiles.length} fichiers identiques détectés sur GitHub. Transfert évité pour ces éléments !`);
      }

      setDeployProgress(40);

      // Étape 3.5 : Envoyer les fichiers modifiés/nouveaux sous forme de Blobs
      if (filesToUpload.length > 0) {
        addLog('info', `Étape A : Transfert de ${filesToUpload.length} fichier(s) nouveau(x) ou modifié(s) vers GitHub...`);
        let successCount = 0;

        // Fonction d'envoi individuelle pour un fichier
        const uploadFileBlob = async (file: ZipFileEntry) => {
          try {
            setActiveDeployingFile(file.path);
            const total = filesToUpload.length;
            if (total <= 20 || successCount % 5 === 0 || file.size > 250 * 1024) {
              addLog('info', `[${successCount + 1}/${total}] Envoi du blob : ${file.path} (${(file.size / 1024).toFixed(1)} Ko)...`);
            }
            
            const fileSha = await createGitBlob(token, repoOwner, repoName, file);
            
            treeItems.push({
              path: file.path,
              mode: '100644',
              type: 'blob',
              sha: fileSha
            });

            successCount++;
            // Progression de 40% à 75%
            const fraction = successCount / total;
            setDeployProgress(Math.floor(40 + fraction * 35));
          } catch (fileErr: any) {
            addLog('error', `❌ Échec du transfert pour "${file.path}" : ${fileErr.message}`);
            throw fileErr;
          }
        };

        // Exécuter les uploads via un pool de travailleurs continus hautement performant.
        // Concurrency de 6 est le maximum physique pour la plupart des navigateurs à un même hôte (limite de connexions TCP).
        const concurrencyLimit = 6;
        let currentIndex = 0;
        
        const uploadWorker = async () => {
          while (currentIndex < filesToUpload.length) {
            const fileIndex = currentIndex++;
            if (fileIndex >= filesToUpload.length) break;
            await uploadFileBlob(filesToUpload[fileIndex]);
          }
        };

        const workerPromises = Array.from(
          { length: Math.min(concurrencyLimit, filesToUpload.length) }, 
          () => uploadWorker()
        );
        
        await Promise.all(workerPromises);
        addLog('success', `Tous les nouveaux blobs (${filesToUpload.length}) ont été validés et stockés par GitHub.`);
      } else {
        addLog('success', `✨ Aucun fichier à transférer ! Tous vos fichiers sont déjà synchronisés et à jour sur GitHub.`);
      }

      setActiveDeployingFile('');
      setDeployProgress(75);

      // Étape 4 : Assembler l'arbre (Tree) Git
      addLog('info', 'Étape B : Assemblage des blobs dans l\'arborescence globale (arbre)...');
      // On passe baseTreeSha pour fusionner avec les fichiers existants, plutôt que d'écraser tout ce qui existait
      const newTreeSha = await createGitTree(token, repoOwner, repoName, treeItems, baseTreeSha || undefined);
      addLog('success', `Arbre virtuel Git assemblé. SHA: ${newTreeSha.substring(0, 7)}`);
      setDeployProgress(85);

      // Étape 5 : Créer le Commit pointant vers cet arbre
      addLog('info', `Étape C : Signature du commit de l'arbre créé...`);
      const parentCommits = baseCommitSha ? [baseCommitSha] : [];
      const newCommitSha = await createGitCommit(
        token, 
        repoOwner, 
        repoName, 
        commitMessage.trim() || 'Importation ZIP via décompresseur', 
        newTreeSha, 
        parentCommits
      );
      addLog('success', `Commit enregistré dans l'historique de GitHub. SHA: ${newCommitSha.substring(0, 7)}`);
      setDeployProgress(95);

      // Étape 6 : Mettre à jour la référence de la branche cible
      addLog('info', `Étape D : Verrouillage de la branche "${targetBranch}" sur le nouveau commit...`);
      await updateBranchReference(token, repoOwner, repoName, targetBranch, newCommitSha);
      
      const commitUrl = `https://github.com/${repoOwner}/${repoName}/commit/${newCommitSha}`;
      setDeployedCommitUrl(commitUrl);
      addLog('success', `Déploiement atomique achevé avec plein succès ! 🎉`);
      setDeployProgress(100);

      // Redirection vers l'étape finale de félicitations
      setTimeout(() => {
        setCurrentStep('success');
      }, 1000);

    } catch (err: any) {
      setActiveDeployingFile('');
      addLog('error', `Une erreur critique est survenue : ${err.message}`);
      setIsDeploying(false);
      alert(`Le déploiement a échoué : ${err.message}`);
    }
  };

  // Filtrage des dépôts existants pour la recherche
  const filteredRepos = repos.filter((r) =>
    r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (r.description && r.description.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div id="app-root-container" className="min-h-screen bg-slate-50 flex flex-col justify-between">
      {/* --- En-tête de l'application --- */}
      <header className="bg-slate-900 text-white border-b border-slate-800 py-5 px-6 shadow-md" id="app-header">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center space-x-3">
            <div className="bg-sky-500 p-2.5 rounded-xl text-white shadow-lg shadow-sky-500/20">
              <Github className="h-6 w-6" id="header-logo-icon" />
            </div>
            <div>
              <h1 className="text-xl font-extrabold tracking-tight flex items-center">
                <span className="text-white">Git</span><span className="text-sky-400">Post</span>
              </h1>
              <p className="text-xs text-slate-400">
                Décompressez localement & uploadez atomiquement sur GitHub en un clic
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            {user ? (
              <div className="flex items-center space-x-3 bg-slate-800/80 border border-slate-700/60 rounded-xl py-1.5 pl-3 pr-2.5 text-xs text-slate-300">
                <img 
                  src={user.avatar_url} 
                  alt={user.login} 
                  className="h-6 w-6 rounded-full border border-slate-600 shrink-0" 
                />
                <div>
                  <p className="font-semibold text-slate-200">{user.name || user.login}</p>
                  <p className="text-[10px] text-slate-400">@{user.login}</p>
                </div>
                <button
                  onClick={handleDisconnect}
                  className="text-slate-400 hover:text-rose-400 transition-colors p-1"
                  title="Déconnexion de GitHub"
                  id="disconnect-btn"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center space-x-2 text-xs text-slate-400 bg-slate-800/40 px-3 py-1.5 rounded-xl border border-slate-800">
                <span className="w-2 h-2 rounded-full bg-slate-500 animate-pulse"></span>
                <span>Non authentifié</span>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* --- Corps principal --- */}
      <main className="max-w-7xl w-full mx-auto p-4 md:p-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start flex-grow">
        
        {/* --- Colonne de gauche (Formulaires & Wizard) --- */}
        <section className={`${currentStep === 'token' ? 'lg:col-span-7' : 'lg:col-span-8 lg:col-start-3'} space-y-6 w-full`}>
          
          {/* Fil d'ariane (Indicateur de progression d'étapes) */}
          <nav className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs" id="progress-steps-nav">
            <div className="flex items-center justify-between">
              {[
                { step: 'token', label: 'Connexion', icon: KeyRound },
                { step: 'repo', label: 'Dépôt', icon: Database },
                { step: 'zip', label: 'ZIP Archive', icon: FileArchive },
                { step: 'deploy', label: 'Déploiement', icon: GitCommit },
              ].map((item, idx) => {
                const stepOrder = ['token', 'repo', 'zip', 'deploy', 'success'];
                const currentIdx = stepOrder.indexOf(currentStep);
                const itemIdx = stepOrder.indexOf(item.step);
                const isCompleted = itemIdx < currentIdx;
                const isActive = item.step === currentStep || (currentStep === 'success' && item.step === 'deploy');

                return (
                  <div key={item.step} className="flex items-center shrink-0">
                    <button
                      disabled={itemIdx > currentIdx && currentStep !== 'success'}
                      onClick={() => {
                        // Autoriser le retour en arrière libre si authentifié
                        if (user || item.step === 'token') {
                          setCurrentStep(item.step as WizardStep);
                        }
                      }}
                      className={`flex flex-col items-center space-y-1 group focus:outline-none transition-all ${
                        isActive ? 'text-sky-600 scale-105' : isCompleted ? 'text-emerald-600' : 'text-slate-400'
                      }`}
                    >
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center border text-xs font-semibold shadow-xs transition-all ${
                        isActive 
                          ? 'bg-sky-50 border-sky-600 text-sky-600 font-bold ring-2 ring-sky-500/15' 
                          : isCompleted 
                            ? 'bg-emerald-50 border-emerald-600 text-emerald-600' 
                            : 'bg-slate-50 border-slate-200 text-slate-400'
                      }`}>
                        {isCompleted ? <Check className="h-4 w-4" /> : <item.icon className="h-4 w-4" />}
                      </div>
                      <span className="text-[10px] font-bold tracking-tight uppercase hidden sm:block">
                        {item.label}
                      </span>
                    </button>
                    {idx < 3 && (
                      <ChevronRight className={`h-4 w-4 mx-2 md:mx-4 hidden sm:block ${
                        itemIdx < currentIdx ? 'text-emerald-500' : 'text-slate-200'
                      }`} />
                    )}
                  </div>
                );
              })}
            </div>
          </nav>

          {/* Formulaires d'étapes dynamiques */}
          <AnimatePresence mode="wait">
            
            {/* ETAPE 1 : CONNEXION TOKEN */}
            {currentStep === 'token' && (
              <motion.div
                key="step-token"
                initial={{ opacity: 0, x: -15 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 15 }}
                className="bg-white border border-slate-200 rounded-3xl p-6 md:p-8 shadow-sm space-y-6"
                id="step-card-token"
              >
                <div className="space-y-2">
                  <span className="bg-sky-50 text-sky-700 text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider">Étape 1</span>
                  <h2 className="text-2xl font-black text-slate-800 tracking-tight">Connectez votre compte GitHub</h2>
                  <p className="text-sm text-slate-500">
                    Connectez-vous directement via OAuth pour accorder les permissions nécessaires de création et mise à jour de dépôts, ou utilisez votre jeton d'accès personnel.
                  </p>
                </div>

                <div className="space-y-5">
                  {oauthConfigured ? (
                    <div className="space-y-4">
                      <div className="bg-emerald-50/50 border border-emerald-100 p-4 rounded-xl text-xs text-emerald-800 flex items-start gap-2.5">
                        <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                        <div>
                          <span className="font-bold">Connexion OAuth active.</span> Vous pouvez maintenant vous connecter en un clic sans avoir à générer manuellement un jeton d'accès personnel classique.
                        </div>
                      </div>

                      <button
                        disabled={isOauthConnecting || isLoadingUser}
                        onClick={handleConnectOauth}
                        className="w-full bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white font-bold py-3.5 px-4 rounded-xl shadow-md shadow-slate-900/10 flex items-center justify-center space-x-2.5 cursor-pointer transition-all active:scale-[0.99]"
                        id="oauth-connect-btn"
                      >
                        {isOauthConnecting || isLoadingUser ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            <span>Authentification en cours...</span>
                          </>
                        ) : (
                          <>
                            <Github className="h-5 w-5" />
                            <span>Se connecter avec GitHub</span>
                          </>
                        )}
                      </button>

                      {tokenError && (
                        <p className="text-xs text-rose-500 font-medium flex items-center gap-1" id="token-error-msg-oauth">
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                          <span>{tokenError}</span>
                        </p>
                      )}

                      <div className="relative py-2">
                        <div className="absolute inset-0 flex items-center">
                          <span className="w-full border-t border-slate-100" />
                        </div>
                        <div className="relative flex justify-center text-xs uppercase">
                          <span className="bg-white px-3 text-slate-400 font-bold tracking-wider text-[10px]">Ou connexion classique</span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-sky-50/60 border border-sky-100 p-4 rounded-xl text-xs text-sky-800 space-y-2">
                      <div className="flex items-start gap-2.5">
                        <HelpCircle className="h-4 w-4 text-sky-600 shrink-0 mt-0.5" />
                        <div>
                          <span className="font-bold">Astuce d'administration :</span> Pour activer la connexion instantanée en un clic "Se connecter avec GitHub" via OAuth pour tous les utilisateurs :
                        </div>
                      </div>
                      <ol className="list-decimal pl-6 space-y-1 text-[11px] font-medium text-sky-900/90">
                        <li>Créez une OAuth App sur GitHub avec l'URL de redirection : <code className="bg-sky-100/80 px-1 rounded font-mono font-bold">{window.location.origin}/auth/callback</code></li>
                        <li>Ajoutez <code className="bg-sky-100/80 px-1 rounded font-mono font-bold">GITHUB_CLIENT_ID</code> et <code className="bg-sky-100/80 px-1 rounded font-mono font-bold">GITHUB_CLIENT_SECRET</code> dans vos variables d'environnement d'AI Studio.</li>
                      </ol>
                    </div>
                  )}

                  {/* FORMULAIRE PAT */}
                  <div className="border border-slate-100 rounded-2xl p-4 md:p-5 space-y-4 bg-slate-50/30">
                    <div>
                      <label htmlFor="token-input" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                        Jeton d'Accès Personnel Classic (PAT)
                      </label>
                      <div className="relative rounded-xl shadow-xs">
                        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                          <KeyRound className="h-4 w-4" />
                        </div>
                        <input
                          type={showToken ? 'text' : 'password'}
                          id="token-input"
                          value={token}
                          onChange={(e) => setToken(e.target.value)}
                          placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                          className="w-full pl-10 pr-10 py-3 text-sm font-mono bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition-all text-slate-700"
                        />
                        <button
                          type="button"
                          onClick={() => setShowToken(!showToken)}
                          className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600"
                          id="toggle-token-visibility"
                        >
                          {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                      {(!oauthConfigured || token) && tokenError && (
                        <p className="text-xs text-rose-500 font-medium mt-2 flex items-center gap-1" id="token-error-msg">
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                          <span>{tokenError}</span>
                        </p>
                      )}
                    </div>

                    <button
                      disabled={isLoadingUser || isOauthConnecting}
                      onClick={handleVerifyToken}
                      className="w-full bg-slate-800 hover:bg-slate-700 disabled:bg-slate-300 text-white font-bold py-3 px-4 rounded-xl shadow-sm flex items-center justify-center space-x-2 cursor-pointer transition-all active:scale-[0.99] text-xs"
                      id="verify-token-btn"
                    >
                      {isLoadingUser ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          <span>Validation du jeton...</span>
                        </>
                      ) : (
                        <>
                          <span>Valider le jeton Classic</span>
                          <ArrowRight className="h-3.5 w-3.5" />
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </motion.div>
            )}

            {/* ETAPE 2 : CONFIGURATION DU DEPOT */}
            {currentStep === 'repo' && (
              <motion.div
                key="step-repo"
                initial={{ opacity: 0, x: -15 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 15 }}
                className="bg-white border border-slate-200 rounded-3xl p-6 md:p-8 shadow-sm space-y-6"
                id="step-card-repo"
              >
                <div className="space-y-2">
                  <span className="bg-sky-50 text-sky-700 text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider">Étape 2</span>
                  <h2 className="text-2xl font-black text-slate-800 tracking-tight">Sélectionnez le dépôt GitHub</h2>
                  <p className="text-sm text-slate-500">
                    Où souhaitez-vous déployer votre code ? Vous pouvez uploader les fichiers décompressés sur un dépôt existant ou en créer un nouveau de toutes pièces.
                  </p>
                </div>

                {/* Onglets de mode */}
                <div className="grid grid-cols-2 p-1 bg-slate-100 rounded-xl border border-slate-200/40" id="repo-mode-tabs">
                  <button
                    onClick={() => setRepoConfig((prev) => ({ ...prev, mode: 'existing' }))}
                    className={`py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center space-x-1.5 ${
                      repoConfig.mode === 'existing'
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                    id="tab-existing"
                  >
                    <Folder className="h-3.5 w-3.5" />
                    <span>Dépôt existant</span>
                  </button>
                  <button
                    onClick={() => setRepoConfig((prev) => ({ ...prev, mode: 'new' }))}
                    className={`py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center space-x-1.5 ${
                      repoConfig.mode === 'new'
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                    id="tab-new"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Créer un nouveau dépôt</span>
                  </button>
                </div>

                {/* CONTENU ONGLET 1 : DEPOT EXISTANT */}
                {repoConfig.mode === 'existing' ? (
                  <div className="space-y-4" id="pane-existing">
                    <div className="space-y-2">
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                        Rechercher et sélectionner un dépôt
                      </label>
                      <div className="relative rounded-xl shadow-xs">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                          <Search className="h-4 w-4" />
                        </div>
                        <input
                          type="text"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder="Ex : mon-projet-web..."
                          className="w-full pl-9 pr-4 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition-all text-slate-700"
                        />
                      </div>
                    </div>

                    {isLoadingRepos ? (
                      <div className="flex flex-col items-center justify-center py-12 space-y-2 text-slate-400">
                        <Loader2 className="h-6 w-6 animate-spin text-sky-500" />
                        <span className="text-xs">Chargement de la liste de vos dépôts...</span>
                      </div>
                    ) : (
                      <div className="max-h-64 overflow-y-auto border border-slate-100 rounded-xl divide-y divide-slate-100 bg-slate-50/50" id="existing-repos-list">
                        {filteredRepos.length > 0 ? (
                          filteredRepos.map((repo) => {
                            const isSelected = repoConfig.existingRepo?.id === repo.id;
                            return (
                              <button
                                key={repo.id}
                                onClick={() => setRepoConfig((prev) => ({ ...prev, existingRepo: repo }))}
                                className={`w-full text-left p-3 flex items-center justify-between hover:bg-slate-100/80 transition-colors ${
                                  isSelected ? 'bg-sky-50/70 border-l-4 border-sky-500 hover:bg-sky-50/70' : ''
                                }`}
                              >
                                <div className="min-w-0 pr-2">
                                  <div className="flex items-center space-x-1.5">
                                    <span className="font-mono text-xs font-bold text-slate-800 truncate">{repo.name}</span>
                                    {repo.private ? (
                                      <span className="text-[9px] bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded font-bold">Privé</span>
                                    ) : (
                                      <span className="text-[9px] bg-sky-50 text-sky-600 px-1.5 py-0.5 rounded font-bold border border-sky-100">Public</span>
                                    )}
                                  </div>
                                  {repo.description && (
                                    <p className="text-[10px] text-slate-400 truncate mt-0.5">{repo.description}</p>
                                  )}
                                </div>
                                <div className="flex items-center shrink-0">
                                  <span className="text-[10px] text-slate-400 font-mono mr-2">Branche: {repo.default_branch}</span>
                                  <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                                    isSelected ? 'border-sky-500 bg-sky-500 text-white' : 'border-slate-300 bg-white'
                                  }`}>
                                    {isSelected && <Check className="h-3 w-3" />}
                                  </div>
                                </div>
                              </button>
                            );
                          })
                        ) : (
                          <div className="text-center py-8 text-slate-400 text-xs italic">
                            Aucun dépôt ne correspond à votre recherche.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  /* CONTENU ONGLET 2 : NOUVEAU DEPOT */
                  <div className="space-y-4" id="pane-new">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label htmlFor="new-repo-name" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                          Nom du dépôt *
                        </label>
                        <input
                          type="text"
                          id="new-repo-name"
                          value={repoConfig.newName}
                          onChange={(e) => setRepoConfig((prev) => ({ 
                            ...prev, 
                            newName: e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, '-') 
                          }))}
                          placeholder="ex: nouveau-projet-web"
                          className="w-full px-3.5 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 font-mono text-slate-700"
                        />
                      </div>

                      <div>
                        <label htmlFor="new-repo-visibility" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                          Visibilité
                        </label>
                        <div className="grid grid-cols-2 gap-2" id="new-repo-visibility">
                          <button
                            type="button"
                            onClick={() => setRepoConfig((prev) => ({ ...prev, newPrivate: true }))}
                            className={`py-2 text-xs font-bold rounded-xl border flex items-center justify-center space-x-1 ${
                              repoConfig.newPrivate 
                                ? 'bg-slate-900 border-slate-900 text-white' 
                                : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                            }`}
                          >
                            <Lock className="h-3.5 w-3.5" />
                            <span>Privé</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setRepoConfig((prev) => ({ ...prev, newPrivate: false }))}
                            className={`py-2 text-xs font-bold rounded-xl border flex items-center justify-center space-x-1 ${
                              !repoConfig.newPrivate 
                                ? 'bg-slate-900 border-slate-900 text-white' 
                                : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                            }`}
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            <span>Public</span>
                          </button>
                        </div>
                      </div>
                    </div>

                    <div>
                      <label htmlFor="new-repo-desc" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                        Description (Optionnel)
                      </label>
                      <input
                        type="text"
                        id="new-repo-desc"
                        value={repoConfig.newDescription}
                        onChange={(e) => setRepoConfig((prev) => ({ ...prev, newDescription: e.target.value }))}
                        placeholder="Brève description de votre dépôt..."
                        className="w-full px-3.5 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 text-slate-700"
                      />
                    </div>

                    <div className="bg-amber-50 border border-amber-200/60 p-3 rounded-xl flex items-start space-x-2">
                      <HelpCircle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                      <p className="text-[10px] text-amber-800 leading-relaxed">
                        Le dépôt sera automatiquement créé à la racine de votre compte. 
                        Nous l'initialiserons avec un fichier <code>README.md</code> par défaut afin de générer sa branche principale, permettant d'écrire immédiatement vos fichiers ZIP dessus.
                      </p>
                    </div>
                  </div>
                )}

                {/* Bouton de validation d'étape */}
                <div className="flex space-x-3 pt-2">
                  <button
                    onClick={() => setCurrentStep('token')}
                    className="flex items-center space-x-1.5 px-4 py-2.5 text-xs font-bold text-slate-500 hover:text-slate-800 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    <span>Retour</span>
                  </button>

                  <button
                    disabled={(repoConfig.mode === 'existing' && !repoConfig.existingRepo)}
                    onClick={() => {
                      if (repoConfig.mode === 'existing' && repoConfig.existingRepo) {
                        setTargetBranch(repoConfig.existingRepo.default_branch || 'main');
                      }
                      setCurrentStep('zip');
                    }}
                    className="flex-1 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-100 disabled:text-slate-400 text-white font-bold py-2.5 px-4 rounded-xl shadow-xs flex items-center justify-center space-x-1.5 cursor-pointer transition-all active:scale-[0.99]"
                    id="step-repo-next-btn"
                  >
                    <span>Continuer vers l'archive</span>
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              </motion.div>
            )}

            {/* ETAPE 3 : ARCHIVE COMPRESSEE */}
            {currentStep === 'zip' && (
              <motion.div
                key="step-zip"
                initial={{ opacity: 0, x: -15 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 15 }}
                className="bg-white border border-slate-200 rounded-3xl p-6 md:p-8 shadow-sm space-y-6"
                id="step-card-zip"
              >
                <div className="space-y-2">
                  <span className="bg-sky-50 text-sky-700 text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider">Étape 3</span>
                  <h2 className="text-2xl font-black text-slate-800 tracking-tight">Déposez et décompressez l'archive</h2>
                  <p className="text-sm text-slate-500">
                    Glissez-déposez votre dossier d'application compressé ci-dessous. Nous acceptons les formats ZIP, TAR et TAR.GZ/TGZ, et les décompressons instantanément dans votre navigateur.
                  </p>
                </div>

                {/* Dropzone d'upload */}
                <div
                  onDragEnter={handleDrag}
                  onDragOver={handleDrag}
                  onDragLeave={handleDrag}
                  onDrop={handleDrop}
                  className={`border-2 border-dashed rounded-2xl p-8 text-center flex flex-col items-center justify-center space-y-3 cursor-pointer transition-all ${
                    dragActive 
                      ? 'border-sky-500 bg-sky-50/50 scale-[1.01]' 
                      : zipFile 
                        ? 'border-emerald-500 bg-emerald-50/10' 
                        : 'border-slate-300 hover:border-slate-400 bg-slate-50/40 hover:bg-slate-50'
                  }`}
                  onClick={() => document.getElementById('zip-file-input')?.click()}
                  id="zip-dropzone"
                >
                  <input
                    type="file"
                    id="zip-file-input"
                    accept=".zip,.tar,.tar.gz,.tgz"
                    onChange={handleFileInputChange}
                    className="hidden"
                  />
                  
                  {isUnzipping ? (
                    <div className="space-y-3 py-4 w-full max-w-xs">
                      <Loader2 className="h-10 w-10 animate-spin text-sky-500 mx-auto" />
                      <div className="space-y-1">
                        <p className="text-xs font-bold text-slate-700">Décompression en cours...</p>
                        <p className="text-[10px] text-slate-400">Ne fermez pas cette page</p>
                      </div>
                      <div className="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
                        <div 
                          className="bg-sky-500 h-1.5 rounded-full transition-all duration-150" 
                          style={{ width: `${unzipProgress}%` }}
                        ></div>
                      </div>
                    </div>
                  ) : zipFile ? (
                    <div className="space-y-2 py-2">
                      <div className="bg-emerald-100 text-emerald-800 p-3 rounded-full w-fit mx-auto shadow-sm">
                        <CheckCircle2 className="h-8 w-8" id="zip-uploaded-icon" />
                      </div>
                      <div className="space-y-0.5">
                        <p className="text-sm font-bold text-slate-800 truncate max-w-sm mx-auto">{zipFile.name}</p>
                        <p className="text-xs text-slate-500 font-mono">{(zipFile.size / 1024 / 1024).toFixed(2)} Mo</p>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          document.getElementById('zip-file-input')?.click();
                        }}
                        className="text-[11px] text-sky-600 hover:text-sky-700 font-bold hover:underline"
                      >
                        Sélectionner une autre archive
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2 py-4">
                      <div className="bg-slate-100 text-slate-500 p-3 rounded-full w-fit mx-auto">
                        <FileArchive className="h-8 w-8" />
                      </div>
                      <div className="space-y-0.5">
                        <p className="text-xs font-bold text-slate-800">Glissez votre archive ici ou cliquez pour parcourir</p>
                        <p className="text-[10px] text-slate-400">Formats acceptés : ZIP, TAR, TAR.GZ, TGZ (Max 50 Mo recommandé)</p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Affichage de l'arbre si des fichiers ont été extraits */}
                {unzippedFiles.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-2"
                  >
                    <FileTree files={unzippedFiles} />
                  </motion.div>
                )}

                {/* Boutons de validation d'étape */}
                <div className="flex space-x-3 pt-2">
                  <button
                    onClick={() => setCurrentStep('repo')}
                    className="flex items-center space-x-1.5 px-4 py-2.5 text-xs font-bold text-slate-500 hover:text-slate-800 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    <span>Retour</span>
                  </button>

                  <button
                    disabled={unzippedFiles.length === 0}
                    onClick={() => setCurrentStep('deploy')}
                    className="flex-1 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-100 disabled:text-slate-400 text-white font-bold py-2.5 px-4 rounded-xl shadow-xs flex items-center justify-center space-x-1.5 cursor-pointer transition-all active:scale-[0.99]"
                    id="step-zip-next-btn"
                  >
                    <span>Passer au déploiement</span>
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              </motion.div>
            )}

            {/* ETAPE 4 : DEPLOIEMENT DE BAS NIVEAU */}
            {currentStep === 'deploy' && (
              <motion.div
                key="step-deploy"
                initial={{ opacity: 0, x: -15 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 15 }}
                className="bg-white border border-slate-200 rounded-3xl p-6 md:p-8 shadow-sm space-y-6"
                id="step-card-deploy"
              >
                <div className="space-y-2">
                  <span className="bg-sky-50 text-sky-700 text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider">Étape 4</span>
                  <h2 className="text-2xl font-black text-slate-800 tracking-tight">Déployer sur votre dépôt</h2>
                  <p className="text-sm text-slate-500">
                    Dernière étape ! Configurez les paramètres de commit et lancez l'injection de votre code. L'arborescence sera commitée de manière atomique.
                  </p>
                </div>

                {/* Résumé de configuration */}
                <div className="bg-slate-50 border border-slate-200/60 p-4 rounded-2xl grid grid-cols-2 gap-4 text-xs">
                  <div className="space-y-0.5">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Dépôt GitHub cible</span>
                    <p className="font-bold text-slate-700 truncate">
                      {repoConfig.mode === 'new' ? repoConfig.newName : repoConfig.existingRepo?.name}
                    </p>
                  </div>
                  <div className="space-y-0.5">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Visibilité</span>
                    <p className="font-bold text-slate-700 flex items-center">
                      {repoConfig.mode === 'new' 
                        ? (repoConfig.newPrivate ? <Lock className="h-3.5 w-3.5 mr-1" /> : <ExternalLink className="h-3.5 w-3.5 mr-1" />)
                        : (repoConfig.existingRepo?.private ? <Lock className="h-3.5 w-3.5 mr-1" /> : <ExternalLink className="h-3.5 w-3.5 mr-1" />)
                      }
                      {repoConfig.mode === 'new' ? (repoConfig.newPrivate ? 'Privé' : 'Public') : (repoConfig.existingRepo?.private ? 'Privé' : 'Public')}
                    </p>
                  </div>
                  <div className="space-y-0.5">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Fichiers à uploader</span>
                    <p className="font-bold text-slate-700">{unzippedFiles.length} fichiers décompressés</p>
                  </div>
                  <div className="space-y-0.5">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Total décompressé</span>
                    <p className="font-bold text-slate-700">
                      {(unzippedFiles.reduce((acc, curr) => acc + curr.size, 0) / 1024).toFixed(1)} Ko
                    </p>
                  </div>
                </div>

                {/* Formulaire de configuration du commit */}
                <div className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="md:col-span-1">
                      <label htmlFor="target-branch-input" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                        Branche Git
                      </label>
                      <input
                        type="text"
                        id="target-branch-input"
                        value={targetBranch}
                        onChange={(e) => setTargetBranch(e.target.value)}
                        placeholder="main"
                        className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 font-mono text-slate-700"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label htmlFor="commit-msg-input" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                        Message du commit
                      </label>
                      <input
                        type="text"
                        id="commit-msg-input"
                        value={commitMessage}
                        onChange={(e) => setCommitMessage(e.target.value)}
                        placeholder="Message explicatif du commit"
                        className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 text-slate-700"
                      />
                    </div>
                  </div>
                </div>

                {/* Interface de progression et d'upload */}
                {isDeploying ? (
                  <div className="bg-slate-50 border border-slate-200 p-4 rounded-2xl space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-bold text-slate-700 flex items-center">
                        <Loader2 className="h-4 w-4 animate-spin text-sky-500 mr-2" />
                        Déploiement en cours sur GitHub...
                      </span>
                      <span className="text-xs font-mono font-bold text-slate-500">{deployProgress}%</span>
                    </div>
                    <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                      <div 
                        className="bg-sky-500 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${deployProgress}%` }}
                      ></div>
                    </div>
                    {activeDeployingFile && (
                      <div className="text-[10px] text-slate-400 font-mono truncate flex items-center gap-1.5 animate-pulse pt-1 border-t border-slate-100">
                        <span className="w-1.5 h-1.5 rounded-full bg-sky-400 shrink-0"></span>
                        <span className="font-bold text-slate-500 shrink-0">Upload en cours :</span>
                        <span className="truncate text-slate-400">{activeDeployingFile}</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <button
                    onClick={handleDeploy}
                    className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold py-4 px-4 rounded-xl shadow-lg shadow-emerald-600/10 flex items-center justify-center space-x-2 cursor-pointer transition-all active:scale-[0.99] text-base"
                    id="trigger-deploy-btn"
                  >
                    <GitCommit className="h-5 w-5" />
                    <span>Lancer le déploiement sur GitHub</span>
                  </button>
                )}

                {/* Logs de la console de déploiement */}
                {logs.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center space-x-2 text-xs font-bold text-slate-400 uppercase tracking-wider">
                      <Terminal className="h-3.5 w-3.5" />
                      <span>Console de déploiement en temps réel</span>
                    </div>
                    <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl max-h-48 overflow-y-auto font-mono text-[10px] leading-relaxed space-y-1 shadow-inner text-slate-300 scrollbar-thin">
                      {logs.map((log, idx) => (
                        <div key={idx} className="flex items-start space-x-2">
                          <span className="text-slate-500 shrink-0">{log.timestamp}</span>
                          <span className={`font-bold shrink-0 ${
                            log.level === 'success' 
                              ? 'text-emerald-400' 
                              : log.level === 'error' 
                                ? 'text-rose-400' 
                                : log.level === 'warning' 
                                  ? 'text-amber-400' 
                                  : 'text-sky-400'
                          }`}>
                            [{log.level.toUpperCase()}]
                          </span>
                          <span className={`${
                            log.level === 'error' ? 'text-rose-300' : 'text-slate-300'
                          }`}>
                            {log.message}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Boutons d'action */}
                {!isDeploying && (
                  <div className="flex space-x-3 pt-2">
                    <button
                      onClick={() => setCurrentStep('zip')}
                      className="flex items-center space-x-1.5 px-4 py-2.5 text-xs font-bold text-slate-500 hover:text-slate-800 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      <span>Retour</span>
                    </button>
                  </div>
                )}
              </motion.div>
            )}

            {/* ETAPE FINALE : REUSSITE */}
            {currentStep === 'success' && (
              <motion.div
                key="step-success"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-white border border-slate-200 rounded-3xl p-8 md:p-10 text-center shadow-md space-y-6"
                id="step-card-success"
              >
                <div className="bg-emerald-50 text-emerald-600 p-4 rounded-full w-fit mx-auto border border-emerald-100 shadow-sm animate-bounce">
                  <Check className="h-10 w-10 stroke-[3]" />
                </div>

                <div className="space-y-2">
                  <h2 className="text-2xl font-black text-slate-800 tracking-tight">Déploiement Terminé avec Succès !</h2>
                  <p className="text-sm text-slate-500 max-w-md mx-auto leading-relaxed">
                    Votre archive ZIP a été décompressée, analysée et injectée dans votre dépôt GitHub. Le commit est atomique et votre dépôt est propre.
                  </p>
                </div>

                <div className="p-4 bg-slate-50 border border-slate-100 rounded-2xl max-w-md mx-auto space-y-1 text-xs">
                  <p className="text-slate-400 font-bold uppercase tracking-wider text-[9px]">Dépôt cible</p>
                  <p className="font-bold text-slate-700 text-sm">
                    {repoConfig.mode === 'new' ? `${user?.login}/${repoConfig.newName}` : repoConfig.existingRepo?.full_name}
                  </p>
                  <p className="text-slate-400 font-bold uppercase tracking-wider text-[9px] pt-2">Branche de destination</p>
                  <p className="font-mono text-slate-600 font-semibold">{targetBranch}</p>
                </div>

                <div className="flex flex-col sm:flex-row justify-center gap-3 max-w-sm mx-auto pt-2">
                  <a
                    href={deployedCommitUrl || `https://github.com/${user?.login}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 bg-slate-900 hover:bg-slate-800 text-white font-extrabold py-3 px-4 rounded-xl text-xs flex items-center justify-center space-x-1.5 cursor-pointer shadow-md transition-all active:scale-[0.99]"
                    id="view-commit-btn"
                  >
                    <ExternalLink className="h-4 w-4" />
                    <span>Voir sur GitHub</span>
                  </a>

                  <button
                    onClick={() => {
                      setZipFile(null);
                      setUnzippedFiles([]);
                      setLogs([]);
                      setCurrentStep('repo');
                    }}
                    className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-3 px-4 rounded-xl text-xs flex items-center justify-center space-x-1.5 cursor-pointer transition-all"
                    id="deploy-again-btn"
                  >
                    <RefreshCw className="h-4 w-4" />
                    <span>Nouveau déploiement</span>
                  </button>
                </div>
              </motion.div>
            )}

          </AnimatePresence>

        </section>

        {/* --- Colonne de droite (Guide & Explications détaillées) --- */}
        {currentStep === 'token' && (
          <aside className="lg:col-span-5 space-y-6">
            <ExplanationPanel currentStep={currentStep} />
            
            {/* Panneau additionnel d'informations sur la sécurité locale */}
            <div className="bg-slate-900 text-slate-300 p-5 rounded-2xl border border-slate-800 shadow-sm space-y-3" id="local-security-banner">
              <div className="flex items-center space-x-2 text-sky-400">
                <ShieldCheck className="h-5 w-5 shrink-0" />
                <h4 className="font-bold text-xs uppercase tracking-wider text-slate-200">Garantie Souveraineté des Données</h4>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Ce service est entièrement développé en React et s'exécute exclusivement au sein de votre session de navigateur. 
                <strong> Vos jetons d'accès, mots de passe et archives ZIP ne sont jamais transmis, stockés ou relayés vers un serveur tiers.</strong> 
                Toutes les connexions se font par HTTPS direct vers l'API officielle de GitHub.
              </p>
            </div>
          </aside>
        )}

      </main>

      {/* --- Pied de page --- */}
      <footer className="bg-white border-t border-slate-200 py-6 px-6 text-center text-xs text-slate-500" id="app-footer">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-3">
          <div className="flex items-center space-x-2">
            <Github className="h-4 w-4 text-slate-400" />
            <span className="font-bold text-slate-700">GitPost</span>
            <span>•</span>
            <span className="text-slate-500">Déploiement GitHub atomique & décompression ZIP local</span>
          </div>
          <div className="flex items-center space-x-2 bg-slate-100 hover:bg-slate-200/80 px-3.5 py-1.5 rounded-full border border-slate-200/60 transition-all">
            <Sparkles className="h-3.5 w-3.5 text-sky-500" />
            <span className="text-slate-600 font-medium">Créateur :</span>
            <span className="font-extrabold text-slate-900 tracking-wide">plag_tech</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
