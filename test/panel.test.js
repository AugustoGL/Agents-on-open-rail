// Panel del comercio: acceso, sesión, CSRF, límite de intentos y acciones sobre el agente.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';
import { arsToWei } from '../src/money.js';
import { makeAgent, slot, alice, PAYER_A, silent } from './helpers.js';

const CLAVE = 'clave-de-prueba-123';
const WED_20 = slot('2026-10-21', '20:00');
let ctx; let server; let base;

async function listen(app) {
  const s = await new Promise((resolve) => { const x = app.listen(0, '127.0.0.1', () => resolve(x)); });
  return { s, url: `http://127.0.0.1:${s.address().port}` };
}

before(async () => {
  ctx = makeAgent();
  ({ s: server, url: base } = await listen(createApp({ agent: ctx.agent, dashboardPassword: CLAVE, logger: silent, panelOptions: { maxFailuresPerIp: 100 } })));
});
after(() => new Promise((resolve) => server.close(resolve)));

const call = (path, { method = 'GET', body, cookie, csrf, headers = {}, url = base } = {}) => fetch(url + path, {
  method,
  headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...(csrf ? { 'x-csrf-token': csrf } : {}), ...headers },
  body: body ? JSON.stringify(body) : undefined,
});

async function login(url = base, clave = CLAVE) {
  const res = await call('/panel/api/login', { method: 'POST', body: { clave }, url });
  const setCookie = res.headers.getSetCookie().find((c) => c.startsWith('sena_panel='));
  const data = await res.json();
  return { res, setCookie, cookie: setCookie?.split(';')[0], csrf: data.csrf };
}

async function payBooking(booking, payer = PAYER_A) {
  ctx.chain.credit(booking.deposit_wei);
  return ctx.agent.onPaymentSettled({ bookingId: booking.id, payer, tx: `0x${'cd'.repeat(32)}${booking.id}`, amountWei: booking.deposit_wei });
}

// --- Acceso -----------------------------------------------------------------------------------

test('sin OWNER_DASHBOARD_PASSWORD el panel queda deshabilitado y lo dice', async () => {
  const { s, url } = await listen(createApp({ agent: ctx.agent, logger: silent }));
  try {
    const session = await (await call('/panel/api/session', { url })).json();
    assert.equal(session.habilitado, false);
    assert.match(session.mensaje, /OWNER_DASHBOARD_PASSWORD/);
    assert.equal((await call('/panel/api/hoy', { url })).status, 503);
    assert.equal((await call('/panel/api/login', { method: 'POST', body: { clave: 'x' }, url })).status, 503);
  } finally { await new Promise((r) => s.close(r)); }
});

test('sin sesión no se ve nada del panel', async () => {
  for (const path of ['/hoy', '/reservas', '/decisiones', '/pendientes', '/config', '/bloqueos', '/cierre', '/calendario']) {
    assert.equal((await call(`/panel/api${path}`)).status, 401, path);
  }
  assert.equal((await call('/panel/api/config', { method: 'PUT', body: { cambios: { nombre: 'x' } } })).status, 401);
  const session = await (await call('/panel/api/session')).json();
  assert.equal(session.autenticado, false);
  assert.equal(session.csrf, null);
});

test('la página del panel se sirve con política de seguridad estricta', async () => {
  const res = await call('/panel');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
  assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(await res.text(), /Panel del comercio/);
});

test('con una clave mala no entra, y con la buena sí (cookie httpOnly + SameSite=Strict)', async () => {
  assert.equal((await login(base, 'otra-clave')).res.status, 401);
  assert.equal((await login(base, '')).res.status, 401);
  const ok = await login();
  assert.equal(ok.res.status, 200);
  assert.match(ok.setCookie, /HttpOnly/);
  assert.match(ok.setCookie, /SameSite=Strict/);
  assert.match(ok.setCookie, /Path=\/panel/);
  assert.doesNotMatch(ok.setCookie, /Secure/); // en http local no
  assert.ok(ok.csrf);
  const session = await (await call('/panel/api/session', { cookie: ok.cookie })).json();
  assert.equal(session.autenticado, true);
  assert.equal(session.csrf, ok.csrf);
});

test('con https la cookie lleva Secure', async () => {
  const c = makeAgent();
  c.agent.publicBaseUrl = 'https://sena.example';
  const { s, url } = await listen(createApp({ agent: c.agent, dashboardPassword: CLAVE, logger: silent }));
  try {
    assert.match((await login(url)).setCookie, /; Secure/);
  } finally { await new Promise((r) => s.close(r)); }
});

test('una cookie inventada no sirve', async () => {
  assert.equal((await call('/panel/api/hoy', { cookie: 'sena_panel=inventada' })).status, 401);
});

test('cerrar sesión la invalida', async () => {
  const s = await login();
  assert.equal((await call('/panel/api/hoy', { cookie: s.cookie })).status, 200);
  assert.equal((await call('/panel/api/logout', { method: 'POST', body: {}, cookie: s.cookie, csrf: s.csrf })).status, 200);
  assert.equal((await call('/panel/api/hoy', { cookie: s.cookie })).status, 401);
});

test('la sesión vence', async () => {
  let now = 1_000_000;
  const c = makeAgent();
  const { s, url } = await listen(createApp({ agent: c.agent, dashboardPassword: CLAVE, logger: silent, panelOptions: { now: () => now, sessionTtlMs: 60_000 } }));
  try {
    const l = await login(url);
    assert.equal((await call('/panel/api/hoy', { cookie: l.cookie, url })).status, 200);
    now += 61_000;
    assert.equal((await call('/panel/api/hoy', { cookie: l.cookie, url })).status, 401);
  } finally { await new Promise((r) => s.close(r)); }
});

test('los intentos de ingreso están limitados (aunque después llegue la clave buena)', async () => {
  let now = 5_000_000;
  const c = makeAgent();
  const { s, url } = await listen(createApp({ agent: c.agent, dashboardPassword: CLAVE, logger: silent, panelOptions: { now: () => now, maxFailuresPerIp: 3 } }));
  try {
    for (let i = 0; i < 3; i++) assert.equal((await login(url, `mala-${i}`)).res.status, 401);
    const blocked = await login(url, CLAVE);
    assert.equal(blocked.res.status, 429);
    assert.ok(Number(blocked.res.headers.get('retry-after')) > 0);
    assert.equal(blocked.cookie, undefined);
    now += 16 * 60_000; // pasa la ventana
    assert.equal((await login(url, CLAVE)).res.status, 200);
  } finally { await new Promise((r) => s.close(r)); }
});

// --- CSRF y origen -----------------------------------------------------------------------------

test('las acciones que cambian datos piden el token CSRF', async () => {
  const s = await login();
  const body = { cambios: { nombre: 'Sin token' } };
  assert.equal((await call('/panel/api/config', { method: 'PUT', body, cookie: s.cookie })).status, 403);
  assert.equal((await call('/panel/api/config', { method: 'PUT', body, cookie: s.cookie, csrf: 'falso' })).status, 403);
  assert.equal(ctx.agent.business.nombre, 'Pádel Demo');
  for (const [method, path] of [['POST', '/bloqueos'], ['POST', '/cierre'], ['POST', '/transferencias/1/aprobar'], ['POST', '/reservas/S-AAAAAA/cancelar'], ['DELETE', '/bloqueos/1']]) {
    assert.equal((await call(`/panel/api${path}`, { method, body: {}, cookie: s.cookie })).status, 403, `${method} ${path}`);
  }
  assert.equal((await call('/panel/api/config', { method: 'PUT', body, cookie: s.cookie, csrf: s.csrf })).status, 200);
  assert.equal(ctx.agent.business.nombre, 'Sin token');
  ctx.agent.updateSettings({ nombre: 'Pádel Demo' });
});

test('un pedido que dice venir de otro sitio se rechaza', async () => {
  const s = await login();
  const res = await call('/panel/api/config', { method: 'PUT', body: { cambios: { nombre: 'X' } }, cookie: s.cookie, csrf: s.csrf, headers: { origin: 'https://sitio-malicioso.example' } });
  assert.equal(res.status, 403);
  const same = await call('/panel/api/hoy', { cookie: s.cookie, headers: { origin: base } });
  assert.equal(same.status, 200);
});

test('las respuestas del panel no se guardan en caché', async () => {
  const s = await login();
  const res = await call('/panel/api/hoy', { cookie: s.cookie });
  assert.match(res.headers.get('cache-control'), /no-store/);
});

// --- Acciones (siempre a través del agente) -------------------------------------------------------

test('hoy, calendario y reservas muestran lo que hay', async () => {
  const s = await login();
  const { booking } = ctx.agent.reserve({ resource: 'Cancha 1', startAt: WED_20, customer: { ...alice, contact: '351-555' } });
  await payBooking(booking);
  const cal = await (await call('/panel/api/calendario?fecha=2026-10-21&vista=dia', { cookie: s.cookie })).json();
  const cell = cal.dias[0].recursos.find((r) => r.nombre === 'Cancha 1').turnos.find((t) => t.hora === '20:00');
  assert.equal(cell.estado, 'confirmado');
  assert.equal(cell.reserva.cliente, 'Alicia');
  assert.equal(cal.dias[0].recursos.find((r) => r.nombre === 'Cancha 2').turnos.find((t) => t.hora === '20:00').estado, 'libre');
  const week = await (await call('/panel/api/calendario?fecha=2026-10-21&vista=semana', { cookie: s.cookie })).json();
  assert.equal(week.dias.length, 7);
  assert.equal(week.desde, '2026-10-19'); // lunes
  const list = await (await call('/panel/api/reservas?estado=confirmed&q=alic', { cookie: s.cookie })).json();
  assert.equal(list.reservas.length, 1);
  assert.equal(list.reservas[0].contacto, '351-555');
  const detail = await (await call(`/panel/api/reservas/${booking.id}`, { cookie: s.cookie })).json();
  assert.equal(detail.cancelarSegunPolitica.devolucion, '$ 6.000');
  assert.equal(detail.cancelarDevolviendoTodo.regla, 'CANCELADO_POR_COMERCIO');
  const hoy = await (await call('/panel/api/hoy', { cookie: s.cookie })).json();
  assert.equal(hoy.fecha, '2026-10-19');
  assert.equal(hoy.comprometido.senasFuturas.texto, '$ 6.000');
  const decisiones = await (await call('/panel/api/decisiones', { cookie: s.cookie })).json();
  assert.ok(decisiones.decisiones.some((d) => d.regla === 'SENA_COBRADA' && d.tx));
  // cancelar desde el panel pasa por el agente: devuelve y queda registrado
  const cancel = await call(`/panel/api/reservas/${booking.id}/cancelar`, { method: 'POST', body: { devolucion: 'politica' }, cookie: s.cookie, csrf: s.csrf });
  assert.equal(cancel.status, 200);
  assert.equal((await cancel.json()).devolucion, '$ 6.000');
  assert.equal(ctx.store.getBooking(booking.id).status, 'cancelled');
  assert.ok(ctx.store.decisions({ bookingId: booking.id }).some((d) => d.rule === 'A_TIEMPO'));
  assert.equal((await call(`/panel/api/reservas/${booking.id}/cancelar`, { method: 'POST', body: {}, cookie: s.cookie, csrf: s.csrf })).status, 409);
});

test('pendientes: aprobar y rechazar usan los métodos del agente', async () => {
  const s = await login();
  ctx.agent.updateSettings({ limites: { devolucionMaxAutomaticaArs: 1000, devolucionesMaxDiariasArs: 5000 } });
  const a = ctx.agent.reserve({ resource: 'Cancha 1', startAt: slot('2026-10-22', '17:00'), customer: alice }).booking;
  const b = ctx.agent.reserve({ resource: 'Cancha 2', startAt: slot('2026-10-22', '17:00'), customer: alice }).booking;
  await payBooking(a);
  await payBooking(b);
  await call(`/panel/api/reservas/${a.id}/cancelar`, { method: 'POST', body: { devolucion: 'total' }, cookie: s.cookie, csrf: s.csrf });
  await call(`/panel/api/reservas/${b.id}/cancelar`, { method: 'POST', body: { devolucion: 'total' }, cookie: s.cookie, csrf: s.csrf });
  const { transferencias } = await (await call('/panel/api/pendientes', { cookie: s.cookie })).json();
  const mine = transferencias.filter((t) => t.estado === 'needs_owner');
  assert.equal(mine.length, 2);
  assert.equal(mine[0].monto.texto, '$ 6.000');
  const ok = await call(`/panel/api/transferencias/${mine[0].id}/aprobar`, { method: 'POST', body: {}, cookie: s.cookie, csrf: s.csrf });
  assert.equal((await ok.json()).estado, 'sent');
  const no = await call(`/panel/api/transferencias/${mine[1].id}/rechazar`, { method: 'POST', body: {}, cookie: s.cookie, csrf: s.csrf });
  assert.equal(no.status, 200);
  assert.equal(ctx.store.getTransfer(mine[1].id).status, 'rejected');
  assert.equal((await call(`/panel/api/transferencias/${mine[0].id}/aprobar`, { method: 'POST', body: {}, cookie: s.cookie, csrf: s.csrf })).status, 409);
  ctx.agent.updateSettings({ limites: { devolucionMaxAutomaticaArs: 20000, devolucionesMaxDiariasArs: 60000 } });
});

test('configuración: valida, guarda, registra y no deja tocar lo que es solo del .env', async () => {
  const s = await login();
  const put = (cambios) => call('/panel/api/config', { method: 'PUT', body: { cambios }, cookie: s.cookie, csrf: s.csrf });
  const bad = await put({ precioTurnoArs: 3, politica: { devolucionParcialHorasAntes: 99 } });
  assert.equal(bad.status, 400);
  const errores = (await bad.json()).errores;
  assert.ok(errores.some((e) => e.campo === 'precioTurnoArs'));
  assert.ok(errores.some((e) => e.campo === 'politica.devolucionParcialHorasAntes'));
  assert.equal((await put({ payoutAddress: '0x123' })).status, 400);
  assert.equal((await put({ modo: 'live' })).status, 400);

  const good = await put({ descripcion: 'Descripción <b>nueva</b>', precioTurnoArs: '26000' });
  assert.equal(good.status, 200);
  const view = await good.json();
  assert.deepEqual(view.cambios.sort(), ['descripcion', 'precioTurnoArs']);
  assert.equal(view.config.precioTurnoArs, 26000);
  assert.ok(view.historial.some((h) => h.campo === 'precioTurnoArs' && h.antes === 24000 && h.despues === 26000 && /^panel \(/.test(h.quien)));
  const cfg = await (await call('/panel/api/config', { cookie: s.cookie })).json();
  assert.equal(cfg.config.descripcion, 'Descripción <b>nueva</b>'); // se guarda como texto; la página lo muestra escapado
  assert.equal(cfg.soloLectura.direccionDeRetiro, '0x0000…dEaD');
  ctx.agent.updateSettings({ precioTurnoArs: 24000, descripcion: 'Comercio de demostración para la hackathon Agents on Open Rails. Los turnos y precios son de ejemplo.' });
});

test('bloqueos por el panel: avisa de las reservas adentro y las cancela con devolución total', async () => {
  const s = await login();
  const { booking } = ctx.agent.reserve({ resource: 'Cancha 1', startAt: slot('2026-10-23', '20:00'), customer: alice });
  await payBooking(booking);
  const create = await call('/panel/api/bloqueos', { method: 'POST', body: { tipo: 'dia', fecha: '2026-10-23', motivo: 'Mantenimiento' }, cookie: s.cookie, csrf: s.csrf });
  assert.equal(create.status, 201);
  const { bloqueo } = await create.json();
  assert.equal(bloqueo.afectadas.length, 1);
  assert.equal(bloqueo.afectadas[0].id, booking.id);
  assert.equal((await call('/panel/api/bloqueos', { method: 'POST', body: { tipo: 'dia', fecha: 'mañana', motivo: '' }, cookie: s.cookie, csrf: s.csrf })).status, 400);
  const done = await (await call(`/panel/api/bloqueos/${bloqueo.id}/cancelar-reservas`, { method: 'POST', body: {}, cookie: s.cookie, csrf: s.csrf })).json();
  assert.equal(done.resultados[0].devolucion, '$ 6.000');
  assert.equal(ctx.store.getBooking(booking.id).status, 'cancelled');
  const { bloqueos } = await (await call('/panel/api/bloqueos', { cookie: s.cookie })).json();
  assert.equal(bloqueos.find((k) => k.id === bloqueo.id).afectadas.length, 0);
  assert.equal((await call(`/panel/api/bloqueos/${bloqueo.id}`, { method: 'DELETE', cookie: s.cookie, csrf: s.csrf })).status, 200);
});

test('cierre del día: se puede pedir y queda el último reporte', async () => {
  const s = await login();
  assert.equal((await (await call('/panel/api/cierre', { cookie: s.cookie })).json()).ultimo, null);
  const r = await call('/panel/api/cierre', { method: 'POST', body: {}, cookie: s.cookie, csrf: s.csrf });
  assert.equal(r.status, 200);
  assert.match((await r.json()).reporte, /Cierre del 2026-10-19/);
  const { ultimo } = await (await call('/panel/api/cierre', { cookie: s.cookie })).json();
  assert.match(ultimo.reporte, /Pádel Demo/);
});

test('el dinero de cancelar por el panel sale del agente, con tag y registro (no de la ruta)', async () => {
  const s = await login();
  const { booking } = ctx.agent.reserve({ resource: 'Cancha 1', startAt: slot('2026-10-24', '20:00'), customer: alice });
  await payBooking(booking);
  const before = ctx.chain.sent?.length ?? 0;
  await call(`/panel/api/reservas/${booking.id}/cancelar`, { method: 'POST', body: { devolucion: 'total' }, cookie: s.cookie, csrf: s.csrf });
  const t = ctx.store.transfersByStatus('sent').find((x) => x.booking_id === booking.id);
  assert.equal(BigInt(t.amount_wei), arsToWei(6000));
  assert.ok(t.tx);
  assert.ok((ctx.chain.sent?.length ?? 0) >= before);
});
