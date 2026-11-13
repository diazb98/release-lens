import type { Finding, Report, Severity, TestFocus } from '../types';

const esc = (v: unknown) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const CATEGORY: Record<Finding['category'], { label: string; cls: string }> = {
  nuevo: { label: 'Nuevo', cls: 'new' },
  cambio: { label: 'Cambió', cls: 'chg' },
  eliminado: { label: 'Eliminado', cls: 'del' },
  correccion: { label: 'Corrección', cls: 'fix' },
  mejora: { label: 'Mejora', cls: 'imp' },
};
const SEVERITY: Record<Severity, { label: string; cls: string }> = {
  breaking: { label: 'Rompe', cls: 'del' },
  risk: { label: 'Riesgo', cls: 'warn' },
  info: { label: 'Info', cls: 'chg' },
};
const PRIORITY: Record<TestFocus['priority'], string> = { alta: 'del', media: 'warn', baja: 'chg' };

function jiraLinks(report: Report, keys: string[]) {
  return keys
    .map((k) => {
      const t = report.jira.find((j) => j.key === k);
      return t?.url ? `<a class="jira" href="${esc(t.url)}" target="_blank" rel="noopener">${esc(k)}</a>` : `<span class="jira">${esc(k)}</span>`;
    })
    .join(' ');
}

/** Convierte el texto plano de la IA (títulos y viñetas) en HTML seguro. */
function aiToHtml(text: string) {
  const out: string[] = [];
  let list = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim().replace(/^#+\s*/, '').replace(/\*\*/g, '');
    if (/^[-*•]\s+/.test(line)) {
      if (!list) out.push('<ul>');
      list = true;
      out.push(`<li>${esc(line.replace(/^[-*•]\s+/, ''))}</li>`);
      continue;
    }
    if (list) out.push('</ul>');
    list = false;
    if (!line) continue;
    out.push(/^\d+\.\s|:$/.test(line) && line.length < 60 ? `<h4>${esc(line.replace(/^\d+\.\s*/, ''))}</h4>` : `<p>${esc(line)}</p>`);
  }
  if (list) out.push('</ul>');
  return out.join('\n');
}

export function renderHtml(r: Report): string {
  const commits = r.repos.reduce((n, x) => n + x.commits.length, 0);
  const risks = r.api.filter((c) => c.severity !== 'info');
  const uiRisks = r.ui.flatMap((p) => p.changes.filter((c) => c.severity !== 'info').map((c) => ({ page: p.name, ...c })));
  const date = new Date(r.generatedAt).toLocaleString('es', { dateStyle: 'long', timeStyle: 'short' });

  const findings = r.findings.length
    ? `<ul class="items">${r.findings
        .map(
          (f) => `<li><span class="pill ${CATEGORY[f.category].cls}">${CATEGORY[f.category].label}</span>
          <div><div>${f.area ? `<b>${esc(f.area)}:</b> ` : ''}${esc(f.text)}</div>
          <div class="meta">${jiraLinks(r, f.jira)} ${f.repos.map((x) => `<span class="repo">${esc(x)}</span>`).join(' ')}${f.source === 'ui' ? '<span class="repo">detectado en pantalla</span>' : ''}</div></div></li>`,
        )
        .join('')}</ul>`
    : '<p class="muted">No se detectaron cambios funcionales.</p>';

  const riskList = [
    ...risks.map((c) => `<li><span class="pill ${SEVERITY[c.severity].cls}">${SEVERITY[c.severity].label}</span><div>${esc(c.text)}<div class="meta"><span class="repo">${esc(c.source)}</span></div></div></li>`),
    ...uiRisks.map((c) => `<li><span class="pill ${SEVERITY[c.severity].cls}">${SEVERITY[c.severity].label}</span><div><b>${esc(c.page)}:</b> ${esc(c.text)}</div></li>`),
  ];

  const undocumented = r.undocumented.length
    ? `<ul class="items">${r.undocumented.map((u) => `<li><span class="pill warn">${u.source === 'ui' ? 'Pantalla' : 'API'}</span><div>${esc(u.text)}</div></li>`).join('')}</ul>`
    : '<p class="muted">Todo lo detectado está respaldado por commits o archivos modificados. ✅</p>';

  const focus = r.testFocus.length
    ? `<table><thead><tr><th>Prioridad</th><th>Qué probar</th><th>Por qué</th></tr></thead><tbody>${r.testFocus
        .map((f) => `<tr><td><span class="pill ${PRIORITY[f.priority]}">${f.priority}</span></td><td><b>${esc(f.area)}</b></td><td>${f.reasons.map(esc).join('<br>')}</td></tr>`)
        .join('')}</tbody></table>`
    : '<p class="muted">Sin sugerencias.</p>';

  const screens = r.ui
    .map(
      (p) => `<details class="screen" ${p.changes.length ? 'open' : ''}>
      <summary><b>${esc(p.name)}</b> <span class="muted">${esc(p.path)}</span>
        <span class="pill ${p.changes.length ? 'warn' : 'ok'}">${p.changes.length ? `${p.changes.length} cambio(s)` : 'Sin cambios'}</span>
        <span class="muted">${p.diffPercent}% visual</span></summary>
      ${p.error ? `<p class="err">${esc(p.error)}</p>` : ''}
      ${p.changes.length ? `<ul class="plain">${p.changes.map((c) => `<li>${esc(c.text)}</li>`).join('')}</ul>` : ''}
      <div class="shots">
        ${p.oldShot ? `<figure><figcaption>Antes</figcaption><a href="${esc(p.oldShot)}" target="_blank"><img loading="lazy" src="${esc(p.oldShot)}" alt="${esc(p.name)} antes"></a></figure>` : ''}
        ${p.newShot ? `<figure><figcaption>Después</figcaption><a href="${esc(p.newShot)}" target="_blank"><img loading="lazy" src="${esc(p.newShot)}" alt="${esc(p.name)} después"></a></figure>` : ''}
        ${p.diffShot ? `<figure><figcaption>Diferencias</figcaption><a href="${esc(p.diffShot)}" target="_blank"><img loading="lazy" src="${esc(p.diffShot)}" alt="${esc(p.name)} diferencias"></a></figure>` : ''}
      </div></details>`,
    )
    .join('');

  const api = r.api.length
    ? `<table><thead><tr><th></th><th>Servicio</th><th>Cambio</th></tr></thead><tbody>${r.api
        .map((c) => `<tr><td><span class="pill ${SEVERITY[c.severity].cls}">${SEVERITY[c.severity].label}</span></td><td><code>${esc(c.method)} ${esc(c.path)}</code></td><td>${esc(c.text)}</td></tr>`)
        .join('')}</tbody></table>`
    : '';

  const jira = r.jira.length
    ? `<table><thead><tr><th>Ticket</th><th>Resumen</th><th>Repos</th><th>Commits</th></tr></thead><tbody>${r.jira
        .map((t) => `<tr><td>${jiraLinks(r, [t.key])}</td><td>${esc(t.summary)}</td><td>${t.repos.map((x) => `<span class="repo">${esc(x)}</span>`).join(' ')}</td><td class="num">${t.commits}</td></tr>`)
        .join('')}</tbody></table>`
    : '<p class="muted">Ningún commit menciona tickets de Jira.</p>';

  const repos = r.repos
    .map((repo) => {
      const byCat = Object.entries(
        repo.files.reduce<Record<string, number>>((acc, f) => ((acc[f.category] = (acc[f.category] ?? 0) + 1), acc), {}),
      )
        .map(([k, v]) => `<span class="repo">${esc(k)}: ${v}</span>`)
        .join(' ');
      return `<details class="screen"><summary><b>${esc(repo.name)}</b> <span class="muted">${esc(repo.kind)} · ${esc(repo.from)} → ${esc(repo.to)}${repo.fromSha ? ` (${repo.fromSha.slice(0, 7)} → ${repo.toSha?.slice(0, 7)})` : ''}</span>
        ${repo.error ? '<span class="pill del">Error</span>' : `<span class="muted">${repo.commits.length} commits · ${repo.files.length} archivos</span>`}</summary>
        ${repo.error ? `<p class="err">${esc(repo.error)}</p>` : ''}
        ${byCat ? `<p>${byCat}</p>` : ''}
        ${repo.routes.length ? `<h4>Rutas de API detectadas en el código</h4><ul class="plain">${repo.routes.map((x) => `<li>${x.change === 'added' ? '🆕' : '🗑️'} <code>${esc(x.method)} ${esc(x.path)}</code> <span class="muted">${esc(x.file)}</span></li>`).join('')}</ul>` : ''}
        ${repo.dependencies.length ? `<h4>Dependencias</h4><ul class="plain">${repo.dependencies.map((d) => `<li><code>${esc(d.name)}</code> ${esc(d.from ?? '—')} → ${esc(d.to ?? 'eliminada')}</li>`).join('')}</ul>` : ''}
        ${repo.commits.length ? `<h4>Commits</h4><ul class="plain commits">${repo.commits.map((c) => `<li><code>${esc(c.shortSha)}</code> ${esc(c.subject)} <span class="muted">· ${esc(c.author)}</span></li>`).join('')}</ul>` : ''}
      </details>`;
    })
    .join('');

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ReleaseLens · ${esc(r.fromLabel)} → ${esc(r.toLabel)}</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--text:#16181d;--muted:#646b78;--border:#e3e6eb;--accent:#3b5bdb;
--ok:#1a8f4c;--ok-bg:#e6f5ec;--warn:#9a5b00;--warn-bg:#fdf2dd;--del:#c62828;--del-bg:#fce8e8;--chg:#3b5bdb;--chg-bg:#e8edfd;--new:#0b7a75;--new-bg:#ddf4f2;--fix:#6a3fb5;--fix-bg:#efe7fb}
@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--card:#171a21;--text:#e8eaee;--muted:#9aa1ad;--border:#262b35;--accent:#8ea6ff;
--ok:#4cc47f;--ok-bg:#12291c;--warn:#f0b04a;--warn-bg:#2d2412;--del:#f06a6a;--del-bg:#2f1616;--chg:#8ea6ff;--chg-bg:#1a2140;--new:#4fd1c5;--new-bg:#0f2a28;--fix:#b794f4;--fix-bg:#251a3a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:1040px;margin:0 auto;padding:32px 16px 56px}
header{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:end;gap:8px;margin-bottom:18px}
h1{margin:0;font-size:26px;letter-spacing:-.02em}h1 small{display:block;font-size:15px;font-weight:500;color:var(--muted);letter-spacing:0}
h2{font-size:18px;margin:34px 0 12px}h4{margin:14px 0 6px;font-size:14px}
.muted{color:var(--muted);font-size:13px;font-weight:400}
.summary{background:var(--card);border:1px solid var(--border);border-left:4px solid var(--accent);border-radius:12px;padding:16px 18px;font-size:16px}
.ai{margin-top:12px;background:var(--card);border:1px solid var(--border);border-radius:12px;padding:6px 18px 12px}.ai h4{color:var(--accent)}
.kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin:16px 0 4px}
.kpi{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px 14px}.kpi b{display:block;font-size:26px;line-height:1.15;font-variant-numeric:tabular-nums}
.kpi.risk b{color:var(--del)}.kpi.und b{color:var(--warn)}
.items{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.items li{display:flex;gap:12px;align-items:flex-start;background:var(--card);border:1px solid var(--border);border-radius:10px;padding:10px 14px}
.pill{flex:none;display:inline-block;font-size:12px;font-weight:600;padding:2px 10px;border-radius:999px;white-space:nowrap}
.pill.new{background:var(--new-bg);color:var(--new)}.pill.chg{background:var(--chg-bg);color:var(--chg)}.pill.del{background:var(--del-bg);color:var(--del)}
.pill.fix{background:var(--fix-bg);color:var(--fix)}.pill.imp,.pill.ok{background:var(--ok-bg);color:var(--ok)}.pill.warn{background:var(--warn-bg);color:var(--warn)}
.meta{margin-top:3px;display:flex;flex-wrap:wrap;gap:6px}
.repo{font-size:12px;color:var(--muted);border:1px solid var(--border);border-radius:5px;padding:0 6px}
.jira{font-size:12px;font-weight:600;color:var(--accent);text-decoration:none;border:1px solid var(--border);border-radius:5px;padding:0 6px}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--border);border-radius:10px;overflow:hidden;display:block;overflow-x:auto}
th,td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--border);vertical-align:top}th{font-size:13px;color:var(--muted);font-weight:600}
tbody tr:last-child td{border-bottom:none}td.num{font-variant-numeric:tabular-nums;text-align:right}
code{font:13px ui-monospace,SFMono-Regular,Consolas,monospace;background:var(--bg);padding:1px 5px;border-radius:4px;overflow-wrap:anywhere}
.screen{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:10px 14px;margin-bottom:8px}
.screen summary{cursor:pointer;display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.plain{margin:8px 0;padding-left:20px}.commits li{margin:2px 0}
.shots{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:10px}
figure{margin:0}figcaption{font-size:12px;color:var(--muted);margin-bottom:4px}
.shots img{width:100%;max-height:420px;object-fit:cover;object-position:top;border:1px solid var(--border);border-radius:8px;display:block}
.err{color:var(--del)}
footer{margin-top:40px;color:var(--muted);font-size:13px;text-align:center}
@media (max-width:700px){.kpis{grid-template-columns:repeat(2,1fr)}.shots{grid-template-columns:1fr}}
</style>
</head>
<body>
<div class="wrap">
<header>
  <h1>🔍 ReleaseLens<small>${esc(r.title)} · ${esc(r.fromLabel)} → ${esc(r.toLabel)}</small></h1>
  <span class="muted">${esc(date)}</span>
</header>
<div class="summary">${esc(r.summary)}</div>
${r.aiSummary ? `<div class="ai">${aiToHtml(r.aiSummary)}<p class="muted">Resumen generado con IA (${esc(r.aiProvider)}) a partir del análisis; verifica antes de compartir.</p></div>` : ''}
${r.warnings.length ? `<p class="err">${r.warnings.map(esc).join('<br>')}</p>` : ''}
<div class="kpis">
  <div class="kpi"><span class="muted">Tickets</span><b>${r.jira.length}</b></div>
  <div class="kpi"><span class="muted">Commits</span><b>${commits}</b></div>
  <div class="kpi"><span class="muted">Cambios funcionales</span><b>${r.findings.length}</b></div>
  <div class="kpi risk"><span class="muted">Riesgos</span><b>${riskList.length}</b></div>
  <div class="kpi und"><span class="muted">No documentados</span><b>${r.undocumented.length}</b></div>
</div>

<h2>👤 Qué cambió para el usuario</h2>${findings}
${riskList.length ? `<h2>⚠️ Riesgos</h2><ul class="items">${riskList.join('')}</ul>` : ''}
<h2>🕵️ Cambios no documentados</h2>${undocumented}
<h2>🎯 Qué probar</h2>${focus}
${r.ui.length ? `<h2>🖥️ Pantallas: antes y después</h2>${screens}` : ''}
${api ? `<h2>🔌 Servicios (API)</h2>${api}` : ''}
<h2>🎫 Tickets de Jira</h2>${jira}
<h2>🧰 Detalle técnico por repositorio</h2>${repos}
<footer>Generado con ReleaseLens</footer>
</div>
</body>
</html>`;
}
