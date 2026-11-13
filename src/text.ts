// Utilidades de texto: Jira, tipos de commit, nombres legibles.
import type { CommitType } from './types';

// Prefijos que parecen tickets pero no lo son.
const NOT_JIRA = new Set(['UTF', 'ISO', 'SHA', 'RFC', 'HTTP', 'TLS', 'AES', 'CVE', 'ES', 'MD', 'X']);

export function extractJira(text: string, projects?: string[]): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(/\b([A-Z][A-Z0-9]{1,9})-(\d{1,6})\b/g)) {
    const project = match[1];
    if (NOT_JIRA.has(project)) continue;
    if (projects?.length && !projects.includes(project)) continue;
    found.add(`${project}-${match[2]}`);
  }
  return [...found];
}

const MAINTENANCE = ['chore', 'build', 'ci', 'docs', 'test', 'style', 'deps'];

export function commitType(subject: string): CommitType {
  const conventional = subject.match(/^(\w+)(\([^)]*\))?!?:/);
  if (conventional) {
    const t = conventional[1].toLowerCase();
    if (t === 'feat' || t === 'feature') return 'feat';
    if (t === 'fix' || t === 'hotfix' || t === 'bugfix') return 'fix';
    if (t === 'perf') return 'perf';
    if (t === 'refactor') return 'refactor';
    if (MAINTENANCE.includes(t)) return 'maintenance';
  }
  const s = subject.toLowerCase();
  if (/\b(fix|corrig|arregl|bug|error|soluciona)/.test(s)) return 'fix';
  if (/\b(add|agreg|añad|nuev|implement|crea|permite|habilita)/.test(s)) return 'feat';
  if (/\b(refactor|limpi|reorganiz)/.test(s)) return 'refactor';
  if (/\b(bump|actualiz\w* dependenc|upgrade|readme|pipeline|jenkins|test)/.test(s)) return 'maintenance';
  return 'other';
}

/** Quita prefijos técnicos para que el texto se lea como una frase. */
export function cleanSubject(subject: string): string {
  let s = subject
    .replace(/^Merge (pull request|branch) .*?(from \S+)?\s*/i, '')
    .replace(/^(\w+)(\([^)]*\))?!?:\s*/, '')
    .replace(/\b[A-Z][A-Z0-9]{1,9}-\d{1,6}\b[:\s-]*/g, '')
    .replace(/^[\s:–-]+/, '')
    .trim();
  if (!s) s = subject.trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "registro-cliente.component" → "Registro cliente"; "PagosController" → "Pagos". */
export function humanize(name: string): string {
  const base = name
    .replace(/\.(component|page|view|screen|module|controller|service|resource|routes?|handler)$/i, '')
    .replace(/(Controller|Service|Resource|Handler|Router|Routes|Page|View|Screen|Component)$/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_.]+/g, ' ')
    .trim()
    .toLowerCase();
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : name;
}

/** Palabras significativas para relacionar pantallas/servicios con commits y archivos. */
export function keywords(...texts: string[]): string[] {
  const stop = new Set(['api', 'v1', 'v2', 'de', 'del', 'la', 'el', 'los', 'las', 'en', 'y', 'html', 'index', 'page', 'app']);
  const words = new Set<string>();
  for (const t of texts) {
    for (const w of t.toLowerCase().split(/[^a-z0-9áéíóúñ]+/)) {
      if (w.length >= 4 && !stop.has(w) && !/^\d+$/.test(w)) words.add(w);
    }
  }
  return [...words];
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
