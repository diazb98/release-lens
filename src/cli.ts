#!/usr/bin/env node
// ReleaseLens: compara dos releases y explica qué cambió, qué riesgos hay y qué probar.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, readJson, type AiConfig } from './config';
import { collectRepo, readFileAt } from './git';
import { diffSpecs, loadSpec, parseSpec } from './api-diff';
import { compareUi } from './ui-diff';
import { analyze } from './analyze';
import { summarizeWithAi } from './ai';
import { renderHtml } from './report/html';
import { renderMarkdown } from './report/markdown';
import type { ApiChange, Report, UiPageResult } from './types';

const HELP = `
ReleaseLens: ¿qué cambió en este release?

Uso:
  release-lens --config releaselens.json [opciones]

Opciones:
  --config <archivo>      Configuración (por defecto releaselens.json)
  --out <carpeta>         Carpeta del reporte (por defecto release-report)
  --from <ref>            Versión anterior para todos los repos (tag, commit o rama)
  --to <ref>              Versión nueva para todos los repos
  --ref <repo>=<a>..<b>   Versiones de un repo específico (se puede repetir)
  --state <archivo>       Usa la última versión registrada como "from" si no se indica
  --save-state            Guarda las versiones nuevas en el archivo de estado
  --ai <proveedor>        none | prompt | anthropic | openai-compatible
  --fail-on-breaking      Termina con código 1 si hay cambios que rompen servicios
  --help                  Muestra esta ayuda
`;

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean | string[]> = { refs: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    if (['save-state', 'fail-on-breaking', 'help'].includes(key)) args[key] = true;
    else if (key === 'ref') (args.refs as string[]).push(argv[++i]);
    else args[key] = argv[++i];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return;
  }
  const config = loadConfig(String(args.config ?? 'releaselens.json'));
  const outDir = path.resolve(String(args.out ?? 'release-report'));
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const warnings: string[] = [];

  // 1. Versiones a comparar: CLI > configuración > estado guardado.
  const stateFile = args.state ? path.resolve(String(args.state)) : undefined;
  const state: Record<string, string> = stateFile && fs.existsSync(stateFile) ? readJson(stateFile) : {};
  for (const repo of config.repos) {
    if (args.from) repo.from = String(args.from);
    if (args.to) repo.to = String(args.to);
    for (const spec of args.refs as string[]) {
      const [name, range] = spec.split('=');
      if (name === repo.name && range) [repo.from, repo.to] = range.split('..');
    }
    if (!repo.from && state[repo.name]) repo.from = state[repo.name];
  }

  // 2. Git: commits, tickets, archivos, rutas y dependencias.
  console.log('🔍 Analizando repositorios...');
  const repos = config.repos.map((r) => {
    const result = collectRepo(r, config.jira?.projects);
    console.log(`   ${result.error ? '❌' : '✅'} ${r.name}: ${result.error ?? `${result.commits.length} commits, ${result.files.length} archivos`}`);
    if (result.error) warnings.push(`${r.name}: ${result.error}`);
    return result;
  });

  // 3. Contratos de API.
  const api: ApiChange[] = [];
  for (const a of config.api ?? []) {
    try {
      let before;
      let after;
      if (a.repo) {
        const repo = repos.find((r) => r.name === a.repo);
        if (!repo?.localPath || !repo.fromSha || !repo.toSha || !a.file) throw new Error(`no se pudo leer "${a.file}" del repo "${a.repo}"`);
        before = parseSpec(readFileAt(repo.localPath, repo.fromSha, a.file));
        after = parseSpec(readFileAt(repo.localPath, repo.toSha, a.file));
      } else {
        if (!a.old || !a.new) throw new Error('faltan "old" y "new"');
        [before, after] = await Promise.all([loadSpec(a.old), loadSpec(a.new)]);
      }
      const changes = diffSpecs(a.name, before, after);
      api.push(...changes);
      console.log(`   ✅ API ${a.name}: ${changes.length} cambios`);
    } catch (error) {
      warnings.push(`API ${a.name}: ${(error as Error).message}`);
      console.log(`   ❌ API ${a.name}: ${(error as Error).message}`);
    }
  }

  // 4. Pantallas.
  let ui: UiPageResult[] = [];
  if (config.ui?.pages?.length) {
    console.log('🖥️  Comparando pantallas...');
    try {
      ui = await compareUi(config.ui, outDir);
      for (const p of ui) console.log(`   ${p.error ? '⚠️ ' : p.changes.length ? '✏️ ' : '✅'} ${p.name}: ${p.error ?? `${p.changes.length} cambios, ${p.diffPercent}% visual`}`);
    } catch (error) {
      warnings.push(`Pantallas: ${(error as Error).message.split('\n')[0]}`);
    }
  }

  // 5. Análisis y reporte.
  const result = analyze(config, repos, api, ui);
  const first = config.repos[0];
  const report: Report = {
    title: config.title ?? 'Comparación de releases',
    generatedAt: new Date().toISOString(),
    fromLabel: config.fromLabel ?? String(args.from ?? first.from ?? '?'),
    toLabel: config.toLabel ?? String(args.to ?? first.to ?? 'HEAD'),
    repos: repos.map(({ localPath, ...r }) => r),
    api,
    ui,
    ...result,
    warnings,
  };

  const aiConfig: AiConfig | undefined = args.ai ? { ...config.ai, provider: String(args.ai) as AiConfig['provider'] } : config.ai;
  if (aiConfig && aiConfig.provider !== 'none') console.log(`🤖 Resumen con IA (${aiConfig.provider})...`);
  const ai = await summarizeWithAi(aiConfig, report, outDir);
  if (ai?.text) {
    report.aiSummary = ai.text;
    report.aiProvider = ai.provider;
  }
  if (ai?.warning) report.warnings.push(ai.warning);

  fs.writeFileSync(path.join(outDir, 'index.html'), renderHtml(report));
  fs.writeFileSync(path.join(outDir, 'resumen.md'), renderMarkdown(report));
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));

  if (stateFile && args['save-state']) {
    const next = { ...state };
    for (const r of repos) if (r.toSha) next[r.name] = r.toSha;
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify(next, null, 2));
  }

  console.log(`\n${report.summary}`);
  if (ai?.promptFile) console.log(`\n📝 Prompt para Copilot/IA: ${ai.promptFile}`);
  console.log(`\n📄 Reporte: ${path.join(outDir, 'index.html')}`);
  console.log(`📝 Resumen para Teams/Jira: ${path.join(outDir, 'resumen.md')}\n`);

  if (args['fail-on-breaking'] && api.some((c) => c.severity === 'breaking')) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`❌ ${(error as Error).message}`);
  process.exit(1);
});
