/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { 
  KeyRound, 
  ShieldCheck, 
  HelpCircle
} from 'lucide-react';
import { motion } from 'motion/react';

export default function ExplanationPanel() {
  return (
    <motion.div
      id="explanation-panel-container"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="bg-white border border-slate-200/80 p-6 rounded-2xl shadow-sm space-y-4"
    >
      <div className="flex items-center space-x-2 text-xs font-semibold text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-3">
        <HelpCircle className="h-4 w-4 text-slate-400" />
        <span>Guide d'Authentification</span>
      </div>
      
      <div id="exp-token-content" className="space-y-4">
        <div className="flex items-center space-x-2 text-sky-600">
          <KeyRound className="h-5 w-5" id="exp-icon-key" />
          <h3 className="font-semibold text-lg" id="exp-title-token">Étape 1 : Authentification Sécurisée</h3>
        </div>
        <p className="text-sm text-slate-600 leading-relaxed">
          Pour communiquer avec GitHub et uploader vos fichiers, nous utilisons un <strong>Jeton d'Accès Personnel (Classic PAT)</strong>. 
          C'est le mécanisme officiel de GitHub pour autoriser des applications tierces.
        </p>

        <div className="bg-sky-50 border border-sky-100 p-4 rounded-xl space-y-3">
          <div className="flex items-start space-x-2">
            <ShieldCheck className="h-5 w-5 text-sky-600 shrink-0 mt-0.5" id="exp-icon-shield" />
            <div className="text-xs text-sky-800 space-y-1">
              <p className="font-semibold">🔒 Sécurité absolue & Locale</p>
              <p className="leading-relaxed">
                Votre jeton est uniquement stocké dans le stockage local de votre navigateur (<code>localStorage</code>). 
                Aucun serveur tiers n'intervient : toutes les requêtes API partent <strong>directement</strong> de votre navigateur vers les serveurs sécurisés de GitHub.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <h4 className="font-semibold text-xs text-slate-700 uppercase tracking-wider">Comment créer votre jeton ?</h4>
          <ol className="text-xs text-slate-600 list-decimal pl-4 space-y-2 leading-relaxed">
            <li>
              Rendez-vous sur les <a href="https://github.com/settings/tokens" target="_blank" rel="noopener noreferrer" className="text-sky-600 hover:underline font-medium">Paramètres Développeur GitHub</a>.
            </li>
            <li>
              Cliquez sur <strong>Generate new token</strong> (sélectionnez <strong>classic</strong>).
            </li>
            <li>
              Donnez-lui une description (ex: <code>GitHub Zip Deployer</code>).
            </li>
            <li>
              Cochez impérativement la case <strong><code>repo</code></strong> (pour permettre l'écriture et la création de dépôts).
            </li>
            <li>
              Cliquez sur <strong>Generate token</strong> en bas de page, puis copiez le jeton généré (commençant généralement par <code>ghp_</code>).
            </li>
          </ol>
        </div>
      </div>
    </motion.div>
  );
}
