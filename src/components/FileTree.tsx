/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import { ZipFileEntry } from '../types';
import { Folder, FolderOpen, File, ChevronDown, ChevronRight, FileCode, ImageIcon, FileText } from 'lucide-react';

interface FileTreeProps {
  files: ZipFileEntry[];
}

interface TreeNode {
  name: string;
  path: string;
  type: 'folder' | 'file';
  size?: number;
  children?: { [key: string]: TreeNode };
}

/**
 * Construit un arbre imbriqué à partir de chemins de fichiers linéaires.
 */
function buildTree(files: ZipFileEntry[]): TreeNode {
  const root: TreeNode = { name: 'Root', path: '', type: 'folder', children: {} };

  files.forEach((file) => {
    const parts = file.path.split('/').filter(Boolean);
    let current = root;

    parts.forEach((part, index) => {
      if (!current.children) {
        current.children = {};
      }

      const isLast = index === parts.length - 1;
      const currentPath = parts.slice(0, index + 1).join('/');

      if (!current.children[part]) {
        if (isLast && !file.isDirectory) {
          current.children[part] = {
            name: part,
            path: file.path,
            type: 'file',
            size: file.size,
          };
        } else {
          current.children[part] = {
            name: part,
            path: currentPath,
            type: 'folder',
            children: {},
          };
        }
      }

      current = current.children[part];
    });
  });

  return root;
}

/**
 * Formate la taille d'un fichier de manière lisible (Octets, Ko, Mo).
 */
function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['Octets', 'Ko', 'Mo', 'Go'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Retourne l'icône appropriée selon l'extension du fichier.
 */
function getFileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase();
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext || '')) {
    return <ImageIcon className="h-4 w-4 text-emerald-500 shrink-0" />;
  }
  if (['js', 'ts', 'jsx', 'tsx', 'html', 'css', 'json', 'py', 'go', 'rs', 'sh', 'yml', 'md'].includes(ext || '')) {
    return <FileCode className="h-4 w-4 text-amber-500 shrink-0" />;
  }
  if (['txt', 'pdf', 'doc', 'docx'].includes(ext || '')) {
    return <FileText className="h-4 w-4 text-slate-500 shrink-0" />;
  }
  return <File className="h-4 w-4 text-sky-500 shrink-0" />;
}

interface TreeItemProps {
  node: TreeNode;
  depth: number;
  key?: string;
}

function TreeItem({ node, depth }: TreeItemProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  if (node.type === 'file') {
    return (
      <div 
        className="flex items-center justify-between py-1 px-2 hover:bg-slate-50 rounded-md text-xs group"
        style={{ paddingLeft: `${depth * 16}px` }}
      >
        <div className="flex items-center space-x-1.5 min-w-0">
          {getFileIcon(node.name)}
          <span className="font-mono text-slate-700 truncate">{node.name}</span>
        </div>
        <span className="font-mono text-[10px] text-slate-400 group-hover:text-slate-500 ml-2">
          {node.size !== undefined ? formatSize(node.size) : ''}
        </span>
      </div>
    );
  }

  const childrenArray = node.children ? Object.values(node.children) : [];
  // Trier pour mettre les dossiers d'abord, puis les fichiers par ordre alphabétique
  childrenArray.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === 'folder' ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="space-y-0.5">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between py-1 px-2 hover:bg-slate-50 rounded-md text-xs text-left text-slate-800 font-medium group focus:outline-none"
        style={{ paddingLeft: `${depth * 16}px` }}
      >
        <div className="flex items-center space-x-1.5 min-w-0">
          <span className="text-slate-400 hover:text-slate-600">
            {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </span>
          {isExpanded ? (
            <FolderOpen className="h-4 w-4 text-sky-500 shrink-0" />
          ) : (
            <Folder className="h-4 w-4 text-sky-500 shrink-0" />
          )}
          <span className="font-mono truncate">{node.name}</span>
        </div>
        <span className="font-mono text-[9px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full">
          {childrenArray.length} élem.
        </span>
      </button>

      {isExpanded && childrenArray.length > 0 && (
        <div className="space-y-0.5">
          {childrenArray.map((child) => (
            <TreeItem key={child.path || child.name} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function FileTree({ files }: FileTreeProps) {
  const tree = buildTree(files);
  const childrenArray = tree.children ? Object.values(tree.children) : [];

  // Trier pour mettre les dossiers d'abord
  childrenArray.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === 'folder' ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  if (files.length === 0) {
    return (
      <div className="text-center py-8 text-slate-400 text-xs italic">
        Aucun fichier trouvé dans l'archive.
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3 max-h-80 overflow-y-auto shadow-inner space-y-1">
      <div className="flex items-center justify-between border-b border-slate-100 pb-2 mb-2 text-[10px] uppercase font-bold tracking-wider text-slate-400">
        <span>Arborescence de l'archive</span>
        <span>{files.length} fichiers décompressés</span>
      </div>
      <div className="space-y-0.5">
        {childrenArray.map((child) => (
          <TreeItem key={child.path || child.name} node={child} depth={0} />
        ))}
      </div>
    </div>
  );
}
