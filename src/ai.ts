// Resumen opcional con IA. Solo envía el resumen estructurado de cambios (nunca código fuente).
import fs from 'node:fs';
import path from 'node:path';
import type { AiConfig } from './config';
import type { Report } from './types';

const INSTRUCTIONS = `Eres un analista de QA. Te paso, en JSON, los cambios detectados entre dos versiones de un sistema
(commits con tickets de Jira, cambios en servicios/API, cambios en pantallas y cambios no documentados).

Escribe en español, para testers funcionales y usuarios de negocio que no leen código:
1. Un párrafo corto (máximo 4 frases) con el resumen del release.
2. "Qué cambió para el usuario": viñetas concretas, en lenguaje de negocio.
3. "Riesgos": viñetas con lo que podría romperse y por qué.
4. "Qué probar primero": viñetas ordenadas por prioridad.

Usa solo la información del JSON; si algo no está claro, dilo en vez de inventarlo.
Formato: texto plano con títulos en líneas propias y viñetas que empiecen con "- ".`;

function payload(report: Report) {
  return {
    version: `${report.fromLabel} → ${report.toLabel}`,
    tickets: report.jira.map((t) => ({ key: t.key, resumen: t.summary, repos: t.repos })),
    cambiosFuncionales: report.findings.map((f) => ({ tipo: f.category, texto: f.text, area: f.area, jira: f.jira })),
    servicios: report.api.map((c) => ({ severidad: c.severity, servicio: `${c.method} ${c.path}`, cambio: c.text })),
    rutasEnCodigo: report.repos.flatMap((r) => r.routes.map((x) => `${x.change === 'added' ? 'nueva' : 'eliminada'}: ${x.method} ${x.path}`)),
    pantallas: report.ui.filter((p) => p.changes.length).map((p) => ({ pantalla: p.name, cambios: p.changes.map((c) => c.text) })),
    noDocumentados: report.undocumented.map((u) => u.text),
    dependencias: report.repos.flatMap((r) => r.dependencies.map((d) => `${d.name}: ${d.from ?? '—'} → ${d.to ?? 'eliminada'}`)),
    queProbar: report.testFocus.map((f) => ({ area: f.area, prioridad: f.priority })),
  };
}

function buildPrompt(report: Report): string {
  return `${INSTRUCTIONS}\n\nDATOS:\n${JSON.stringify(payload(report), null, 2)}`;
}

async function callAnthropic(config: AiConfig, prompt: string): Promise<string> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic(config.apiKeyEnv ? { apiKey: process.env[config.apiKeyEnv] } : {});
  const response = await client.beta.messages.create({
    model: config.model ?? 'claude-opus-5-5',
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium' },
    messages: [{ role: 'user', content: prompt }],
  });
  if (response.stop_reason === 'refusal') throw new Error('El modelo no generó el resumen (refusal)');
  return response.content
    .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

/** Para proveedores con API estilo OpenAI: Azure OpenAI, GitHub Models, Ollama, LM Studio, etc. */
async function callOpenAiCompatible(config: AiConfig, prompt: string): Promise<string> {
  if (!config.baseUrl) throw new Error('Falta ai.baseUrl para openai-compatible');
  const key = config.apiKeyEnv ? process.env[config.apiKeyEnv] : undefined;
  const res = await fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ model: config.model, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}

export interface AiResult {
  text?: string;
  promptFile?: string;
  provider: string;
  warning?: string;
}

export async function summarizeWithAi(config: AiConfig | undefined, report: Report, outDir: string): Promise<AiResult | undefined> {
  if (!config || config.provider === 'none') return undefined;
  const prompt = buildPrompt(report);
  // Modo "prompt": deja el texto listo para pegar en Copilot Chat u otra IA aprobada por la empresa.
  if (config.provider === 'prompt') {
    const file = path.join(outDir, 'prompt-para-ia.md');
    fs.writeFileSync(file, `<!-- Pega este contenido en Copilot Chat (u otra IA aprobada) -->\n\n${prompt}\n`);
    return { provider: 'prompt', promptFile: file };
  }
  try {
    const text = config.provider === 'anthropic' ? await callAnthropic(config, prompt) : await callOpenAiCompatible(config, prompt);
    return { provider: config.provider, text };
  } catch (error) {
    return { provider: config.provider, warning: `No se pudo generar el resumen con IA: ${(error as Error).message}` };
  }
}
