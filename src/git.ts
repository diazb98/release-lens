// Recolecta lo que cambió en cada repositorio entre dos versiones.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { RepoConfig } from './config';
import type { Commit, DependencyChange, FileChange, RepoChanges, RouteChange } from './types';
import { classifyFile, detectRoutesInDiff } from './classify';
import { commitType, extractJira } from './text';

const CACHE_DIR = path.resolve('.release-lens', 'repos');

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-c', 'core.longpaths=true', ...args], { cwd, encoding: 'utf-8', maxBuffer: 128 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Si el repo es remoto, lo clona (o actualiza) en una caché local. */
export function ensureLocalRepo(repo: RepoConfig): string {
  if (!/^(https?:|git@|ssh:)/.test(repo.source)) {
    if (!fs.existsSync(path.join(repo.source, '.git')) && !fs.existsSync(path.join(repo.source, 'HEAD'))) {
      throw new Error(`"${repo.source}" no es un repositorio git`);
    }
    return repo.source;
  }
  const dir = path.join(CACHE_DIR, repo.name.replace(/[^\w.-]/g, '_'));
  if (fs.existsSync(dir)) {
    git(dir, ['fetch', '--all', '--tags', '--prune', '--quiet']);
  } else {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    execFileSync('git', ['clone', '--quiet', '--no-checkout', repo.source, dir], { stdio: ['ignore', 'pipe', 'pipe'] });
  }
  return dir;
}

function resolveRef(cwd: string, ref: string): string {
  // En clones remotos las ramas viven como origin/<rama>.
  for (const candidate of [ref, `origin/${ref}`]) {
    try {
      return git(cwd, ['rev-parse', '--verify', '--quiet', `${candidate}^{commit}`]).trim();
    } catch {
      /* probar siguiente */
    }
  }
  throw new Error(`No se encontró la versión "${ref}"`);
}

function readCommits(cwd: string, repo: RepoConfig, from: string, to: string, projects?: string[]): Commit[] {
  const SEP = '\x1f';
  const END = '\x1e';
  const out = git(cwd, ['log', `--format=%H${SEP}%h${SEP}%an${SEP}%aI${SEP}%s${SEP}%b${SEP}%P${END}`, `${from}..${to}`, '--', ...(repo.paths ?? [])]);
  return out
    .split(END)
    .map((r) => r.trim())
    .filter(Boolean)
    .map((record) => {
      const [sha, shortSha, author, date, subject, body, parents] = record.split(SEP);
      return {
        repo: repo.name,
        sha,
        shortSha,
        author,
        date,
        subject,
        body: body.trim(),
        jira: extractJira(`${subject}\n${body}`, projects),
        type: commitType(subject),
        isMerge: parents.trim().split(' ').length > 1,
      };
    });
}

function readFiles(cwd: string, repo: RepoConfig, from: string, to: string): FileChange[] {
  const scope = ['--', ...(repo.paths ?? [])];
  const stats = new Map<string, { additions: number; deletions: number }>();
  for (const line of git(cwd, ['diff', '--numstat', '--no-renames', from, to, ...scope]).split('\n')) {
    const [a, d, file] = line.split('\t');
    if (file) stats.set(file, { additions: Number(a) || 0, deletions: Number(d) || 0 });
  }
  const statusName = { A: 'added', D: 'deleted', M: 'modified', T: 'modified' } as const;
  return git(cwd, ['diff', '--name-status', '--no-renames', from, to, ...scope])
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [code, file] = line.split('\t');
      const { category, area } = classifyFile(file);
      return {
        path: file,
        status: statusName[code[0] as keyof typeof statusName] ?? 'modified',
        ...(stats.get(file) ?? { additions: 0, deletions: 0 }),
        category,
        area,
      };
    });
}

function readRoutes(cwd: string, repo: RepoConfig, from: string, to: string, files: FileChange[]): RouteChange[] {
  const candidates = files.filter((f) => f.category === 'api' || f.category === 'logic').map((f) => f.path);
  if (candidates.length === 0) return [];
  const diff = git(cwd, ['diff', '-U0', '--no-renames', from, to, '--', ...candidates]);
  const detected = detectRoutesInDiff(diff);
  const key = (r: { method: string; path: string }) => `${r.method} ${r.path}`;
  const added = new Set(detected.filter((r) => r.sign === '+').map(key));
  const removed = new Set(detected.filter((r) => r.sign === '-').map(key));
  const routes: RouteChange[] = [];
  const seen = new Set<string>();
  for (const r of detected) {
    const k = key(r);
    // Una ruta que aparece agregada y eliminada solo cambió de lugar o de formato.
    if (added.has(k) && removed.has(k)) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    routes.push({ repo: repo.name, method: r.method, path: r.path, change: r.sign === '+' ? 'added' : 'removed', file: r.file });
  }
  return routes;
}

function readJsonAt(cwd: string, ref: string, file: string): Record<string, any> | undefined {
  try {
    return JSON.parse(git(cwd, ['show', `${ref}:${file}`]));
  } catch {
    return undefined;
  }
}

function readDependencies(cwd: string, repo: RepoConfig, from: string, to: string, files: FileChange[]): DependencyChange[] {
  const changes: DependencyChange[] = [];
  for (const f of files.filter((x) => path.posix.basename(x.path) === 'package.json')) {
    const before = readJsonAt(cwd, from, f.path) ?? {};
    const after = readJsonAt(cwd, to, f.path) ?? {};
    const deps = (pkg: Record<string, any>) => ({ ...pkg.dependencies, ...pkg.devDependencies }) as Record<string, string>;
    const a = deps(before);
    const b = deps(after);
    for (const name of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (a[name] === b[name]) continue;
      changes.push({ repo: repo.name, name, from: a[name], to: b[name], change: !a[name] ? 'added' : !b[name] ? 'removed' : 'updated' });
    }
  }
  return changes;
}

/** Lee un archivo del repo en una versión específica (para OpenAPI versionado en git). */
export function readFileAt(cwd: string, ref: string, file: string): string {
  return git(cwd, ['show', `${ref}:${file}`]);
}

export function collectRepo(repo: RepoConfig, projects?: string[]): RepoChanges & { localPath?: string } {
  const result: RepoChanges & { localPath?: string } = {
    name: repo.name,
    kind: repo.kind ?? 'other',
    from: repo.from ?? '',
    to: repo.to ?? 'HEAD',
    commits: [],
    files: [],
    routes: [],
    dependencies: [],
  };
  try {
    if (!repo.from) throw new Error('No se indicó la versión anterior ("from") y no hay estado guardado');
    const cwd = ensureLocalRepo(repo);
    result.localPath = cwd;
    const from = resolveRef(cwd, repo.from);
    const to = resolveRef(cwd, repo.to ?? 'HEAD');
    result.fromSha = from;
    result.toSha = to;
    result.commits = readCommits(cwd, repo, from, to, projects);
    result.files = readFiles(cwd, repo, from, to);
    result.routes = readRoutes(cwd, repo, from, to, result.files);
    result.dependencies = readDependencies(cwd, repo, from, to, result.files);
  } catch (error) {
    const msg = (error as Error & { stderr?: string }).stderr?.toString().trim() || (error as Error).message;
    result.error = msg.split('\n')[0];
  }
  return result;
}
