import fs from 'node:fs';
import path from 'node:path';
import type { RepoKind } from './types';

export interface RepoConfig {
  /** Nombre corto, ej. "front-web" o "api-pagos". */
  name: string;
  kind?: RepoKind;
  /** Ruta local al repositorio o URL para clonar (https/ssh). */
  source: string;
  /** Versión anterior: commit, tag o rama. Opcional si se usa el estado guardado. */
  from?: string;
  /** Versión nueva: commit, tag o rama. Por defecto HEAD. */
  to?: string;
  /** Solo analizar estas carpetas (útil en monorepos). */
  paths?: string[];
}

export interface ApiSpecSource {
  /** Ruta local o URL del OpenAPI/Swagger (JSON o YAML). */
  file?: string;
  url?: string;
}

export interface ApiConfig {
  name: string;
  /** Leer el OpenAPI desde un repo configurado, en las versiones from/to. */
  repo?: string;
  file?: string;
  /** O indicar las dos versiones explícitamente. */
  old?: ApiSpecSource;
  new?: ApiSpecSource;
}

export interface UiPage {
  name: string;
  path: string;
  /** Palabras que relacionan la pantalla con commits o archivos (ej. "perfil", "profile"). */
  match?: string[];
  /** Servicios que usa esta pantalla (ej. "/api/pagos"). */
  apis?: string[];
}

export interface UiConfig {
  old: { baseUrl: string };
  new: { baseUrl: string };
  pages: UiPage[];
  viewport?: { width: number; height: number };
  /** Sesión de Playwright guardada (para apps con login). */
  storageState?: string;
  /** Porcentaje de píxeles distintos a partir del cual se reporta un cambio visual. */
  visualThreshold?: number;
  waitForSelector?: string;
}

export interface AiConfig {
  /** none | prompt | anthropic | openai-compatible */
  provider: 'none' | 'prompt' | 'anthropic' | 'openai-compatible';
  model?: string;
  /** Para openai-compatible: Azure OpenAI, GitHub Models, Ollama, etc. */
  baseUrl?: string;
  /** Variable de entorno con la API key. */
  apiKeyEnv?: string;
  language?: string;
}

export interface Config {
  title?: string;
  fromLabel?: string;
  toLabel?: string;
  repos: RepoConfig[];
  jira?: { baseUrl?: string; projects?: string[] };
  api?: ApiConfig[];
  ui?: UiConfig;
  ai?: AiConfig;
}

/** Reemplaza ${VARIABLE} por su valor del entorno (útil en Jenkins). */
function interpolate<T>(value: T): T {
  if (typeof value === 'string') {
    return value.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] ?? '') as T;
  }
  if (Array.isArray(value)) return value.map(interpolate) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, interpolate(v)])) as T;
  }
  return value;
}

/** Lee JSON tolerando el BOM que agregan Notepad y PowerShell en Windows. */
export function readJson(file: string): any {
  return JSON.parse(fs.readFileSync(file, 'utf-8').replace(/^﻿/, ''));
}

export function loadConfig(file: string): Config {
  if (!fs.existsSync(file)) throw new Error(`No existe el archivo de configuración: ${file}`);
  const raw = interpolate(readJson(file)) as Config;
  if (!Array.isArray(raw.repos) || raw.repos.length === 0) {
    throw new Error('La configuración debe tener al menos un repositorio en "repos".');
  }
  const baseDir = path.dirname(path.resolve(file));
  for (const repo of raw.repos) {
    if (!repo.name || !repo.source) throw new Error('Cada repo necesita "name" y "source".');
    if (!/^(https?:|git@|ssh:)/.test(repo.source) && !path.isAbsolute(repo.source)) {
      repo.source = path.resolve(baseDir, repo.source);
    }
    repo.kind ??= 'other';
    if (repo.from === '') repo.from = undefined;
    if (repo.to === '') repo.to = undefined;
  }
  for (const api of raw.api ?? []) {
    for (const side of [api.old, api.new]) {
      if (side?.file && !path.isAbsolute(side.file)) side.file = path.resolve(baseDir, side.file);
    }
  }
  if (raw.ui?.storageState && !path.isAbsolute(raw.ui.storageState)) {
    raw.ui.storageState = path.resolve(baseDir, raw.ui.storageState);
  }
  return raw;
}
