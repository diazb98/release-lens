// Compara dos versiones de un contrato OpenAPI/Swagger y explica los cambios.
import fs from 'node:fs';
import YAML from 'yaml';
import type { ApiChange, Severity } from './types';

type Json = Record<string, any>;

interface Field {
  type: string;
  required: boolean;
  enum?: string[];
}

interface Operation {
  method: string;
  path: string;
  summary: string;
  params: Map<string, Field>;
  request: Map<string, Field>;
  response: Map<string, Field>;
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

export function parseSpec(text: string): Json {
  const trimmed = text.trim();
  return trimmed.startsWith('{') ? JSON.parse(trimmed) : YAML.parse(trimmed);
}

export async function loadSpec(source: { file?: string; url?: string }): Promise<Json> {
  if (source.file) return parseSpec(fs.readFileSync(source.file, 'utf-8'));
  if (source.url) {
    const res = await fetch(source.url);
    if (!res.ok) throw new Error(`HTTP ${res.status} al descargar ${source.url}`);
    return parseSpec(await res.text());
  }
  throw new Error('Falta "file" o "url"');
}

function resolveRef(spec: Json, node: Json | undefined, seen = new Set<string>()): Json | undefined {
  if (!node?.$ref) return node;
  const ref: string = node.$ref;
  if (seen.has(ref)) return {};
  seen.add(ref);
  const target = ref
    .replace(/^#\//, '')
    .split('/')
    .reduce<Json | undefined>((acc, key) => acc?.[key.replace(/~1/g, '/').replace(/~0/g, '~')], spec);
  return resolveRef(spec, target, seen);
}

/** Aplana un schema a { "campo.subcampo": {tipo, requerido} }. */
function flatten(spec: Json, schema: Json | undefined, prefix = '', depth = 0, out = new Map<string, Field>(), seen = new Set<string>()): Map<string, Field> {
  if (schema?.$ref) {
    if (seen.has(schema.$ref)) return out;
    seen = new Set(seen).add(schema.$ref);
  }
  const s = resolveRef(spec, schema);
  if (!s || depth > 4) return out;
  for (const part of [...(s.allOf ?? []), ...(s.oneOf ?? []), ...(s.anyOf ?? [])]) flatten(spec, part, prefix, depth, out, seen);
  if (s.type === 'array' || s.items) {
    flatten(spec, s.items, prefix ? `${prefix}[]` : '', depth + 1, out, seen);
    return out;
  }
  const required = new Set<string>(s.required ?? []);
  for (const [name, child] of Object.entries<Json>(s.properties ?? {})) {
    const resolved = resolveRef(spec, child) ?? {};
    const key = prefix ? `${prefix}.${name}` : name;
    out.set(key, {
      type: resolved.type ?? (resolved.properties ? 'object' : resolved.items ? 'array' : 'any'),
      required: required.has(name),
      enum: resolved.enum?.map(String),
    });
    if (resolved.properties || resolved.items || resolved.allOf) flatten(spec, child, key, depth + 1, out, seen);
  }
  return out;
}

function successSchema(op: Json): Json | undefined {
  const responses: Json = op.responses ?? {};
  const code = Object.keys(responses).find((c) => /^2\d\d$/.test(c)) ?? 'default';
  const r = responses[code];
  if (!r) return undefined;
  // OpenAPI 3 usa content; Swagger 2 usa schema directo.
  return r.content ? (Object.values<Json>(r.content)[0]?.schema as Json) : r.schema;
}

function requestSchema(spec: Json, op: Json): Json | undefined {
  const body = resolveRef(spec, op.requestBody);
  if (body?.content) return Object.values<Json>(body.content)[0]?.schema;
  return (op.parameters ?? []).map((p: Json) => resolveRef(spec, p)).find((p: Json) => p?.in === 'body')?.schema;
}

function operations(spec: Json): Map<string, Operation> {
  const ops = new Map<string, Operation>();
  for (const [p, item] of Object.entries<Json>(spec.paths ?? {})) {
    for (const method of METHODS) {
      const op = item[method];
      if (!op) continue;
      const params = new Map<string, Field>();
      for (const raw of [...(item.parameters ?? []), ...(op.parameters ?? [])]) {
        const prm = resolveRef(spec, raw);
        if (!prm || prm.in === 'body') continue;
        params.set(`${prm.in}:${prm.name}`, { type: prm.schema?.type ?? prm.type ?? 'any', required: !!prm.required });
      }
      ops.set(`${method.toUpperCase()} ${p}`, {
        method: method.toUpperCase(),
        path: p,
        summary: op.summary ?? op.operationId ?? '',
        params,
        request: flatten(spec, requestSchema(spec, op)),
        response: flatten(spec, successSchema(op)),
      });
    }
  }
  return ops;
}

export function diffSpecs(source: string, before: Json, after: Json): ApiChange[] {
  const a = operations(before);
  const b = operations(after);
  const changes: ApiChange[] = [];
  const add = (severity: Severity, op: { method: string; path: string }, text: string) =>
    changes.push({ source, severity, method: op.method, path: op.path, text });
  const label = (op: Operation) => `${op.method} ${op.path}${op.summary ? ` (${op.summary})` : ''}`;
  const fieldName = (k: string) => k.replace(/^(query|path|header|cookie):/, '');

  for (const [key, op] of b) {
    if (!a.has(key)) add('info', op, `Nuevo servicio: ${label(op)}.`);
  }
  for (const [key, op] of a) {
    if (!b.has(key)) add('breaking', op, `Se eliminó el servicio ${label(op)}. Todo lo que lo use dejará de funcionar.`);
  }

  for (const [key, newOp] of b) {
    const oldOp = a.get(key);
    if (!oldOp) continue;
    const where = label(newOp);

    for (const [name, f] of newOp.params) {
      const old = oldOp.params.get(name);
      if (!old) add(f.required ? 'breaking' : 'info', newOp, f.required ? `Ahora es obligatorio enviar el parámetro "${fieldName(name)}" en ${where}.` : `${where} acepta un nuevo parámetro opcional "${fieldName(name)}".`);
      else if (f.required && !old.required) add('breaking', newOp, `El parámetro "${fieldName(name)}" pasó a ser obligatorio en ${where}.`);
    }
    for (const name of oldOp.params.keys()) {
      if (!newOp.params.has(name)) add('risk', newOp, `${where} ya no recibe el parámetro "${fieldName(name)}".`);
    }

    for (const [name, f] of newOp.request) {
      const old = oldOp.request.get(name);
      if (!old) add(f.required ? 'breaking' : 'info', newOp, f.required ? `Ahora es obligatorio enviar el dato "${name}" en ${where}.` : `${where} ahora acepta el dato opcional "${name}".`);
      else {
        if (f.required && !old.required) add('breaking', newOp, `El dato "${name}" pasó a ser obligatorio en ${where}.`);
        if (old.type !== f.type) add('breaking', newOp, `El dato "${name}" cambió de tipo (${old.type} → ${f.type}) en ${where}.`);
      }
    }
    for (const name of oldOp.request.keys()) {
      if (!newOp.request.has(name)) add('risk', newOp, `${where} ya no acepta el dato "${name}".`);
    }

    for (const [name, f] of newOp.response) {
      const old = oldOp.response.get(name);
      if (!old) add('info', newOp, `${where} ahora también devuelve "${name}".`);
      else {
        if (old.type !== f.type) add('risk', newOp, `"${name}" cambió de tipo (${old.type} → ${f.type}) en la respuesta de ${where}.`);
        const removedValues = (old.enum ?? []).filter((v) => !(f.enum ?? []).includes(v));
        const addedValues = (f.enum ?? []).filter((v) => !(old.enum ?? []).includes(v));
        if (removedValues.length) add('risk', newOp, `"${name}" ya no puede tomar los valores ${removedValues.join(', ')} en ${where}.`);
        if (addedValues.length && old.enum) add('info', newOp, `"${name}" tiene nuevos valores posibles: ${addedValues.join(', ')} (${where}).`);
      }
    }
    for (const name of oldOp.response.keys()) {
      if (!newOp.response.has(name)) {
        add('risk', newOp, `${where} ya no devuelve "${name}". Las pantallas que lo muestren pueden quedar vacías o fallar.`);
      }
    }
  }
  const order: Record<Severity, number> = { breaking: 0, risk: 1, info: 2 };
  return changes.sort((x, y) => order[x.severity] - order[y.severity]);
}
