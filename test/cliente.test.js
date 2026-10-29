// Flujo del cliente: rutas que usa la interfaz nueva (pago de prueba, datos del negocio, páginas).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createApp } from '../src/server.js';
import { createPaymentServer, MockFacilitator } from '../src/x402.js';
import { makeAgent, silent } from './helpers.js';

let ctx; let server; let base; let facilitator;
before(async () => {
  ctx = makeAgent();
  facilitator = new MockFacilitator({ chain: ctx.chain, logger: silent });
  const payments = createPaymentServer({ agent: ctx.agent, facilitator, payTo: ctx.chain.address, builderCode: null, logger: silent });
  const app = createApp({ agent: ctx.agent, payments, logger: silent, createLimit: { windowMs: 60_000, max: 500 } });
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  ctx.agent.publicBaseUrl = base;
});
after(() => new Promise((resolve) => server.close(resolve)));

const post = async (path, body) => { const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) }); return { status: r.status, body: await r.json() }; };
const reservar = (hora, fecha = '2026-10-21', recurso = 'Court 1') => post('/api/reservas', { recurso, fecha, hora, cliente: { nombre: 'Marta', canal: 'web' } });

test('/api/negocio trae lo que necesita la pantalla: hoy, modo prueba, tiempos y política', async () => {
  const n = await (await fetch(`${base}/api/negocio`)).json();
  assert.equal(n.hoy, '2026-10-19');
  assert.equal(n.modoPrueba, true);
  assert.equal(n.listaEsperaMinutos, 30);
  assert.equal(n.reservaSinPagarMinutos, 15);
  assert.equal(n.esDemostracion, true);
  assert.ok(n.politica.length >= 3);
});

test('pago de prueba (solo MODO PRUEBA): paga por el mismo camino x402 y confirma el turno', async () => {
  const r = await reservar('17:00');
  const id = r.body.reserva.id;
  const before = facilitator.settled.length;
  const paid = await post(`/api/modo-prueba/pagar/${id}`);
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  assert.match(paid.body.tx, /^0x[0-9a-f]{64}$/);
  assert.equal(facilitator.settled.length, before + 1); // pasó por el facilitador, con firma Permit2 verificada
  assert.equal(ctx.store.getBooking(id).status, 'confirmed');
  assert.match(ctx.store.getBooking(id).payer, /^0x[0-9a-fA-F]{40}$/);
  // Una reserva ya pagada, inexistente o vencida no se paga de nuevo.
  assert.equal((await post(`/api/modo-prueba/pagar/${id}`)).status, 409);
  assert.equal((await post('/api/modo-prueba/pagar/S-NOEXIS')).status, 404);
  const v = await reservar('18:30');
  ctx.clock.advance(16 * 60_000);
  await ctx.agent.expireHolds();
  assert.equal((await post(`/api/modo-prueba/pagar/${v.body.reserva.id}`)).status, 410);
  ctx.clock.advance(-16 * 60_000);
});

test('con la cadena real el pago de prueba ni existe', async () => {
  const c = makeAgent();
  c.agent.chain = { ...c.chain, mode: 'live' };
  const app = createApp({ agent: c.agent, logger: silent });
  const s = await new Promise((resolve) => { const x = app.listen(0, '127.0.0.1', () => resolve(x)); });
  try {
    const res = await fetch(`http://127.0.0.1:${s.address().port}/api/modo-prueba/pagar/S-AAAAAA`, { method: 'POST' });
    assert.equal(res.status, 404);
    assert.equal((await (await fetch(`http://127.0.0.1:${s.address().port}/api/negocio`)).json()).modoPrueba, false);
  } finally { await new Promise((r) => s.close(r)); }
});

test('el Date del servidor llega a la página (la cuenta regresiva usa la hora del servidor)', async () => {
  const res = await fetch(`${base}/api/negocio`);
  assert.ok(Number.isFinite(Date.parse(res.headers.get('date'))));
});

test('las páginas del cliente usan el sistema de diseño y la política de seguridad estricta', async () => {
  for (const [path, re] of [['/', /Book your slot/], ['/pagar/S-AAAAAA', /Pay the deposit/]]) {
    const res = await fetch(base + path);
    assert.equal(res.status, 200, path);
    const html = await res.text();
    assert.match(html, re);
    assert.match(html, /\/static\/css\/sena\.css/);
    assert.doesNotMatch(html, /<script(?![^>]*src=)|\son\w+=|<style|\sstyle=/);
  }
  assert.equal((await fetch(`${base}/static/favicon.svg`)).status, 200);
  assert.equal((await fetch(`${base}/static/pay.bundle.js`)).status, 200);
  assert.equal((await fetch(`${base}/guia-estilos`)).status, 200);
});

test('toda clase que usan las páginas del cliente existe en sena.css', () => {
  const css = readFileSync(new URL('../public/css/sena.css', import.meta.url), 'utf8');
  const fuentes = ['index.html', 'pagar.html', 'reservar.js', 'dom.js'].map((f) => readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8'))
    .concat(readFileSync(new URL('../web/pay.js', import.meta.url), 'utf8'));
  const usadas = new Set();
  for (const src of fuentes) {
    for (const m of src.matchAll(/class(?:=|:\s*)['"`]([^'"`]+)['"`]/g)) for (const c of m[1].split(/\s+/)) if (/^[a-z][a-z0-9-]*$/.test(c)) usadas.add(c);
  }
  const faltan = [...usadas].filter((c) => !new RegExp(`\\.${c}(?![a-z0-9-])`).test(css));
  // "opcional" es un texto dentro de una etiqueta.
  assert.deepEqual(faltan.filter((c) => c !== 'opcional'), []);
});
