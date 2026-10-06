/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface GitHubUser {
  login: string;
  id: number;
  avatar_url: string;
  html_url: string;
  name: string;
  public_repos: number;
  total_private_repos?: number;
}

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
  description: string | null;
  default_branch: string;
}

export interface ZipFileEntry {
  path: string;
  name: string;
  size: number;
  isDirectory: boolean;
  // Raw file content to be processed for Base64 upload
  content: Uint8Array;
}

export interface LogEntry {
  timestamp: string;
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
}

export type WizardStep = 'token' | 'repo' | 'zip' | 'deploy' | 'success';

export interface RepositoryConfig {
  mode: 'existing' | 'new';
  existingRepo: GitHubRepo | null;
  newName: string;
  newDescription: string;
  newPrivate: boolean;
  newAutoInitialize: boolean; // Add README.md
}
