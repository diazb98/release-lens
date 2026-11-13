// Cruza commits, API y pantallas para explicar el release en lenguaje de usuario.
import type { Config } from './config';
import type { ApiChange, Finding, FindingCategory, JiraTicket, RepoChanges, TestFocus, UiPageResult, Undocumented } from './types';
import { cleanSubject, keywords, plural } from './text';

const PRIORITY_ORDER = { alta: 0, media: 1, baja: 2 } as const;

function commitFindings(repos: RepoChanges[]): Finding[] {
  const byTicket = new Map<string, { commits: RepoChanges['commits']; repos: Set<string> }>();
  const loose: Finding[] = [];
  for (const repo of repos) {
    for (const c of repo.commits) {
      if (c.type === 'maintenance') continue;
      if (c.jira.length === 0) {
        if (c.isMerge) continue;
        loose.push({ category: categoryFor([c.type]), text: cleanSubject(c.subject), source: 'commit', jira: [], repos: [repo.name] });
        continue;
      }
      for (const key of c.jira) {
        const entry = byTicket.get(key) ?? { commits: [], repos: new Set<string>() };
        entry.commits.push(c);
        entry.repos.add(repo.name);
        byTicket.set(key, entry);
      }
    }
  }
  const findings: Finding[] = [];
  for (const [key, { commits, repos: r }] of byTicket) {
    const main = commits.find((c) => !c.isMerge && (c.type === 'feat' || c.type === 'fix')) ?? commits.find((c) => !c.isMerge) ?? commits[0];
    findings.push({ category: categoryFor(commits.map((c) => c.type)), text: cleanSubject(main.subject), source: 'commit', jira: [key], repos: [...r] });
  }
  // Evita duplicar el mismo texto.
  const seen = new Set<string>();
  return [...findings, ...loose].filter((f) => {
    const k = f.text.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function categoryFor(types: string[]): FindingCategory {
  if (types.includes('feat')) return 'nuevo';
  if (types.includes('fix')) return 'correccion';
  if (types.includes('perf') || types.includes('refactor')) return 'mejora';
  return 'cambio';
}

function uiFindings(ui: UiPageResult[]): Finding[] {
  const map = { added: 'nuevo', removed: 'eliminado', changed: 'cambio', visual: 'cambio' } as const;
  return ui.flatMap((p) => p.changes.map((c) => ({ category: map[c.kind], text: c.text, source: 'ui' as const, area: p.name, jira: [], repos: [] })));
}

function haystack(repos: RepoChanges[], kinds: string[]): string {
  return repos
    .filter((r) => kinds.includes(r.kind))
    .flatMap((r) => [...r.files.map((f) => f.path), ...r.commits.map((c) => `${c.subject} ${c.body}`)])
    .join('\n')
    .toLowerCase();
}

function apiKeywords(p: string): string[] {
  return keywords(p.replace(/\{[^}]+\}/g, ''));
}

function findUndocumented(config: Config, repos: RepoChanges[], api: ApiChange[], ui: UiPageResult[]): Undocumented[] {
  const out: Undocumented[] = [];
  const front = haystack(repos, ['front', 'other']);
  const back = haystack(repos, ['back', 'other']);
  const pageConfig = new Map((config.ui?.pages ?? []).map((p) => [p.name, p]));

  for (const page of ui.filter((p) => p.changes.length > 0)) {
    const cfg = pageConfig.get(page.name);
    const words = cfg?.match?.length ? cfg.match.map((w) => w.toLowerCase()) : keywords(page.name, page.path);
    if (!words.some((w) => front.includes(w))) {
      out.push({
        source: 'ui',
        area: page.name,
        text: `La pantalla "${page.name}" cambió, pero ningún commit ni archivo modificado la menciona. Puede venir de un componente compartido o de un cambio no informado.`,
      });
    }
  }

  const apiPaths = [...new Set(api.map((c) => `${c.method} ${c.path}`))];
  for (const key of apiPaths) {
    const p = key.split(' ')[1];
    const words = apiKeywords(p);
    if (words.length && !words.some((w) => back.includes(w))) {
      out.push({ source: 'api', area: key, text: `El servicio ${key} cambió en el contrato, pero ningún commit ni archivo del backend lo menciona.` });
    }
  }

  // Rutas nuevas en el código que el contrato (Swagger) no refleja.
  if ((config.api ?? []).length > 0) {
    const inSpec = new Set(api.map((c) => `${c.method} ${c.path}`));
    for (const route of repos.flatMap((r) => r.routes).filter((r) => r.change === 'added')) {
      const key = `${route.method} ${route.path}`;
      if (!inSpec.has(key)) {
        out.push({ source: 'api', area: key, text: `Se agregó la ruta ${key} en el código (${route.file}), pero el contrato de API no la documenta.` });
      }
    }
  }
  return out;
}

function testFocus(config: Config, repos: RepoChanges[], api: ApiChange[], ui: UiPageResult[]): TestFocus[] {
  const focus = new Map<string, TestFocus>();
  const add = (area: string, priority: TestFocus['priority'], reason: string) => {
    const f = focus.get(area) ?? { area, priority, reasons: [] };
    if (PRIORITY_ORDER[priority] < PRIORITY_ORDER[f.priority]) f.priority = priority;
    if (!f.reasons.includes(reason) && f.reasons.length < 4) f.reasons.push(reason);
    focus.set(area, f);
  };

  for (const page of ui) {
    for (const c of page.changes) add(page.name, c.severity === 'info' ? 'media' : 'alta', c.text);
  }

  const pages = config.ui?.pages ?? [];
  for (const c of api.filter((x) => x.severity !== 'info')) {
    const linked = pages.filter((p) => (p.apis ?? []).some((a) => c.path.startsWith(a)));
    // Si una pantalla usa el servicio afectado, el riesgo se vuelve visible para el usuario: prioridad alta.
    if (linked.length) linked.forEach((p) => add(p.name, 'alta', `Usa un servicio que cambió: ${c.text}`));
    else add(`Servicio ${c.method} ${c.path}`, c.severity === 'breaking' ? 'alta' : 'media', c.text);
  }

  // Relaciona el área de un archivo ("Registro cliente") con la pantalla configurada ("Registro de cliente").
  const pageFor = (area: string) => {
    const words = keywords(area);
    return pages.find((p) => {
      const pw = p.match?.length ? p.match.map((w) => w.toLowerCase()) : keywords(p.name, p.path);
      return words.some((w) => pw.includes(w));
    })?.name;
  };
  for (const c of api.filter((x) => x.severity === 'info' && x.text.startsWith('Nuevo servicio'))) {
    add(`Servicio ${c.method} ${c.path}`, 'media', c.text);
  }

  for (const repo of repos) {
    for (const f of repo.files) {
      if (f.category === 'ui') {
        if (f.area === 'Componentes compartidos') add(f.area, 'media', 'Cambiaron componentes o estilos compartidos: revisar las pantallas que los usan.');
        else add(pageFor(f.area) ?? f.area, 'media', 'Se modificó el código de esta pantalla.');
      }
      if (f.category === 'data') add('Datos y base de datos', 'alta', `Cambio en ${f.path}: validar datos existentes y migración.`);
      if (f.category === 'config') add('Configuración y despliegue', 'baja', `Cambio de configuración en ${repo.name}: ${f.path}.`);
    }
    for (const r of repo.routes) {
      add(`Servicio ${r.method} ${r.path}`, r.change === 'removed' ? 'alta' : 'media', r.change === 'added' ? `Nueva ruta en el código (${repo.name}).` : `Se eliminó la ruta del código (${repo.name}).`);
    }
    if (repo.dependencies.some((d) => d.change !== 'added')) {
      const n = repo.dependencies.length;
      add('Regresión general', 'baja', `${n === 1 ? 'Se actualizó' : 'Se actualizaron'} ${plural(n, 'dependencia', 'dependencias')} en ${repo.name}.`);
    }
  }
  return [...focus.values()].sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
}

function jiraTickets(config: Config, repos: RepoChanges[]): JiraTicket[] {
  const map = new Map<string, JiraTicket>();
  for (const repo of repos) {
    for (const c of repo.commits) {
      for (const key of c.jira) {
        const t = map.get(key) ?? {
          key,
          url: config.jira?.baseUrl ? `${config.jira.baseUrl.replace(/\/?$/, '/')}${key}` : undefined,
          summary: cleanSubject(c.subject),
          repos: [],
          commits: 0,
        };
        t.commits++;
        if (!t.repos.includes(repo.name)) t.repos.push(repo.name);
        if (!c.isMerge && c.type !== 'maintenance') t.summary = cleanSubject(c.subject);
        map.set(key, t);
      }
    }
  }
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
}

export function analyze(config: Config, repos: RepoChanges[], api: ApiChange[], ui: UiPageResult[]) {
  const findings = [...commitFindings(repos), ...uiFindings(ui)];
  const undocumented = findUndocumented(config, repos, api, ui);
  const focus = testFocus(config, repos, api, ui);
  const jira = jiraTickets(config, repos);

  const risks = api.filter((c) => c.severity !== 'info').length + ui.flatMap((p) => p.changes).filter((c) => c.severity !== 'info').length;
  const breaking = api.filter((c) => c.severity === 'breaking').length;
  const commits = repos.reduce((n, r) => n + r.commits.length, 0);
  const top = focus.filter((f) => f.priority === 'alta').slice(0, 4).map((f) => f.area);
  const parts = [
    `Esta versión incluye ${plural(jira.length, 'ticket', 'tickets')} y ${plural(commits, 'commit', 'commits')} en ${plural(repos.length, 'repositorio', 'repositorios')}.`,
    `Se detectaron ${plural(findings.length, 'cambio funcional', 'cambios funcionales')}, ${plural(risks, 'riesgo', 'riesgos')}${breaking ? ` (${plural(breaking, 'cambio que puede romper integraciones', 'cambios que pueden romper integraciones')})` : ''} y ${plural(undocumented.length, 'cambio no documentado', 'cambios no documentados')}.`,
  ];
  if (top.length) parts.push(`Prioriza probar: ${top.join(', ')}.`);
  return { findings, undocumented, testFocus: focus, jira, summary: parts.join(' ') };
}
