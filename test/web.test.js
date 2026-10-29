// Reserva web: reservar -> pagar (x402 con el facilitador simulado) -> cancelar, "Mis reservas", lista de espera
// y las páginas públicas. Usa las mismas rutas que el bot y la API: las reglas son las mismas.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createApp, maskAddresses } from '../src/server.js';
import { createPaymentServer, MockFacilitator } from '../src/x402.js';
import { createPayingFetch } from '../src/buyer.js';
import { arsToWei } from '../src/money.js';
import { makeAgent, slot, silent } from './helpers.js';

let ctx; let httpServer; let base; let facilitator;

before(async () => {
  ctx = makeAgent();
  facilitator = new MockFacilitator({ chain: ctx.chain, logger: silent });
  const payments = createPaymentServer({ agent: ctx.agent, facilitator, payTo: ctx.chain.address, builderCode: null, logger: silent });
  const app = createApp({ agent: ctx.agent, payments, logger: silent, createLimit: { windowMs: 60_000, max: 200 } });
  await new Promise((resolve) => { httpServer = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${httpServer.address().port}`;
  ctx.agent.publicBaseUrl = base;
});
after(() => new Promise((resolve) => httpServer.close(resolve)));

const post = async (path, body) => { const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) }); return { status: r.status, body: await r.json() }; };
const get = async (path) => { const r = await fetch(base + path); return { status: r.status, body: await r.json() }; };
const mine = (token) => post('/api/mis-reservas', { clienteToken: token }).then((r) => r.body);
const buyer = () => createPayingFetch({ signer: privateKeyToAccount(generatePrivateKey()), maxPerPaymentWei: arsToWei(10000) });
const reservar = (hora, { fecha = '2026-10-21', recurso = 'Court 1', cliente = {} } = {}) => post('/api/reservas', { recurso, fecha, hora, cliente: { nombre: 'Marta', canal: 'web', ...cliente } });

test('flujo web: reservar -> pagar -> ver en Mis reservas -> cancelar con vista previa', async () => {
  const r = await reservar('17:00', { cliente: { contacto: '351 555-1234' } });
  assert.equal(r.status, 201);
  const { clienteToken, reserva } = r.body;
  assert.match(clienteToken, /^api:[a-f0-9]{32}$/);
  assert.match(reserva.id, /^S-[A-Z0-9]{6}$/);
  assert.equal(ctx.store.getBooking(reserva.id).channel, 'web');
  assert.equal(ctx.store.getCustomer(clienteToken).contact, '351 555-1234');
  assert.equal(JSON.parse(ctx.store.getBooking(reserva.id).terms).politica.devolucionTotalHorasAntes, 24);

  let m = await mine(clienteToken);
  assert.equal(m.reservas.length, 1);
  assert.equal(m.reservas[0].estado, 'held');

  const paid = await buyer()(`${base}/api/reservas/${reserva.id}/pagar`, { method: 'POST' });
  assert.equal(paid.status, 200, await paid.clone().text());
  m = await mine(clienteToken);
  assert.equal(m.reservas[0].estado, 'confirmed');
  assert.equal(facilitator.settled.length, 1);

  // Antes de cancelar: cuánto devuelve y por qué (sin cancelar nada).
  const vista = await post(`/api/reservas/${reserva.id}/cancelar-vista`, { clienteToken });
  assert.equal(vista.status, 200);
  assert.equal(vista.body.devolucion, '$ 6,000');
  assert.equal(vista.body.regla, 'A_TIEMPO');
  assert.match(vista.body.motivo, /whole deposit/);
  assert.equal(ctx.store.getBooking(reserva.id).status, 'confirmed');

  const cancel = await post(`/api/reservas/${reserva.id}/cancelar`, { clienteToken });
  assert.equal(cancel.status, 200);
  assert.equal(cancel.body.devolucion, '$ 6,000');
  m = await mine(clienteToken);
  assert.equal(m.reservas[0].estado, 'cancelled');
  assert.equal(m.reservas[0].devuelto.texto, '$ 6,000');
  assert.ok(ctx.store.transfersByStatus('sent').some((t) => t.booking_id === reserva.id));
});

test('el token es la llave: otro token no ve ni cancela reservas ajenas, y un token mal formado se rechaza', async () => {
  const a = await reservar('18:30');
  const otro = `api:${'0'.repeat(32)}`;
  assert.deepEqual((await mine(otro)).reservas, []);
  assert.equal((await post(`/api/reservas/${a.body.reserva.id}/cancelar`, { clienteToken: otro })).status, 409);
  assert.equal((await post(`/api/reservas/${a.body.reserva.id}/cancelar-vista`, { clienteToken: otro })).status, 409);
  assert.equal((await post('/api/mis-reservas', { clienteToken: 'api:corto' })).status, 400);
  assert.equal((await post('/api/mis-reservas', {})).status, 400);
  await post(`/api/reservas/${a.body.reserva.id}/cancelar`, { clienteToken: a.body.clienteToken });
});

test('lista de espera desde la web: el turno liberado le aparece en Mis reservas con link de pago', async () => {
  const first = await reservar('20:00', { cliente: { nombre: 'Primera' } });
  await buyer()(`${base}/api/reservas/${first.body.reserva.id}/pagar`, { method: 'POST' });
  const second = await reservar('20:00', { cliente: { nombre: 'Segunda' } });
  assert.equal(second.status, 409);
  assert.equal(second.body.codigo, 'ocupado');

  const w = await post('/api/lista-espera', { recurso: 'Court 1', fecha: '2026-10-21', hora: '20:00', cliente: { nombre: 'Segunda', canal: 'web' } });
  assert.equal(w.status, 200);
  assert.equal(w.body.puesto, 1);
  const token = w.body.clienteToken;
  assert.match(token, /^api:[a-f0-9]{32}$/);
  assert.equal((await mine(token)).esperas[0].puesto, 1);
  // Anotarse de nuevo no la duplica; un turno libre no tiene lista.
  assert.equal((await post('/api/lista-espera', { recurso: 'Court 1', fecha: '2026-10-21', hora: '20:00', cliente: { token } })).body.puesto, 1);
  assert.equal((await post('/api/lista-espera', { recurso: 'Court 2', fecha: '2026-10-21', hora: '20:00', cliente: { token } })).status, 409);

  await post(`/api/reservas/${first.body.reserva.id}/cancelar`, { clienteToken: first.body.clienteToken });
  const after = await mine(token);
  const offer = after.reservas.find((b) => b.estado === 'held');
  assert.ok(offer, 'le ofrecieron el turno');
  assert.equal(offer.origen, 'lista_espera');
  assert.equal(offer.paginaDePago, `${base}/pagar/${offer.id}`);
  assert.equal(after.esperas[0].estado, 'offered');
  const paid = await buyer()(`${base}/api/reservas/${offer.id}/pagar`, { method: 'POST' });
  assert.equal(paid.status, 200);
  assert.equal((await mine(token)).reservas.find((b) => b.id === offer.id).estado, 'confirmed');
});

test('turnos: se ve qué está libre, ocupado o bloqueado y no se reserva lo bloqueado', async () => {
  ctx.agent.createBlock({ tipo: 'turno', recurso: 'Court 2', fecha: '2026-10-22', hora: '12:00', motivo: 'Clase de pádel' });
  const t = await get('/api/turnos?fecha=2026-10-22&libres=no');
  const cell = t.body.turnos.find((x) => x.recurso === 'Court 2' && x.hora === '12:00');
  assert.equal(cell.estado, 'bloqueado');
  assert.equal(cell.motivo, 'Clase de pádel');
  assert.equal(cell.libre, false);
  assert.equal(t.body.turnos.find((x) => x.recurso === 'Court 1' && x.hora === '12:00').estado, 'libre');
  assert.ok(!(await get('/api/turnos?fecha=2026-10-22')).body.turnos.some((x) => x.recurso === 'Court 2' && x.hora === '12:00'));
  const r = await reservar('12:00', { fecha: '2026-10-22', recurso: 'Court 2' });
  assert.equal(r.status, 409);
  assert.equal(r.body.codigo, 'bloqueado');
  assert.match(r.body.error, /Clase de pádel/);
});

test('los cambios de configuración se ven en lo público y una reserva nueva toma el precio nuevo', async () => {
  const before = (await get('/api/negocio')).body;
  assert.equal(before.sena, '$ 6,000');
  assert.equal(before.modoPrueba, true); // la cadena de las pruebas es simulada
  ctx.agent.updateSettings({ precioTurnoArs: 30000, reservaSinPagarMinutos: 20 });
  const after = (await get('/api/negocio')).body;
  assert.equal(after.sena, '$ 7,500');
  assert.equal(after.reservaSinPagarMinutos, 20);
  const r = await reservar('09:00', { fecha: '2026-10-23' });
  assert.equal(r.body.reserva.sena.texto, '$ 7,500');
  ctx.agent.updateSettings({ precioTurnoArs: 24000, reservaSinPagarMinutos: 15 });
  await post(`/api/reservas/${r.body.reserva.id}/cancelar`, { clienteToken: r.body.clienteToken });
});

test('el nombre y el contacto se limpian y el registro público no muestra datos personales', async () => {
  const r = await reservar('10:30', { fecha: '2026-10-23', cliente: { nombre: '  Ana\u0000 \n <b>Gómez</b>  ', contacto: 'x'.repeat(200) } });
  assert.equal(r.status, 201);
  const c = ctx.store.getCustomer(r.body.clienteToken);
  assert.equal(c.name, 'Ana <b>Gómez</b>'); // sin control; el HTML se escapa al mostrar, nunca se interpreta
  assert.equal(c.contact.length, 80);
  const { body } = await get('/api/decisiones?limit=200');
  const texto = JSON.stringify(body);
  assert.ok(!texto.includes('Gómez') && !texto.includes('Marta'));
  assert.ok(!/0x[a-fA-F0-9]{40}(?![a-fA-F0-9])/.test(body.decisiones.map((d) => d.motivo).join(' ')), 'las wallets salen abreviadas');
  assert.ok(body.decisiones.some((d) => /0x[a-fA-F0-9]{4}…[a-fA-F0-9]{4}/.test(d.motivo)));
  await post(`/api/reservas/${r.body.reserva.id}/cancelar`, { clienteToken: r.body.clienteToken });
});

test('maskAddresses abrevia wallets pero deja los hashes de transacción', () => {
  const addr = '0x1111111111111111111111111111111111111111';
  const tx = `0x${'ab'.repeat(32)}`;
  assert.equal(maskAddresses(`a ${addr} b`), 'a 0x1111…1111 b');
  assert.equal(maskAddresses(tx), tx);
});

test('límite de reservas por IP en las rutas que crean cosas', async () => {
  const c = makeAgent();
  const app = createApp({ agent: c.agent, logger: silent, createLimit: { windowMs: 60_000, max: 3 } });
  const s = await new Promise((resolve) => { const x = app.listen(0, '127.0.0.1', () => resolve(x)); });
  try {
    const url = `http://127.0.0.1:${s.address().port}/api/reservas`;
    const go = () => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ recurso: 'Court 1', fecha: '2026-10-21', hora: '20:00' }) });
    for (let i = 0; i < 3; i++) assert.notEqual((await go()).status, 429);
    const blocked = await go();
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  } finally { await new Promise((r) => s.close(r)); }
});

test('un JSON roto responde 400 y no 500', async () => {
  const res = await fetch(`${base}/api/reservas`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{roto' });
  assert.equal(res.status, 400);
});

// --- Páginas ------------------------------------------------------------------------------------

test('la web, el registro público y los archivos de la página se sirven', async () => {
  for (const [path, re] of [['/', /Book your slot/], ['/decisiones', /What the agent decides/], ['/panel', /Venue dashboard/]]) {
    const res = await fetch(base + path);
    assert.equal(res.status, 200, path);
    assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
    assert.match(await res.text(), re);
  }
  for (const f of ['dom.js', 'reservar.js', 'decisiones.js', 'decisiones-vista.js', 'panel.js', 'css/sena.css']) assert.equal((await fetch(`${base}/static/${f}`)).status, 200, f);
});

test('el frontend nunca arma HTML con datos: sin innerHTML, outerHTML, insertAdjacentHTML ni document.write', () => {
  const dir = new URL('../public/', import.meta.url);
  const files = [...readdirSync(dir).filter((f) => f.endsWith('.js') && f !== 'pay.bundle.js').map((f) => new URL(f, dir)), new URL('../web/pay.js', import.meta.url)];
  assert.ok(files.length >= 5);
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    assert.doesNotMatch(src, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/, f.pathname);
  }
  // Y las páginas no traen scripts ni estilos en línea (la política de seguridad los bloquearía).
  for (const page of ['index.html', 'decisiones.html', 'panel.html']) {
    const html = readFileSync(new URL(page, dir), 'utf8');
    assert.doesNotMatch(html, /<script(?![^>]*src=)|\son\w+=|<style|style=/, page);
  }
});
