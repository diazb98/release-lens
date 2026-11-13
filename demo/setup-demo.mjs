// Crea una app de demostración ("Demo Shop") con dos versiones: v1.0.0 y v1.1.0.
// Genera dos repos git (front y back), los sitios publicados de cada versión y la configuración.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const work = path.join(here, '.work');
fs.rmSync(work, { recursive: true, force: true });

const people = {
  ana: { name: 'Ana Torres', email: 'ana.torres@demo-shop.test' },
  luis: { name: 'Luis Ramos', email: 'luis.ramos@demo-shop.test' },
  carla: { name: 'Carla Medina', email: 'carla.medina@demo-shop.test' },
};
let clock = Date.parse('2026-11-02T09:00:00Z');

function write(dir, file, content) {
  const full = path.join(dir, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content.trimStart());
}
function git(dir, args, who = people.ana) {
  clock += 3 * 3600 * 1000;
  const date = new Date(clock).toISOString();
  execFileSync('git', ['-c', `user.name=${who.name}`, '-c', `user.email=${who.email}`, '-c', 'core.autocrlf=false', '-c', 'core.longpaths=true', ...args], {
    cwd: dir,
    stdio: 'pipe',
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  });
}
function commit(dir, message, who) {
  git(dir, ['add', '-A'], who);
  git(dir, ['commit', '-q', '-m', message], who);
}
function initRepo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'core.longpaths', 'true']);
}

// ---------- Frontend ----------
const page = (title, body) => `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><title>${title} · Demo Shop</title><link rel="stylesheet" href="theme.css"></head>
<body>
<nav class="top"><b>Demo Shop</b><a href="registro.html">Registro</a><a href="pago.html">Pago</a><a href="perfil.html">Mi perfil</a></nav>
<main class="card ${title === 'Mi perfil' ? 'perfil-card' : ''}">
${body}
</main>
</body>
</html>
`;

const registro = (v2) =>
  page(
    'Registro de cliente',
    `<h1>Registro de cliente</h1>
<form>
  <label for="nombres">Nombres *</label><input id="nombres" name="nombres" required>
  <label for="apellidos">Apellidos</label><input id="apellidos" name="apellidos">
  <label for="correo">Correo electrónico *</label><input id="correo" name="correo" type="email" required>
${v2 ? '  <label for="celular">Celular *</label><input id="celular" name="celular" type="tel" required>\n' : ''}  <button type="submit">Registrarme</button>
</form>`,
  );

const pago = (v2) =>
  page(
    'Resumen de pago',
    `<h1>Resumen de pago</h1>
<p class="row"><span>Subtotal</span><span>S/ 120.00</span></p>
<p class="row"><span>Descuento</span><span>- S/ 10.00</span></p>
<p class="row total"><span>Total</span><span>S/ 110.00</span></p>
<button class="primary">${v2 ? 'Confirmar pago' : 'Pagar'}</button>
<a href="#">Volver al carrito</a>`,
  );

const perfil = () =>
  page(
    'Mi perfil',
    `<div class="avatar">AT</div>
<h1>Mi perfil</h1>
<p class="row"><span>Nombre</span><span>Ana Torres</span></p>
<p class="row"><span>Correo</span><span>ana@correo.com</span></p>
<a href="#">Editar datos</a>`,
  );

const theme = (v2) => `
body{margin:0;font:16px/1.5 system-ui,sans-serif;background:#f4f5f7;color:#1d2433}
.top{display:flex;gap:18px;padding:14px 28px;background:#1d2433;color:#fff}.top a{color:#c9d3ff;text-decoration:none}
.card{max-width:520px;margin:32px auto;background:#fff;border-radius:12px;padding:28px;box-shadow:0 2px 10px #0001}
label{display:block;margin-top:12px;font-size:14px}input{width:100%;padding:9px;border:1px solid #c8ccd4;border-radius:8px;box-sizing:border-box}
button{margin-top:18px;padding:10px 18px;border:0;border-radius:8px;background:#3b5bdb;color:#fff;font-size:15px}
.row{display:flex;justify-content:space-between;border-bottom:1px solid #eee;padding:6px 0;margin:0}.total{font-weight:700}
.avatar{width:72px;height:72px;border-radius:50%;display:grid;place-items:center;background:#dbe4ff;color:#3b5bdb;font-weight:700;font-size:24px}
${v2 ? '/* Paleta nueva para tarjetas destacadas */\n.perfil-card{background:#fff4e6;border:2px solid #f59f00}\n.perfil-card .avatar{background:#f59f00;color:#fff;border-radius:16px}\n' : ''}`;

const front = path.join(work, 'repos', 'front-web');
initRepo(front);
write(front, 'package.json', JSON.stringify({ name: 'front-web', version: '1.0.0', dependencies: { '@angular/core': '18.1.0', rxjs: '7.8.1' } }, null, 2));
write(front, 'src/app/pages/registro-cliente/registro-cliente.component.html', registro(false));
write(front, 'src/app/pages/pago/pago.component.html', pago(false));
write(front, 'src/app/pages/perfil/perfil.component.html', perfil());
write(front, 'src/app/shared/styles/theme.css', theme(false));
commit(front, 'feat: primera versión de Demo Shop', people.ana);
git(front, ['tag', 'v1.0.0']);

write(front, 'src/app/pages/registro-cliente/registro-cliente.component.html', registro(true));
commit(front, 'feat(registro): PROJ-101 agregar celular obligatorio en registro de cliente', people.ana);
write(front, 'src/app/pages/pago/pago.component.html', pago(true));
commit(front, 'fix(pago): PROJ-102 cambiar texto del botón de pago', people.carla);
write(front, 'src/app/shared/styles/theme.css', theme(true));
commit(front, 'refactor: ajustar paleta de colores de tarjetas', people.carla);
write(front, 'package.json', JSON.stringify({ name: 'front-web', version: '1.1.0', dependencies: { '@angular/core': '18.2.4', rxjs: '7.8.1' } }, null, 2));
commit(front, 'chore(deps): actualizar Angular a 18.2', people.ana);
git(front, ['tag', 'v1.1.0']);

// Sitios "desplegados" de cada versión (lo que vería el usuario).
for (const [version, v2] of [['v1.0.0', false], ['v1.1.0', true]]) {
  const site = path.join(work, 'sites', version);
  write(site, 'registro.html', registro(v2));
  write(site, 'pago.html', pago(v2));
  write(site, 'perfil.html', perfil());
  write(site, 'theme.css', theme(v2));
}

// ---------- Backend ----------
const openapi = ({ celular, estado, descuento }) => `
openapi: 3.0.3
info:
  title: Demo Shop API
  version: ${celular ? '1.1.0' : '1.0.0'}
paths:
  /api/clientes:
    post:
      summary: Registrar cliente
      requestBody:
        content:
          application/json:
            schema:
              type: object
              required: [nombres, correo${celular ? ', celular' : ''}]
              properties:
                nombres: { type: string }
                apellidos: { type: string }
                correo: { type: string }
${celular ? '                celular: { type: string }\n' : ''}      responses:
        '201':
          description: Cliente creado
          content:
            application/json:
              schema:
                type: object
                properties:
                  id: { type: string }
                  nombres: { type: string }
  /api/pagos/{id}:
    get:
      summary: Consultar pago
      parameters:
        - { name: id, in: path, required: true, schema: { type: string } }
      responses:
        '200':
          description: Pago
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Pago' }
${
  estado
    ? `  /api/pagos/{id}/estado:
    get:
      summary: Consultar estado de pago
      parameters:
        - { name: id, in: path, required: true, schema: { type: string } }
      responses:
        '200':
          description: Estado
          content:
            application/json:
              schema:
                type: object
                properties:
                  estado: { type: string, enum: [PENDIENTE, APROBADO, RECHAZADO] }
`
    : ''
}components:
  schemas:
    Pago:
      type: object
      properties:
        id: { type: string }
        subtotal: { type: number }
${descuento ? '        descuento: { type: number }\n' : ''}        total: { type: number }
        moneda: { type: string, enum: [PEN, USD] }
`;

const clientesController = (celular) => `
package com.demo.clientes;

@RestController
public class ClientesController {

    @PostMapping("/api/clientes")
    public ClienteResponse registrar(@RequestBody @Valid ClienteRequest request) {
${celular ? '        validarCelular(request.getCelular());\n' : ''}        return service.registrar(request);
    }
}
`;

const pagosController = ({ estado, cache }) => `
package com.demo.pagos;

@RestController
public class PagosController {

    @GetMapping("/api/pagos/{id}")
    public PagoResponse consultar(@PathVariable String id) {
        return service.consultar(id);
    }
${estado ? '\n    @GetMapping("/api/pagos/{id}/estado")\n    public EstadoResponse estado(@PathVariable String id) {\n        return service.estado(id);\n    }\n' : ''}${cache ? '\n    @DeleteMapping("/api/pagos/{id}/cache")\n    public void limpiarCache(@PathVariable String id) {\n        cache.evict(id);\n    }\n' : ''}}
`;

const pagoResponse = (descuento) => `
package com.demo.pagos;

public record PagoResponse(String id, BigDecimal subtotal, ${descuento ? 'BigDecimal descuento, ' : ''}BigDecimal total, String moneda) {}
`;

const back = path.join(work, 'repos', 'api-core');
initRepo(back);
write(back, 'pom.xml', '<project><artifactId>api-core</artifactId><version>1.0.0</version></project>\n');
write(back, 'openapi.yaml', openapi({ celular: false, estado: false, descuento: true }));
write(back, 'src/main/java/com/demo/clientes/ClientesController.java', clientesController(false));
write(back, 'src/main/java/com/demo/pagos/PagosController.java', pagosController({ estado: false, cache: false }));
write(back, 'src/main/java/com/demo/pagos/PagoResponse.java', pagoResponse(true));
commit(back, 'feat: primera versión de la API', people.luis);
git(back, ['tag', 'v1.0.0']);

write(back, 'openapi.yaml', openapi({ celular: true, estado: false, descuento: true }));
write(back, 'src/main/java/com/demo/clientes/ClientesController.java', clientesController(true));
commit(back, 'feat: PROJ-101 celular obligatorio en alta de cliente', people.luis);
write(back, 'openapi.yaml', openapi({ celular: true, estado: true, descuento: true }));
write(back, 'src/main/java/com/demo/pagos/PagosController.java', pagosController({ estado: true, cache: false }));
commit(back, 'feat: PROJ-103 nuevo endpoint para consultar estado de pago', people.luis);
write(back, 'openapi.yaml', openapi({ celular: true, estado: true, descuento: false }));
write(back, 'src/main/java/com/demo/pagos/PagoResponse.java', pagoResponse(false));
write(back, 'src/main/java/com/demo/pagos/PagosController.java', pagosController({ estado: true, cache: true }));
commit(back, 'refactor: PROJ-104 simplificar respuesta de pagos', people.luis);
git(back, ['tag', 'v1.1.0']);

// ---------- Configuración ----------
const siteUrl = (v) => pathToFileURL(path.join(work, 'sites', v)).href + '/';
const config = {
  title: 'Demo Shop',
  fromLabel: 'v1.0.0',
  toLabel: 'v1.1.0',
  repos: [
    { name: 'front-web', kind: 'front', source: './repos/front-web', from: 'v1.0.0', to: 'v1.1.0' },
    { name: 'api-core', kind: 'back', source: './repos/api-core', from: 'v1.0.0', to: 'v1.1.0' },
  ],
  jira: { baseUrl: 'https://tu-empresa.atlassian.net/browse/' },
  api: [{ name: 'api-core', repo: 'api-core', file: 'openapi.yaml' }],
  ui: {
    old: { baseUrl: siteUrl('v1.0.0') },
    new: { baseUrl: siteUrl('v1.1.0') },
    pages: [
      { name: 'Registro de cliente', path: 'registro.html', apis: ['/api/clientes'] },
      { name: 'Pago', path: 'pago.html', apis: ['/api/pagos'] },
      { name: 'Mi perfil', path: 'perfil.html', match: ['perfil', 'profile'] },
    ],
  },
  ai: { provider: 'prompt' },
};
write(work, 'releaselens.demo.json', JSON.stringify(config, null, 2));
console.log('✅ Demo lista: 2 repos (front-web, api-core) con versiones v1.0.0 y v1.1.0');
