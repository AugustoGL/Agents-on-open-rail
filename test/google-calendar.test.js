// Seña con el calendario de Google del comercio como agenda. Todo con un Google falso en memoria: sin red.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { arsToWei } from '../src/money.js';
import { AgendaError, LocalAgenda, eventBlocksResource, eventIdFor } from '../src/agenda.js';
import { GoogleCalendarAgenda } from '../src/google-calendar.js';
import { AGENDA_DOWN_MESSAGE } from '../src/agent.js';
import { createApp } from '../src/server.js';
import { createPaymentServer, MockFacilitator } from '../src/x402.js';
import { createPayingFetch } from '../src/buyer.js';
import { FakeGoogle, CALENDAR_ID, makeServiceAccount } from './fake-google.js';
import { makeAgent, slot, silent, alice, bob, PAYER_A, HOUR } from './helpers.js';

const { publicKey, serviceAccount } = makeServiceAccount();
const WED_20 = slot('2026-10-21', '20:00'); // miércoles 20:00 (hora de Córdoba)
const WED_2130 = slot('2026-10-21', '21:30');
const DURATION = 90 * 60_000;

/** Un agente con un Google falso como agenda. */
function setup(fakeOpts = {}) {
  const google = new FakeGoogle({ publicKey, ...fakeOpts });
  const agenda = new GoogleCalendarAgenda({ serviceAccount, calendarId: CALENDAR_ID, utcOffsetMinutes: -180, fetch: google.fetch });
  const ctx = makeAgent({ agenda });
  return { ...ctx, google, agenda };
}

async function pay(ctx, booking, payer = PAYER_A, tx = `0x${'ab'.repeat(32)}${booking.id}`) {
  ctx.chain.credit(booking.deposit_wei);
  return ctx.agent.onPaymentSettled({ bookingId: booking.id, payer, tx, amountWei: booking.deposit_wei });
}

// --- Modo por defecto ------------------------------------------------------------------------

test('sin Google, la agenda es la grilla propia y todo sigue igual', async () => {
  const { agent } = makeAgent();
  assert.ok(agent.agenda instanceof LocalAgenda);
  assert.equal(agent.agenda.external, false);
  assert.deepEqual(await agent.listSlotsChecked({ dateStr: '2026-10-21' }), agent.listSlots({ dateStr: '2026-10-21' }));
  const r = await agent.reserveChecked({ resource: 'Cancha 1', startAt: WED_20, customer: alice });
  assert.ok(r.ok);
  assert.equal((await agent.checkAgendaForPayment(r.booking)).ok, true);
});

// --- Cliente de Google ------------------------------------------------------------------------

test('se autentica con la cuenta de servicio (JWT firmado) y reutiliza el token', async () => {
  const { agent, google } = setup();
  await agent.listSlotsChecked({ dateStr: '2026-10-21' });
  await agent.listSlotsChecked({ dateStr: '2026-10-22' });
  assert.equal(google.tokenRequests, 1);
  assert.equal(google.count('GET', '/events'), 2);
});

test('una cuenta de servicio con otra clave no entra', async () => {
  const google = new FakeGoogle({ publicKey: makeServiceAccount().publicKey });
  const agenda = new GoogleCalendarAgenda({ serviceAccount, calendarId: CALENDAR_ID, utcOffsetMinutes: -180, fetch: google.fetch });
  await assert.rejects(agenda.events({ fromMs: 0, toMs: 1 }), AgendaError);
});

test('lee todas las páginas de eventos', async () => {
  const { agenda, google } = setup({ pageSize: 2 });
  for (let i = 0; i < 5; i++) google.addEvent({ summary: `Evento ${i}`, startMs: WED_20 + i * HOUR * 24, endMs: WED_20 + i * HOUR * 24 + HOUR });
  const events = await agenda.events({ fromMs: WED_20 - HOUR, toMs: WED_20 + 10 * HOUR * 24 });
  assert.equal(events.length, 5);
});

test('lee la cuenta de servicio de un archivo y avisa claro si no existe', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sena-test-'));
  try {
    const file = join(dir, 'cuenta.json');
    writeFileSync(file, JSON.stringify(serviceAccount));
    assert.ok(GoogleCalendarAgenda.fromFile(file, { calendarId: CALENDAR_ID, utcOffsetMinutes: -180 }).external);
    assert.throws(() => GoogleCalendarAgenda.fromFile(join(dir, 'no-existe.json'), { calendarId: CALENDAR_ID, utcOffsetMinutes: -180 }), /No pude leer la cuenta de servicio/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Horarios libres ---------------------------------------------------------------------------

test('los horarios libres respetan los eventos que ya tiene el calendario', async () => {
  const { agent, google } = setup();
  google.addEvent({ summary: 'Cancha 1 - Pérez', startMs: WED_20, endMs: WED_20 + DURATION });
  google.addEvent({ summary: 'Torneo de la empresa', startMs: WED_2130, endMs: WED_2130 + DURATION }); // no nombra cancha: ocupa todas
  google.addEvent({ summary: 'Cancha 2 mantenimiento', startMs: slot('2026-10-21', '09:00'), endMs: slot('2026-10-21', '09:00') + DURATION, transparency: 'transparent' }); // "libre": no bloquea
  google.addEvent({ summary: 'Cancha 2 - cancelado', startMs: slot('2026-10-21', '12:00'), endMs: slot('2026-10-21', '12:00') + DURATION, status: 'cancelled' });

  const slots = await agent.listSlotsChecked({ dateStr: '2026-10-21' });
  const at = (resource, startAt) => slots.find((s) => s.resource === resource && s.startAt === startAt);
  assert.equal(at('Cancha 1', WED_20).free, false);
  assert.equal(at('Cancha 1', WED_20).agendaBusy, true);
  assert.equal(at('Cancha 2', WED_20).free, true);
  assert.equal(at('Cancha 1', WED_2130).free, false);
  assert.equal(at('Cancha 2', WED_2130).free, false);
  assert.equal(at('Cancha 2', slot('2026-10-21', '09:00')).free, true);
  assert.equal(at('Cancha 2', slot('2026-10-21', '12:00')).free, true);
  assert.equal((await agent.listSlotsChecked({ dateStr: '2026-10-21', onlyFree: true })).length, 14 - 3);
});

test('un evento de día completo ocupa el día entero', async () => {
  const { agent, google } = setup();
  google.addAllDay({ summary: 'Feriado', date: '2026-10-22', endDate: '2026-10-23' });
  assert.equal((await agent.listSlotsChecked({ dateStr: '2026-10-22', onlyFree: true })).length, 0);
  assert.equal((await agent.listSlotsChecked({ dateStr: '2026-10-23', onlyFree: true })).length, 14);
});

test('"Cancha 1" no se confunde con "Cancha 10"', () => {
  const todas = ['Cancha 1', 'Cancha 10'];
  assert.equal(eventBlocksResource('Cancha 10 - Gómez', 'Cancha 1', todas), false);
  assert.equal(eventBlocksResource('cancha  1 – Gómez', 'Cancha 1', todas), true);
  assert.equal(eventBlocksResource('Reunión', 'Cancha 10', todas), true);
});

// --- Doble reserva -----------------------------------------------------------------------------

test('no deja reservar un turno que el comercio ya ocupó en el calendario', async () => {
  const { agent, google, store } = setup();
  google.addEvent({ summary: 'Cancha 1 - Pérez', startMs: WED_20, endMs: WED_20 + DURATION });
  const r = await agent.reserveChecked({ resource: 'Cancha 1', startAt: WED_20, customer: alice });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'ocupado_agenda');
  assert.equal(store.activeBookingForSlot('Cancha 1', WED_20), null);
  assert.ok((await agent.reserveChecked({ resource: 'Cancha 2', startAt: WED_20, customer: alice })).ok);
});

test('dos personas no pueden reservar el mismo turno', async () => {
  const { agent } = setup();
  assert.ok((await agent.reserveChecked({ resource: 'Cancha 1', startAt: WED_20, customer: alice })).ok);
  const second = await agent.reserveChecked({ resource: 'Cancha 1', startAt: WED_20, customer: bob });
  assert.equal(second.ok, false);
  assert.equal(second.code, 'ocupado');
});

test('si el comercio ocupa el turno mientras se paga, no se cobra', async () => {
  const { agent, google } = setup();
  const { booking } = await agent.reserveChecked({ resource: 'Cancha 1', startAt: WED_20, customer: alice });
  assert.equal((await agent.checkAgendaForPayment(booking)).ok, true);
  google.addEvent({ summary: 'Cancha 1 - llegó un cliente al mostrador', startMs: WED_20, endMs: WED_20 + DURATION });
  const check = await agent.checkAgendaForPayment(booking);
  assert.equal(check.ok, false);
  assert.equal(check.status, 409);
  assert.equal(check.code, 'ocupado_agenda');
});

// --- Confirmar y cancelar ----------------------------------------------------------------------

test('al pagar se crea el evento con el id de la reserva y queda confirmada', async () => {
  const ctx = setup();
  const { booking } = await ctx.agent.reserveChecked({ resource: 'Cancha 1', startAt: WED_20, customer: alice });
  assert.equal(ctx.google.live().length, 0, 'mientras no se paga no hay evento');
  const r = await pay(ctx, booking);
  assert.equal(r.kind, 'confirmado');
  assert.equal(ctx.store.getBooking(booking.id).status, 'confirmed');

  const [ev] = ctx.google.live();
  assert.equal(ev.id, eventIdFor(booking.id));
  assert.match(ev.id, /^[a-v0-9]{5,}$/, 'el id cumple lo que exige Google');
  assert.equal(ev.extendedProperties.private.senaBookingId, booking.id);
  assert.match(ev.summary, /Cancha 1/);
  assert.match(ev.description, new RegExp(booking.id));
  assert.equal(Date.parse(ev.start.dateTime), WED_20);
  assert.equal(Date.parse(ev.end.dateTime), WED_20 + DURATION);

  // Y el turno ya aparece ocupado en el calendario, también para otro cliente.
  assert.equal((await ctx.agent.reserveChecked({ resource: 'Cancha 1', startAt: WED_20, customer: bob })).ok, false);
});

test('un aviso de pago repetido no duplica el evento ni la reserva', async () => {
  const ctx = setup();
  const { booking } = await ctx.agent.reserveChecked({ resource: 'Cancha 1', startAt: WED_20, customer: alice });
  const tx = `0x${'cd'.repeat(32)}`;
  await pay(ctx, booking, PAYER_A, tx);
  assert.equal((await pay(ctx, booking, PAYER_A, tx)).kind, 'repetido');
  assert.equal(ctx.google.count('POST', '/events'), 1);
  assert.equal(ctx.google.live().length, 1);
  // Y crear el evento de nuevo a mano (por ejemplo tras un reintento) tampoco falla ni duplica.
  await ctx.agenda.confirm(booking, ctx.agent.eventFor(booking));
  assert.equal(ctx.google.live().length, 1);
});

test('cancelar a tiempo devuelve la seña y borra el evento del calendario', async () => {
  const ctx = setup();
  const { booking } = await ctx.agent.reserveChecked({ resource: 'Cancha 1', startAt: WED_20, customer: alice });
  await pay(ctx, booking);
  const r = await ctx.agent.cancel({ bookingId: booking.id, customerId: alice.id });
  assert.ok(r.ok);
  assert.equal(r.refundWei, arsToWei(6000));
  assert.equal(ctx.google.live().length, 0);
  assert.ok(ctx.store.decisions({ bookingId: booking.id }).some((d) => d.rule === 'EVENTO_BORRADO'));
  // El turno vuelve a estar libre.
  assert.ok((await ctx.agent.reserveChecked({ resource: 'Cancha 1', startAt: WED_20, customer: bob })).ok);
});

test('una reserva sin pagar que vence no deja nada en el calendario', async () => {
  const ctx = setup();
  const { booking } = await ctx.agent.reserveChecked({ resource: 'Cancha 1', startAt: WED_20, customer: alice });
  ctx.clock.advance(16 * 60_000);
  await ctx.agent.expireHolds();
  assert.equal(ctx.store.getBooking(booking.id).status, 'expired');
  assert.equal(ctx.google.live().length, 0);
  assert.equal(ctx.google.count('POST', '/events'), 0);
});

// --- Google caído ------------------------------------------------------------------------------

test('con Google caído no se muestran turnos ni se reserva', async () => {
  const ctx = setup();
  ctx.google.down = true;
  await assert.rejects(ctx.agent.listSlotsChecked({ dateStr: '2026-10-21' }), AgendaError);
  const r = await ctx.agent.reserveChecked({ resource: 'Cancha 1', startAt: WED_20, customer: alice });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'agenda_no_disponible');
  assert.equal(r.reason, AGENDA_DOWN_MESSAGE);
  assert.equal(ctx.store.activeBookingForSlot('Cancha 1', WED_20), null);
  assert.ok(ctx.store.decisions().some((d) => d.rule === 'AGENDA_NO_DISPONIBLE'));
});

test('con Google caído no se cobra: la última barrera dice 503', async () => {
  const ctx = setup();
  const { booking } = await ctx.agent.reserveChecked({ resource: 'Cancha 1', startAt: WED_20, customer: alice });
  ctx.google.down = true;
  const check = await ctx.agent.checkAgendaForPayment(booking);
  assert.equal(check.ok, false);
  assert.equal(check.status, 503);
  assert.equal(check.code, 'agenda_no_disponible');
});

test('si el pago sale pero Google no deja anotar el turno, no se confirma y se devuelve todo', async () => {
  const ctx = setup();
  const { booking } = await ctx.agent.reserveChecked({ resource: 'Cancha 1', startAt: WED_20, customer: alice });
  ctx.google.failWrites = true;
  const r = await pay(ctx, booking);
  assert.equal(r.kind, 'devolver');
  assert.notEqual(ctx.store.getBooking(booking.id).status, 'confirmed');
  assert.equal(ctx.google.live().length, 0);

  const [refund] = ctx.store.transfersByStatus('sent');
  assert.equal(refund.kind, 'refund');
  assert.equal(refund.to_address, PAYER_A);
  assert.equal(BigInt(refund.amount_wei), arsToWei(6000));
  assert.match(refund.note, /calendario/);
  assert.ok(ctx.notifier.forOwner().some((m) => /calendario/.test(m.text)));
  assert.ok(ctx.notifier.forCustomer(alice.id).every((m) => !/quedó confirmado/.test(m.text)));
});

test('si Google se cae al cancelar, igual se devuelve la seña y el evento se borra después', async () => {
  const ctx = setup();
  const { booking } = await ctx.agent.reserveChecked({ resource: 'Cancha 1', startAt: WED_20, customer: alice });
  await pay(ctx, booking);
  ctx.google.failWrites = true;
  const r = await ctx.agent.cancel({ bookingId: booking.id, customerId: alice.id });
  assert.ok(r.ok);
  assert.equal(r.refundWei, arsToWei(6000));
  assert.equal(ctx.google.live().length, 1, 'el evento sigue: el turno queda bloqueado (lado seguro)');
  assert.ok(ctx.store.decisions({ bookingId: booking.id }).some((d) => d.rule === 'AGENDA_PENDIENTE'));
  assert.ok(ctx.notifier.forOwner().some((m) => /no pude borrarlo del calendario/.test(m.text)));

  // Vuelve Google: la conciliación borra el evento de la reserva cancelada y no toca el resto.
  ctx.google.failWrites = false;
  const other = await ctx.agent.reserveChecked({ resource: 'Cancha 2', startAt: WED_20, customer: bob });
  await pay(ctx, other.booking, '0x2222222222222222222222222222222222222222');
  const { removed } = await ctx.agent.reconcileAgenda();
  assert.equal(removed, 1);
  assert.deepEqual(ctx.google.live().map((e) => e.id), [eventIdFor(other.booking.id)]);
});

// --- Por HTTP, con x402 de punta a punta ---------------------------------------------------------

let ctx; let httpServer; let base; let facilitator;

before(async () => {
  ctx = setup();
  facilitator = new MockFacilitator({ chain: ctx.chain, logger: silent });
  const payments = createPaymentServer({ agent: ctx.agent, facilitator, payTo: ctx.chain.address, builderCode: null, logger: silent });
  const app = createApp({ agent: ctx.agent, payments, logger: silent });
  await new Promise((resolve) => { httpServer = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${httpServer.address().port}`;
  ctx.agent.publicBaseUrl = base;
});

after(() => new Promise((resolve) => httpServer.close(resolve)));

const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
const reserveHttp = async (hora, recurso = 'Cancha 1', fecha = '2026-10-21') => {
  const res = await post('/api/reservas', { recurso, fecha, hora, cliente: { nombre: 'Agente de prueba' } });
  return { status: res.status, body: await res.json() };
};
const buyer = () => createPayingFetch({ signer: privateKeyToAccount(generatePrivateKey()), maxPerPaymentWei: arsToWei(10000) });

test('HTTP: un agente reserva, paga por x402 y el turno aparece en el calendario', async () => {
  const { status, body } = await reserveHttp('17:00');
  assert.equal(status, 201);
  const res = await buyer()(`${base}/api/reservas/${body.reserva.id}/pagar`, { method: 'POST' });
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal(ctx.store.getBooking(body.reserva.id).status, 'confirmed');
  assert.ok(ctx.google.live().some((e) => e.id === eventIdFor(body.reserva.id)));
  const turnos = await (await fetch(`${base}/api/turnos?fecha=2026-10-21&libres=no`)).json();
  assert.equal(turnos.turnos.find((t) => t.recurso === 'Cancha 1' && t.hora === '17:00').libre, false);
});

test('HTTP: si el comercio ocupó el turno mientras tanto, el pago se rechaza antes de firmar y no se cobra', async () => {
  const before = facilitator.settled.length;
  const { body } = await reserveHttp('18:30');
  const t = slot('2026-10-21', '18:30');
  ctx.google.addEvent({ summary: 'Cancha 1 - cliente de siempre', startMs: t, endMs: t + DURATION });
  const res = await buyer()(`${base}/api/reservas/${body.reserva.id}/pagar`, { method: 'POST' });
  assert.equal(res.status, 409);
  assert.equal(facilitator.settled.length, before);
  assert.equal(ctx.store.getBooking(body.reserva.id).status, 'held');
});

test('HTTP: con Google caído, la API responde 503 y no cobra', async () => {
  const before = facilitator.settled.length;
  const { body } = await reserveHttp('12:00');
  ctx.google.down = true;
  try {
    assert.equal((await fetch(`${base}/api/turnos?fecha=2026-10-21`)).status, 503);
    assert.equal((await reserveHttp('21:30', 'Cancha 2')).status, 503);
    const res = await buyer()(`${base}/api/reservas/${body.reserva.id}/pagar`, { method: 'POST' });
    assert.equal(res.status, 503);
    assert.equal(facilitator.settled.length, before);
    assert.equal(ctx.store.getBooking(body.reserva.id).status, 'held');
  } finally {
    ctx.google.down = false;
  }
});
