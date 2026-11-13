// Versión corta en Markdown, para pegar en Teams, Slack, Jira o un correo.
import type { Report } from '../types';

const ICON = { nuevo: '🆕', cambio: '✏️', eliminado: '🗑️', correccion: '🐞', mejora: '⚙️' } as const;

export function renderMarkdown(r: Report): string {
  const lines: string[] = [];
  lines.push(`# ReleaseLens: ${r.fromLabel} → ${r.toLabel}`, '', r.summary, '');
  if (r.findings.length) {
    lines.push('## Qué cambió para el usuario');
    for (const f of r.findings) lines.push(`- ${ICON[f.category]} ${f.area ? `**${f.area}:** ` : ''}${f.text}${f.jira.length ? ` (${f.jira.join(', ')})` : ''}`);
    lines.push('');
  }
  const risks = [
    ...r.api.filter((c) => c.severity !== 'info').map((c) => `- ${c.severity === 'breaking' ? '⛔' : '⚠️'} ${c.text}`),
    ...r.ui.flatMap((p) => p.changes.filter((c) => c.severity !== 'info').map((c) => `- ⚠️ **${p.name}:** ${c.text}`)),
  ];
  if (risks.length) lines.push('## Riesgos', ...risks, '');
  if (r.undocumented.length) lines.push('## Cambios no documentados', ...r.undocumented.map((u) => `- 🕵️ ${u.text}`), '');
  if (r.testFocus.length) {
    lines.push('## Qué probar');
    const icon = { alta: '🔴', media: '🟡', baja: '🟢' } as const;
    for (const f of r.testFocus) lines.push(`- ${icon[f.priority]} **${f.area}**: ${f.reasons[0]}`);
    lines.push('');
  }
  if (r.jira.length) lines.push('## Tickets', ...r.jira.map((t) => `- ${t.url ? `[${t.key}](${t.url})` : t.key}: ${t.summary}`), '');
  return lines.join('\n');
}
