// Abre cada pantalla en la versión anterior y en la nueva, y compara contenido y aspecto visual.
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Page } from 'playwright';
import pixelmatch from 'pixelmatch';
import pngjs from 'pngjs';
import type { UiConfig } from './config';
import type { UiChange, UiElement, UiPageResult } from './types';

const { PNG } = pngjs;

const ROLE_LABEL: Record<UiElement['role'], string> = {
  heading: 'el título',
  field: 'el campo',
  button: 'el botón',
  link: 'el enlace',
};

/** Extrae los elementos que un usuario ve: títulos, campos, botones y enlaces. */
// Se envía como texto plano: así el compilador no le agrega helpers que no existen en el navegador.
const SNAPSHOT_SCRIPT = `(() => {
  function visible(el) {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  }
  function text(el) { return (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim(); }
  function labelOf(el) {
    return (el.labels && el.labels[0] ? text(el.labels[0]).replace(/\\s*\\*$/, '') : '') ||
      el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.name || el.id || '';
  }
  const out = [];
  const count = {};
  function push(role, el, label, extra) {
    count[role] = count[role] || 0;
    out.push(Object.assign({ role, index: count[role]++, id: el.getAttribute('data-testid') || el.id || '', name: el.getAttribute('name') || '', label }, extra || {}));
  }
  document.querySelectorAll('h1, h2, h3').forEach(function (el) { if (visible(el)) push('heading', el, text(el)); });
  document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea').forEach(function (el) {
    if (visible(el)) push('field', el, labelOf(el), { type: el.type || el.tagName.toLowerCase(), required: !!el.required });
  });
  document.querySelectorAll('button, [role=button], input[type=submit], input[type=button]').forEach(function (el) {
    if (visible(el)) push('button', el, text(el) || el.value || el.getAttribute('aria-label') || '');
  });
  document.querySelectorAll('a[href]').forEach(function (el) { if (visible(el) && text(el)) push('link', el, text(el)); });
  return out;
})()`;

async function snapshot(page: Page): Promise<UiElement[]> {
  return page.evaluate(SNAPSHOT_SCRIPT) as Promise<UiElement[]>;
}

function compareElements(before: UiElement[], after: UiElement[]): UiChange[] {
  const changes: UiChange[] = [];
  // Identidad estable: data-testid/id/name si existen; si no, el texto visible.
  const key = (e: UiElement) => (e.id || e.name ? `${e.role}|id:${e.id || e.name}` : `${e.role}|text:${e.label}`);
  const oldMap = new Map(before.map((e) => [key(e), e]));
  const newMap = new Map(after.map((e) => [key(e), e]));
  const removed = before.filter((e) => !newMap.has(key(e)));
  const added = after.filter((e) => !oldMap.has(key(e)));

  // Elementos con la misma identidad: revisar texto, obligatoriedad y tipo.
  for (const [k, n] of newMap) {
    const o = oldMap.get(k);
    if (!o) continue;
    if (o.label !== n.label && o.label && n.label) {
      changes.push({ severity: 'info', kind: 'changed', text: `${cap(ROLE_LABEL[n.role])} "${o.label}" ahora dice "${n.label}".` });
    }
    if (n.role === 'field' && !!o.required !== !!n.required) {
      changes.push({ severity: n.required ? 'risk' : 'info', kind: 'changed', text: `El campo "${n.label}" ${n.required ? 'ahora es obligatorio' : 'ya no es obligatorio'}.` });
    }
    if (n.role === 'field' && o.type !== n.type) {
      changes.push({ severity: 'info', kind: 'changed', text: `El campo "${n.label}" cambió de tipo (${o.type} → ${n.type}).` });
    }
  }

  // Sin identificador estable, un texto cambiado aparece como "quitado + agregado" en la misma posición.
  const pairedRemoved = new Set<UiElement>();
  const pairedAdded = new Set<UiElement>();
  for (const r of removed) {
    const match = added.find((a) => !pairedAdded.has(a) && a.role === r.role && a.role !== 'field' && a.index === r.index);
    if (match) {
      pairedRemoved.add(r);
      pairedAdded.add(match);
      changes.push({ severity: 'info', kind: 'changed', text: `${cap(ROLE_LABEL[r.role])} "${r.label}" ahora dice "${match.label}".` });
    }
  }
  for (const a of added.filter((x) => !pairedAdded.has(x))) {
    const req = a.role === 'field' && a.required ? ' (obligatorio)' : '';
    changes.push({ severity: a.role === 'field' && a.required ? 'risk' : 'info', kind: 'added', text: `Se agregó ${ROLE_LABEL[a.role]} "${a.label}"${req}.` });
  }
  for (const r of removed.filter((x) => !pairedRemoved.has(x))) {
    changes.push({ severity: 'risk', kind: 'removed', text: `Se quitó ${ROLE_LABEL[r.role]} "${r.label}".` });
  }
  return changes;
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function visualDiff(oldFile: string, newFile: string, diffFile: string): number {
  const a = PNG.sync.read(fs.readFileSync(oldFile));
  const b = PNG.sync.read(fs.readFileSync(newFile));
  const width = Math.min(a.width, b.width);
  const height = Math.min(a.height, b.height);
  const crop = (img: InstanceType<typeof PNG>) => {
    if (img.width === width && img.height === height) return img.data;
    const out = new PNG({ width, height });
    PNG.bitblt(img, out, 0, 0, width, height, 0, 0);
    return out.data;
  };
  const diff = new PNG({ width, height });
  const changed = pixelmatch(crop(a), crop(b), diff.data, width, height, { threshold: 0.1, alpha: 0.35 });
  fs.writeFileSync(diffFile, PNG.sync.write(diff));
  // La diferencia de alto también cuenta como cambio.
  const extra = Math.abs(a.height - b.height) * width;
  return ((changed + extra) / (Math.max(a.height, b.height) * width)) * 100;
}

function joinUrl(base: string, p: string): string {
  return new URL(p.replace(/^\//, ''), base.endsWith('/') ? base : `${base}/`).href;
}

export async function compareUi(config: UiConfig, outDir: string): Promise<UiPageResult[]> {
  const assets = path.join(outDir, 'assets');
  fs.mkdirSync(assets, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: config.viewport ?? { width: 1280, height: 800 },
    storageState: config.storageState,
  });
  const page = await context.newPage();
  const threshold = config.visualThreshold ?? 0.5;
  const results: UiPageResult[] = [];

  const capture = async (url: string, file: string) => {
    const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
    if (response && response.status() >= 400) throw new Error(`HTTP ${response.status()} en ${url}`);
    if (config.waitForSelector) await page.waitForSelector(config.waitForSelector, { timeout: 15_000 });
    await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' });
    const elements = await snapshot(page);
    await page.screenshot({ path: file, fullPage: true });
    return elements;
  };

  for (const p of config.pages) {
    const slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'pagina';
    const result: UiPageResult = { name: p.name, path: p.path, diffPercent: 0, changes: [] };
    const oldShot = path.join(assets, `${slug}-antes.png`);
    const newShot = path.join(assets, `${slug}-despues.png`);
    const diffShot = path.join(assets, `${slug}-diferencias.png`);
    let before: UiElement[] | undefined;
    let after: UiElement[] | undefined;
    try {
      before = await capture(joinUrl(config.old.baseUrl, p.path), oldShot);
      result.oldShot = `assets/${path.basename(oldShot)}`;
    } catch (e) {
      result.error = `Versión anterior: ${(e as Error).message.split('\n')[0]}`;
    }
    try {
      after = await capture(joinUrl(config.new.baseUrl, p.path), newShot);
      result.newShot = `assets/${path.basename(newShot)}`;
    } catch (e) {
      result.error = `${result.error ? `${result.error} · ` : ''}Versión nueva: ${(e as Error).message.split('\n')[0]}`;
    }
    if (before && !after) result.changes.push({ severity: 'breaking', kind: 'removed', text: 'La pantalla ya no carga en la versión nueva.' });
    if (!before && after) result.changes.push({ severity: 'info', kind: 'added', text: 'Pantalla nueva en esta versión.' });
    if (before && after) {
      result.changes.push(...compareElements(before, after));
      result.diffPercent = Math.round(visualDiff(oldShot, newShot, diffShot) * 10) / 10;
      result.diffShot = `assets/${path.basename(diffShot)}`;
      if (result.diffPercent >= threshold && result.changes.length === 0) {
        result.changes.push({ severity: 'info', kind: 'visual', text: `Cambió el aspecto visual (${result.diffPercent}% de la pantalla), sin cambios de textos ni campos.` });
      }
    }
    results.push(result);
  }
  await browser.close();
  return results;
}
