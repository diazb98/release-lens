// Clasifica archivos y detecta cambios de rutas de API en cualquier lenguaje, sin depender de Swagger.
import path from 'node:path';
import type { FileCategory } from './types';
import { humanize } from './text';

const UI_ANCHORS = ['pages', 'page', 'views', 'view', 'screens', 'features', 'modules', 'components', 'templates', 'app'];
const UI_EXT = /\.(html?|css|scss|sass|less|vue|svelte|jsx|tsx)$/i;

export function classifyFile(file: string): { category: FileCategory; area: string } {
  const p = file.replace(/\\/g, '/');
  const lower = p.toLowerCase();
  const base = path.posix.basename(p);
  const name = base.replace(/\.[^.]+$/, '');
  const dirs = p.split('/').slice(0, -1);

  if (/(^|\/)(tests?|__tests__|spec|specs|e2e|cypress|playwright)\//i.test(p) || /\.(spec|test)\.[^.]+$/i.test(base)) {
    return { category: 'test', area: 'Pruebas' };
  }
  if (/\.(md|adoc|txt)$/i.test(base) || /(^|\/)docs?\//i.test(p)) return { category: 'docs', area: 'Documentación' };
  if (/^(package(-lock)?\.json|yarn\.lock|pnpm-lock\.yaml|pom\.xml|build\.gradle(\.kts)?|requirements\.txt|pyproject\.toml|go\.(mod|sum)|.*\.csproj|composer\.json|gemfile(\.lock)?)$/i.test(base)) {
    return { category: 'deps', area: 'Dependencias' };
  }
  if (/(openapi|swagger)/i.test(base)) return { category: 'api', area: 'Contrato de API' };
  if (/(^|\/)(migrations?|db|database|flyway|liquibase)\//i.test(p) || /\.sql$/i.test(base)) {
    return { category: 'data', area: 'Base de datos' };
  }
  if (/^(dockerfile|jenkinsfile|\.env.*|.*\.properties|nginx\.conf|docker-compose.*)$/i.test(base) || /(^|\/)(k8s|helm|deploy|infra|\.github|config)\//i.test(p) || /\.(ya?ml|toml|ini|conf)$/i.test(base)) {
    return { category: 'config', area: 'Configuración' };
  }
  if (/(controller|route|router|endpoint|resource|handler|api)/i.test(lower) && !UI_EXT.test(base)) {
    return { category: 'api', area: humanize(name) };
  }
  if (UI_EXT.test(base) || dirs.some((d) => /^(pages|views|screens|components|templates)$/i.test(d))) {
    // Usa la carpeta después de pages/ views/ etc. como nombre de pantalla.
    // Las carpetas más específicas (pages, views...) ganan sobre las genéricas (app, modules).
    const lowerDirs = dirs.map((d) => d.toLowerCase());
    const anchorName = UI_ANCHORS.find((a) => lowerDirs.includes(a));
    const anchor = anchorName ? lowerDirs.lastIndexOf(anchorName) : -1;
    let area = humanize(name);
    if (anchor >= 0 && dirs[anchor + 1] && !['shared', 'common', 'core'].includes(dirs[anchor + 1].toLowerCase())) {
      area = humanize(dirs[anchor + 1]);
    } else if (dirs.some((d) => ['shared', 'common', 'core', 'styles', 'assets'].includes(d.toLowerCase()))) {
      area = 'Componentes compartidos';
    }
    return { category: 'ui', area };
  }
  if (/\.(java|kt|ts|js|mjs|cs|py|go|rb|php|scala)$/i.test(base)) return { category: 'logic', area: humanize(name) };
  return { category: 'other', area: humanize(name) };
}

// Patrones de declaración de endpoints en los frameworks más comunes.
const ROUTE_PATTERNS: { re: RegExp; method: (m: RegExpMatchArray) => string; path: (m: RegExpMatchArray) => string }[] = [
  // Spring: @GetMapping("/x"), @PostMapping(value = "/x"), @RequestMapping("/x")
  { re: /@(Get|Post|Put|Delete|Patch|Request)Mapping\(\s*(?:value\s*=\s*|path\s*=\s*)?\{?\s*"([^"]*)"/, method: (m) => (m[1] === 'Request' ? 'ANY' : m[1].toUpperCase()), path: (m) => m[2] },
  // Express / Fastify / Koa: router.get('/x'), app.post("/x")
  { re: /\b(?:app|router|server|api|routes)\.(get|post|put|delete|patch)\(\s*['"`]([^'"`]+)['"`]/i, method: (m) => m[1].toUpperCase(), path: (m) => m[2] },
  // NestJS: @Get('x')
  { re: /@(Get|Post|Put|Delete|Patch)\(\s*['"]([^'"]*)['"]/, method: (m) => m[1].toUpperCase(), path: (m) => m[2] },
  // .NET: [HttpGet("x")]
  { re: /\[Http(Get|Post|Put|Delete|Patch)\(\s*"([^"]*)"/, method: (m) => m[1].toUpperCase(), path: (m) => m[2] },
  // FastAPI / Flask: @app.get("/x"), @router.post('/x')
  { re: /@\w+\.(get|post|put|delete|patch)\(\s*['"]([^'"]+)['"]/i, method: (m) => m[1].toUpperCase(), path: (m) => m[2] },
  // Flask clásico: @app.route('/x', methods=['POST'])
  { re: /@\w+\.route\(\s*['"]([^'"]+)['"](?:.*methods\s*=\s*\[\s*['"](\w+)['"])?/i, method: (m) => (m[2] ?? 'GET').toUpperCase(), path: (m) => m[1] },
];

export interface DetectedRoute {
  method: string;
  path: string;
  file: string;
  sign: '+' | '-';
}

/** Lee un diff unificado y devuelve las rutas declaradas en líneas agregadas o eliminadas. */
export function detectRoutesInDiff(diff: string): DetectedRoute[] {
  const routes: DetectedRoute[] = [];
  let file = '';
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      file = line.replace(/^\+\+\+ (b\/)?/, '');
      continue;
    }
    if (line.startsWith('--- ')) {
      if (!line.includes('/dev/null')) file = line.replace(/^--- (a\/)?/, '');
      continue;
    }
    const sign = line[0];
    if (sign !== '+' && sign !== '-') continue;
    for (const p of ROUTE_PATTERNS) {
      const m = line.slice(1).match(p.re);
      if (m) {
        routes.push({ method: p.method(m), path: p.path(m), file, sign });
        break;
      }
    }
  }
  return routes;
}
