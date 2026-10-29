// Interfaz: datos públicos del agente, datos de demostración y cobertura del registro de decisiones.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDb } from '../src/db.js';
import { sembrar } from '../scripts/seed-lib.mjs';
import { createApp } from '../src/server.js';
import { SenaAgent } from '../src/agent.js';
import { createMockChain } from '../src/chain.js';
import { BusinessSettings } from '../src/settings.js';
import { loadBusiness } from '../src/config.js';
import { silent } from './helpers.js';

let store; let server; let base; let resumen;
before(async () => {
  store = openDb(':memory:');
  resumen = await sembrar({ store });
  const business = new BusinessSettings(store).loadOrSeed(() => loadBusiness());
  const agent = new SenaAgent({ store, business, chain: createMockChain({ logger: silent }), logger: silent });
  const app = createApp({ agent, logger: silent, dashboardPassword: 'clave-de-prueba-123' });
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((resolve) => server.close(resolve)));

test('los datos de demostración cubren todos los estados, un pendiente y bloqueos', () => {
  for (const estado of ['held', 'confirmed', 'cancelled', 'expired', 'completed']) assert.ok(resumen.estados[estado] > 0, `falta el estado ${estado}`);
  assert.ok(resumen.pendientes >= 1);
  assert.ok(resumen.bloqueos >= 3);
  assert.ok(resumen.decisiones >= 50);
  const reglas = Object.keys(store.decisionCounts());
  for (const r of ['SENA_COBRADA', 'A_TIEMPO', 'TARDE_PARCIAL', 'MUY_TARDE', 'REVENTA', 'RESERVA_VENCIDA', 'ANOTADO', 'OFERTA_LISTA_ESPERA', 'ESPERA_DUENO', 'APROBADA_POR_DUENO', 'RECHAZADA_POR_DUENO', 'CANCELADO_POR_COMERCIO', 'BLOQUEO_CREADO', 'CONFIGURACION_CAMBIADA', 'JUGADO', 'RETIRO']) {
    assert.ok(reglas.includes(r), `falta la decisión ${r}`);
  }
});

test('la configuración queda igual después de la demostración (los cambios de la semilla se revierten)', () => {
  const b = new BusinessSettings(store).loadOrSeed(() => loadBusiness());
  assert.equal(b.politica.ofertaListaEsperaMinutos, 30);
  assert.equal(b.limites.devolucionMaxAutomaticaArs, 20000);
});

test('la semilla se niega a correr fuera del modo prueba y sobre la base real', () => {
  const run = (env) => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'scripts/seed.mjs'], { cwd: fileURLToPath(new URL('..', import.meta.url)), env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' });
  const live = run({ MODE: 'live', DB_PATH: ':memory:' });
  assert.equal(live.status, 1);
  assert.match(live.stderr, /Solo funciona en MODE=mock/);
  const real = run({ MODE: 'mock', DB_PATH: 'data/sena.db' });
  assert.equal(real.status, 1);
  assert.match(real.stderr, /base del modo real/);
});

test('/api/resumen-publico trae solo totales', async () => {
  const r = await (await fetch(`${base}/api/resumen-publico`)).json();
  assert.equal(r.decisiones, resumen.decisiones);
  assert.ok(r.senasCobradas >= 10);
  assert.ok(r.cancelaciones >= 5);
  assert.match(r.montoDevuelto, /^\$ \d/);
  assert.ok(r.turnosReubicados >= 1);
  assert.ok(r.reservasLiberadas >= 1);
  assert.deepEqual(Object.keys(r).sort(), ['cancelaciones', 'decisiones', 'desde', 'devolucionesEnviadas', 'montoDevuelto', 'reservasLiberadas', 'senasCobradas', 'turnosReubicados']);
});

test('/api/decisiones trae datos legibles y nada personal', async () => {
  const { decisiones } = await (await fetch(`${base}/api/decisiones?limit=200`)).json();
  const texto = JSON.stringify(decisiones);
  for (const nombre of ['Marta G.', 'Beto P.', 'Luli R.', 'Nico S.', 'Ceci T.', 'Fede A.', 'Juani C.']) assert.ok(!texto.includes(nombre), `aparece ${nombre}`);
  assert.ok(!/0x[a-fA-F0-9]{40}(?![a-fA-F0-9])/.test(texto), 'hay una billetera entera');
  assert.ok(!/@ejemplo\.com|351 555/.test(texto), 'hay un contacto');
  const tarde = decisiones.find((d) => d.regla === 'MUY_TARDE');
  assert.equal(typeof tarde.datos.horasAntes, 'number');
  assert.ok(tarde.datos.horasAntes < 6);
  const cobro = decisiones.find((d) => d.regla === 'SENA_COBRADA');
  assert.equal(cobro.datos.monto, '$ 6,000');
  assert.ok(decisiones.every((d) => typeof d.datos === 'object'));
  const cancelaPorComercio = decisiones.find((d) => d.regla === 'CANCELADO_POR_COMERCIO');
  assert.equal(cancelaPorComercio.datos.cancelaElComercio, true);
});

test('cada regla que emite el agente tiene título y explicación en el registro de decisiones', () => {
  const vista = readFileSync(new URL('../public/decisiones-vista.js', import.meta.url), 'utf8');
  const conocidas = new Set([...vista.matchAll(/^ {2}([A-Z_]+): \{/gm)].map((m) => m[1]));
  const emitidas = Object.keys(store.decisionCounts());
  const faltan = emitidas.filter((r) => !conocidas.has(r));
  assert.deepEqual(faltan, []);
  // Y también las que no aparecen en la demostración pero existen en el código.
  const codigo = ['agent.js', 'policy.js'].map((f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8')).join('\n');
  const enCodigo = new Set([...codigo.matchAll(/rule(?::|\s*=)\s*(?:[^'"\n]*\?\s*)?'([A-Z_]{4,})'/g)].map((m) => m[1]));
  for (const r of enCodigo) assert.ok(conocidas.has(r) || ['SIN_RETIRO'].includes(r) || r.length < 4, `la regla ${r} no tiene título en el registro`);
});

test('el panel y el registro público usan el sistema de diseño', async () => {
  for (const [path, re] of [['/decisiones', /What the agent decides/], ['/panel', /Venue dashboard/]]) {
    const html = await (await fetch(base + path)).text();
    assert.match(html, re);
    assert.match(html, /\/static\/css\/sena\.css/);
    assert.doesNotMatch(html, /estilo\.css/);
    assert.doesNotMatch(html, /<script(?![^>]*src=)|\son\w+=|<style|\sstyle=/);
  }
});
