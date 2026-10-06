/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import JSZip from 'jszip';
import { ZipFileEntry } from '../types';

/**
 * Lit une chaîne terminée par un caractère nul d'un sous-tableau d'octets.
 */
function readNullTerminatedString(bytes: Uint8Array, offset: number, maxLength: number): string {
  let end = offset;
  const max = offset + maxLength;
  while (end < max && bytes[end] !== 0) {
    end++;
  }
  const textDecoder = new TextDecoder('utf-8');
  return textDecoder.decode(bytes.subarray(offset, end)).trim();
}

/**
 * Lit un nombre octal depuis un sous-tableau d'octets.
 */
function readOctal(bytes: Uint8Array, offset: number, length: number): number {
  const str = readNullTerminatedString(bytes, offset, length);
  return parseInt(str, 8) || 0;
}

/**
 * Décompresse un flux GZIP à l'aide de l'API native DecompressionStream du navigateur.
 */
async function decompressGzip(arrayBuffer: ArrayBuffer): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error("DecompressionStream n'est pas pris en charge par votre navigateur. Impossible de décompresser les fichiers Gzip.");
  }

  const responseStream = new Response(arrayBuffer).body;
  if (!responseStream) {
    throw new Error("Impossible de lire le flux de données.");
  }

  const decompressedStream = responseStream.pipeThrough(new DecompressionStream('gzip'));
  const blob = await new Response(decompressedStream).blob();
  const buffer = await blob.arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * Décompresse un fichier d'archive TAR (Ustar ou classique).
 */
export function untar(uint8Array: Uint8Array): ZipFileEntry[] {
  const entries: ZipFileEntry[] = [];
  let offset = 0;
  const length = uint8Array.length;

  while (offset < length) {
    // Si le bloc de 512 octets est entièrement nul, c'est la fin de l'archive tar
    let isEnd = true;
    const headerEnd = Math.min(offset + 512, length);
    for (let i = offset; i < headerEnd; i++) {
      if (uint8Array[i] !== 0) {
        isEnd = false;
        break;
      }
    }

    if (isEnd) {
      break;
    }

    // Un en-tête tar fait toujours 512 octets
    if (offset + 512 > length) {
      break;
    }

    // Lecture du nom du fichier (offset 0, longueur 100)
    let filename = readNullTerminatedString(uint8Array, offset + 0, 100);
    
    // Si l'en-tête ustar est présent, le nom peut avoir un préfixe (offset 345, longueur 155)
    const ustarIndicator = readNullTerminatedString(uint8Array, offset + 257, 6);
    if (ustarIndicator.startsWith('ustar')) {
      const prefix = readNullTerminatedString(uint8Array, offset + 345, 155);
      if (prefix) {
        filename = prefix + '/' + filename;
      }
    }

    // Lecture de la taille du fichier (offset 124, longueur 12) - chaîne octale
    const size = readOctal(uint8Array, offset + 124, 12);
    
    // Indicateur de type (offset 156, longueur 1)
    const typeFlag = String.fromCharCode(uint8Array[offset + 156]);
    const isDirectory = typeFlag === '5' || filename.endsWith('/');

    // Le contenu du fichier commence après l'en-tête de 512 octets
    const contentOffset = offset + 512;
    
    // Git n'enregistre pas les répertoires vides, on n'ajoute que les fichiers
    if (!isDirectory && size > 0 && contentOffset + size <= length) {
      const fileContent = uint8Array.subarray(contentOffset, contentOffset + size);
      
      // Filtrer les fichiers indésirables comme __MACOSX ou .DS_Store
      if (!filename.startsWith('__MACOSX/') && !filename.endsWith('.DS_Store')) {
        entries.push({
          path: filename,
          name: filename.split('/').pop() || filename,
          size: size,
          isDirectory: false,
          content: new Uint8Array(fileContent)
        });
      }
    }

    // Passer au bloc suivant (les données du fichier sont alignées sur des blocs de 512 octets)
    const paddedSize = Math.ceil(size / 512) * 512;
    offset += 512 + paddedSize;
  }

  return entries;
}

/**
 * Décompresse n'importe quelle archive prise en charge (.zip, .tar, .tar.gz, .tgz).
 */
export async function decompressArchive(
  file: File, 
  onProgress: (progress: number) => void
): Promise<ZipFileEntry[]> {
  const name = file.name.toLowerCase();
  
  // 1. ARCHIVE ZIP
  if (name.endsWith('.zip')) {
    onProgress(10);
    const zip = await JSZip.loadAsync(file);
    const entries: ZipFileEntry[] = [];
    const fileKeys = Object.keys(zip.files);
    
    let processed = 0;
    for (const filename of fileKeys) {
      const zipEntry = zip.files[filename];
      if (!zipEntry.dir) {
        const content = await zipEntry.async('uint8array');
        if (!zipEntry.name.startsWith('__MACOSX/') && !zipEntry.name.endsWith('.DS_Store')) {
          entries.push({
            path: zipEntry.name,
            name: zipEntry.name.split('/').pop() || zipEntry.name,
            size: content.byteLength,
            isDirectory: false,
            content: content
          });
        }
      }
      processed++;
      onProgress(Math.floor(10 + (processed / fileKeys.length) * 90));
    }
    return entries;
  }

  // 2. ARCHIVE TAR.GZ OU TGZ
  if (name.endsWith('.tar.gz') || name.endsWith('.tgz')) {
    onProgress(20);
    const arrayBuffer = await file.arrayBuffer();
    onProgress(40);
    const tarData = await decompressGzip(arrayBuffer);
    onProgress(70);
    const entries = untar(tarData);
    onProgress(100);
    return entries;
  }

  // 3. ARCHIVE TAR SIMPLE
  if (name.endsWith('.tar')) {
    onProgress(30);
    const arrayBuffer = await file.arrayBuffer();
    const tarData = new Uint8Array(arrayBuffer);
    onProgress(70);
    const entries = untar(tarData);
    onProgress(100);
    return entries;
  }

  throw new Error("Format d'archive non pris en charge. Veuillez sélectionner un fichier .zip, .tar ou .tar.gz / .tgz");
}
