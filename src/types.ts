// Modelo de datos compartido por todos los módulos.

export type RepoKind = 'front' | 'back' | 'other';

export type CommitType = 'feat' | 'fix' | 'perf' | 'refactor' | 'maintenance' | 'other';

export interface Commit {
  repo: string;
  sha: string;
  shortSha: string;
  author: string;
  date: string;
  subject: string;
  body: string;
  jira: string[];
  type: CommitType;
  isMerge: boolean;
}

export type FileCategory = 'ui' | 'api' | 'logic' | 'data' | 'config' | 'deps' | 'test' | 'docs' | 'other';

export interface FileChange {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
  category: FileCategory;
  /** Nombre legible del área funcional, ej. "Registro cliente" o "Pagos". */
  area: string;
}

export interface RouteChange {
  repo: string;
  method: string;
  path: string;
  change: 'added' | 'removed';
  file: string;
}

export interface DependencyChange {
  repo: string;
  name: string;
  from?: string;
  to?: string;
  change: 'added' | 'removed' | 'updated';
}

export interface RepoChanges {
  name: string;
  kind: RepoKind;
  from: string;
  to: string;
  fromSha?: string;
  toSha?: string;
  commits: Commit[];
  files: FileChange[];
  routes: RouteChange[];
  dependencies: DependencyChange[];
  error?: string;
}

export type Severity = 'breaking' | 'risk' | 'info';

export interface ApiChange {
  source: string;
  severity: Severity;
  method: string;
  path: string;
  /** Texto en lenguaje de usuario. */
  text: string;
}

export interface UiElement {
  role: 'heading' | 'field' | 'button' | 'link';
  index: number;
  id: string;
  name: string;
  label: string;
  type?: string;
  required?: boolean;
}

export interface UiChange {
  severity: Severity;
  kind: 'added' | 'removed' | 'changed' | 'visual';
  text: string;
}

export interface UiPageResult {
  name: string;
  path: string;
  oldShot?: string;
  newShot?: string;
  diffShot?: string;
  diffPercent: number;
  changes: UiChange[];
  error?: string;
}

export type FindingCategory = 'nuevo' | 'cambio' | 'eliminado' | 'correccion' | 'mejora';

/** Un cambio explicado para personas que no leen código. */
export interface Finding {
  category: FindingCategory;
  text: string;
  source: 'commit' | 'api' | 'ui';
  area?: string;
  jira: string[];
  repos: string[];
}

export interface Undocumented {
  source: 'api' | 'ui';
  area: string;
  text: string;
}

export interface TestFocus {
  area: string;
  priority: 'alta' | 'media' | 'baja';
  reasons: string[];
}

export interface JiraTicket {
  key: string;
  url?: string;
  summary: string;
  repos: string[];
  commits: number;
}

export interface Report {
  title: string;
  generatedAt: string;
  fromLabel: string;
  toLabel: string;
  repos: RepoChanges[];
  api: ApiChange[];
  ui: UiPageResult[];
  findings: Finding[];
  undocumented: Undocumented[];
  testFocus: TestFocus[];
  jira: JiraTicket[];
  summary: string;
  aiSummary?: string;
  aiProvider?: string;
  warnings: string[];
}
