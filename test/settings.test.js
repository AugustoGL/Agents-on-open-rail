// Configuración en la base, condiciones por reserva y bloqueos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { arsToWei } from '../src/money.js';
import { BusinessSettings, validateBusiness, toStored, hoursFor } from '../src/settings.js';
import { makeAgent, business, slot, alice, bob, PAYER_A } from './helpers.js';

const WED_20 = slot('2026-10-21', '20:00');
const base = () => structuredClone(business);
const campos = (r) => r.errors.map((e) => e.campo);

async function pay(ctx, booking, payer = PAYER_A) {
  ctx.chain.credit(booking.deposit_wei);
  return ctx.agent.onPaymentSettled({ bookingId: booking.id, payer, tx: `0x${'ab'.repeat(32)}${booking.id}`, amountWei: booking.deposit_wei });
}

// --- Validación -------------------------------------------------------------------------------

test('la configuración inicial (negocio.json) es válida y trae los campos derivados', () => {
  const r = validateBusiness(base());
  assert.ok(r.ok, JSON.stringify(r.errors));
  assert.deepEqual(r.business.recursos, ['Court 1', 'Court 2']);
  assert.equal(r.business.cierre.hora, '23:30');
});

test('rechaza valores fuera de rango con mensajes claros', () => {
  const r = validateBusiness({ ...base(), precioTurnoArs: 5, senaPorcentaje: 150, duracionMinutos: 10, diasAdelante: 0, reservaSinPagarMinutos: 1 });
  assert.equal(r.ok, false);
  for (const c of ['precioTurnoArs', 'senaPorcentaje', 'duracionMinutos', 'diasAdelante', 'reservaSinPagarMinutos']) assert.ok(campos(r).includes(c), c);
  assert.match(r.errors.find((e) => e.campo === 'precioTurnoArs').mensaje, /between/);
  assert.equal(validateBusiness({ ...base(), precioTurnoArs: 'abc' }).ok, false);
  assert.equal(validateBusiness({ ...base(), precioTurnoArs: 1500.5 }).ok, false);
});

test('valida política, límites y horarios', () => {
  const p = base();
  p.politica.devolucionParcialHorasAntes = 30; // más que las 24 h de devolver todo
  p.limites.devolucionMaxAutomaticaArs = 90000; // más que el tope diario
  p.horarios = ['09:00', '10:00']; // se pisan con turnos de 90 minutos
  const r = validateBusiness(p);
  assert.ok(campos(r).includes('politica.devolucionParcialHorasAntes'));
  assert.ok(campos(r).includes('limites.devolucionMaxAutomaticaArs'));
  assert.ok(campos(r).includes('horarios'));
  assert.equal(validateBusiness({ ...base(), horarios: ['25:00'] }).ok, false);
  assert.equal(validateBusiness({ ...base(), horarios: ['09:00', '09:00'] }).ok, false);
  assert.equal(validateBusiness({ ...base(), cierre: { hora: '99:99' } }).ok, false);
});

test('valida canchas: nombres únicos y sin caracteres raros, y no se pueden borrar', () => {
  const dup = validateBusiness({ ...base(), recursos: ['Court 1', 'court 1'] });
  assert.equal(dup.ok, false);
  assert.equal(validateBusiness({ ...base(), recursos: ['<img src=x onerror=alert(1)>'] }).ok, false);
  assert.equal(validateBusiness({ ...base(), recursos: [] }).ok, false);
  const previous = validateBusiness(base()).business;
  const borrada = validateBusiness({ ...toStored(previous), recursosLista: [{ nombre: 'Court 1', activo: true }] }, { previous });
  assert.equal(borrada.ok, false);
  assert.match(borrada.errors[0].mensaje, /cannot be deleted/);
  const sinActivas = validateBusiness({ ...toStored(previous), recursosLista: previous.recursosLista.map((r) => ({ ...r, activo: false })) }, { previous });
  assert.equal(sinActivas.ok, false);
});

test('los horarios se pueden definir por día de la semana y por cancha', () => {
  const b = validateBusiness({ ...base(), horariosSemana: { 3: [], 6: ['10:00'] }, horariosRecurso: { 'Court 2': { 3: ['20:00'] } } });
  assert.ok(b.ok, JSON.stringify(b.errors));
  assert.deepEqual(hoursFor(b.business, 'Court 1', 3), []); // miércoles cerrado
  assert.deepEqual(hoursFor(b.business, 'Court 2', 3), ['20:00']); // salvo la cancha 2
  assert.deepEqual(hoursFor(b.business, 'Court 1', 6), ['10:00']);
  assert.deepEqual(hoursFor(b.business, 'Court 1', 1), b.business.horarios);
  assert.equal(validateBusiness({ ...base(), horariosSemana: { 9: ['10:00'] } }).ok, false);
  assert.equal(validateBusiness({ ...base(), horariosRecurso: { 'Court 7': { 1: ['10:00'] } } }).ok, false);
});

// --- Guardado, importación y registro ----------------------------------------------------------

test('el negocio.json se importa una sola vez; después manda la base', () => {
  const store = openDb(':memory:');
  const s = new BusinessSettings(store);
  assert.equal(s.loadOrSeed(base()).nombre, 'Pádel Demo');
  const otro = { ...base(), nombre: 'Otro nombre' };
  assert.equal(s.loadOrSeed(otro).nombre, 'Pádel Demo'); // no se vuelve a importar
  assert.equal(store.settingsLog().length, 1);
  assert.equal(store.settingsLog()[0].actor, 'sistema');
});

test('un cambio válido se guarda, vale en el agente y queda registrado (quién, cuándo, antes y después)', () => {
  const { agent, store, clock } = makeAgent();
  const r = agent.updateSettings({ nombre: 'Club Córdoba', precioTurnoArs: 30000, politica: { devolucionTotalHorasAntes: 48 } }, { ip: '1.2.3.4' });
  assert.ok(r.ok, JSON.stringify(r.errors));
  assert.equal(agent.business.nombre, 'Club Córdoba');
  assert.equal(agent.business.politica.devolucionTotalHorasAntes, 48);
  assert.equal(agent.business.politica.devolucionParcialHorasAntes, 6); // lo que no se tocó, igual
  assert.equal(agent.depositWei(), arsToWei(7500));
  const log = store.settingsLog();
  const precio = log.find((l) => l.field === 'precioTurnoArs');
  assert.equal(precio.old_value, 24000);
  assert.equal(precio.new_value, 30000);
  assert.equal(precio.actor, 'panel (1.2.3.4)');
  assert.equal(precio.at, clock.now());
  assert.ok(store.decisions().some((d) => d.rule === 'CONFIGURACION_CAMBIADA'));
  assert.equal(store.getSetting('business').nombre, 'Club Córdoba'); // quedó en la base
});

test('un cambio inválido no cambia nada y devuelve los errores', () => {
  const { agent, store } = makeAgent();
  const r = agent.updateSettings({ precioTurnoArs: 1, senaPorcentaje: 500 });
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 2);
  assert.equal(agent.business.precioTurnoArs, 24000);
  assert.equal(store.settingsLog().length, 0);
  assert.equal(store.getSetting('business'), null);
});

test('desde el panel no se pueden tocar la dirección de retiro, el modo, claves ni el desfase', () => {
  const { agent } = makeAgent();
  for (const cambio of [{ payoutAddress: '0xabc' }, { payTo: '0xabc' }, { modo: 'live' }, { utcOffsetMinutos: 0 }, { esDemostracion: false }, { politica: { x: 1 } }, { cierre: { reservaMinimaArs: 5 } }]) {
    const r = agent.updateSettings(cambio);
    assert.equal(r.ok, false, JSON.stringify(cambio));
    assert.match(r.errors[0].mensaje, /cannot be changed from the dashboard/);
  }
});

test('renombrar una cancha actualiza las reservas, y se puede desactivar', async () => {
  const ctx = makeAgent();
  const { booking } = ctx.agent.reserve({ resource: 'Court 1', startAt: WED_20, customer: alice });
  const r = ctx.agent.updateSettings({ recursosLista: [{ nombre: 'Cancha Central', anterior: 'Court 1', activo: true }, { nombre: 'Court 2', anterior: 'Court 2', activo: false }] });
  assert.ok(r.ok, JSON.stringify(r.errors));
  assert.equal(ctx.store.getBooking(booking.id).resource, 'Cancha Central');
  assert.deepEqual(ctx.agent.business.recursos, ['Cancha Central']);
  assert.deepEqual(ctx.agent.business.recursosTodos, ['Cancha Central', 'Court 2']);
  assert.equal(ctx.agent.reserve({ resource: 'Court 2', startAt: WED_20, customer: bob }).ok, false); // desactivada
  assert.equal(ctx.agent.reserve({ resource: 'Cancha Central', startAt: WED_20, customer: bob }).code, 'ocupado'); // la reserva sigue en su lugar
  // La reserva existente se puede pagar y cancelar igual.
  assert.equal((await pay(ctx, booking)).kind, 'confirmado');
  assert.ok((await ctx.agent.cancel({ bookingId: booking.id, customerId: alice.id })).ok);
});

test('los horarios por día cambian los turnos que se ofrecen', () => {
  const { agent } = makeAgent();
  assert.ok(agent.updateSettings({ horariosSemana: { 3: [] }, horariosRecurso: { 'Court 2': { 3: ['20:00'] } } }).ok);
  const slots = agent.listSlots({ dateStr: '2026-10-21' }); // miércoles
  assert.deepEqual(slots.map((s) => `${s.resource} ${s.time}`), ['Court 2 20:00']);
  assert.equal(agent.listSlots({ dateStr: '2026-10-22' }).length, 14); // jueves, normal
  assert.equal(agent.reserve({ resource: 'Court 1', startAt: WED_20, customer: alice }).code, 'turno_invalido');
});

// --- Las reservas existentes conservan sus condiciones ------------------------------------------

test('un cambio de precio o de política no altera una reserva ya pagada', async () => {
  const ctx = makeAgent();
  const { booking } = ctx.agent.reserve({ resource: 'Court 1', startAt: WED_20, customer: alice });
  await pay(ctx, booking);
  // Después el comercio sube el precio y endurece la política: ahora haría falta cancelar con 100 h para recuperar todo.
  assert.ok(ctx.agent.updateSettings({ precioTurnoArs: 40000, senaPorcentaje: 50, politica: { devolucionTotalHorasAntes: 100, devolucionParcialHorasAntes: 90 } }).ok);
  assert.equal(ctx.agent.depositWei(), arsToWei(20000));
  const stored = ctx.store.getBooking(booking.id);
  assert.equal(BigInt(stored.deposit_wei), arsToWei(6000)); // la seña no cambió
  assert.equal(JSON.parse(stored.terms).politica.devolucionTotalHorasAntes, 24);
  // Faltan ~58 h: con la política vieja se devuelve todo; con la nueva sería solo una parte.
  const preview = ctx.agent.previewCancel({ bookingId: booking.id, customerId: alice.id });
  assert.equal(preview.refundWei, arsToWei(6000));
  assert.equal(preview.rule, 'A_TIEMPO');
  const r = await ctx.agent.cancel({ bookingId: booking.id, customerId: alice.id });
  assert.equal(r.refundWei, arsToWei(6000));
  // Una reserva nueva sí toma lo nuevo.
  const nueva = ctx.agent.reserve({ resource: 'Court 2', startAt: WED_20, customer: bob }).booking;
  assert.equal(BigInt(nueva.deposit_wei), arsToWei(20000));
  assert.equal(JSON.parse(nueva.terms).politica.devolucionTotalHorasAntes, 100);
});

test('"devolver si se revende" también usa lo que valía cuando se pagó', async () => {
  const ctx = makeAgent({ nowLocal: ['2026-10-21', '19:00'] }); // faltan 1 h: cancelación muy tardía
  const { booking } = ctx.agent.reserve({ resource: 'Court 1', startAt: WED_20, customer: alice });
  await pay(ctx, booking);
  assert.ok(ctx.agent.updateSettings({ politica: { devolverSiSeRevende: false } }).ok);
  await ctx.agent.cancel({ bookingId: booking.id, customerId: alice.id });
  const nueva = ctx.agent.reserve({ resource: 'Court 1', startAt: WED_20, customer: bob }).booking;
  await pay(ctx, nueva, '0x2222222222222222222222222222222222222222');
  // La política con la que alicia pagó sí devolvía en reventa: se le devuelve aunque ahora no.
  assert.ok(ctx.store.transfersByStatus('sent').some((t) => t.idem_key === `refund:${booking.id}:reventa`));
});

// --- Bloqueos -----------------------------------------------------------------------------------

test('bloquear un día entero saca los turnos y no se puede reservar', () => {
  const { agent } = makeAgent();
  const r = agent.createBlock({ tipo: 'dia', fecha: '2026-10-21', motivo: 'Feriado' });
  assert.ok(r.ok, JSON.stringify(r.errors));
  const slots = agent.listSlots({ dateStr: '2026-10-21' });
  assert.equal(slots.length, 14);
  assert.ok(slots.every((s) => s.blocked && !s.free && s.blockReason === 'Feriado'));
  assert.equal(agent.listSlots({ dateStr: '2026-10-21', onlyFree: true }).length, 0);
  const res = agent.reserve({ resource: 'Court 1', startAt: WED_20, customer: alice });
  assert.equal(res.code, 'bloqueado');
  assert.match(res.reason, /Feriado/);
  assert.equal(agent.joinWaitlist({ resource: 'Court 1', startAt: WED_20, customer: alice }).code, 'bloqueado');
  assert.ok(!agent.bookableDays().includes('2026-10-21'));
  assert.equal(agent.listSlots({ dateStr: '2026-10-22', onlyFree: true }).length, 14);
});

test('se puede bloquear una cancha por varios días o un solo turno, y quitar el bloqueo', () => {
  const { agent, store } = makeAgent();
  const k1 = agent.createBlock({ tipo: 'recurso', recurso: 'Court 2', fecha: '2026-10-21', hasta: '2026-10-22', motivo: 'Mantenimiento' }).block;
  assert.equal(agent.listSlots({ dateStr: '2026-10-22', onlyFree: true }).filter((s) => s.resource === 'Court 2').length, 0);
  assert.equal(agent.listSlots({ dateStr: '2026-10-22', onlyFree: true }).filter((s) => s.resource === 'Court 1').length, 7);
  assert.equal(agent.listSlots({ dateStr: '2026-10-23', onlyFree: true }).length, 14);
  const k2 = agent.createBlock({ tipo: 'turno', recurso: 'Court 1', fecha: '2026-10-23', hora: '17:00', motivo: 'Clase' }).block;
  assert.equal(agent.listSlots({ dateStr: '2026-10-23', onlyFree: true }).length, 13);
  assert.ok(agent.removeBlock(k1.id).ok);
  assert.ok(agent.removeBlock(k2.id).ok);
  assert.equal(agent.listSlots({ dateStr: '2026-10-22', onlyFree: true }).length, 14);
  assert.equal(agent.removeBlock(k1.id).ok, false);
  assert.ok(store.decisions().some((d) => d.rule === 'BLOQUEO_CREADO'));
});

test('valida los bloqueos: motivo, fechas, cancha y horario de la grilla', () => {
  const { agent } = makeAgent();
  const bad = (input) => agent.createBlock(input);
  assert.ok(bad({ tipo: 'dia', fecha: '2026-10-21', motivo: '' }).errors.some((e) => e.campo === 'motivo'));
  assert.ok(bad({ tipo: 'dia', fecha: '2026-02-31', motivo: 'x' }).errors.some((e) => e.campo === 'fecha'));
  assert.ok(bad({ tipo: 'dia', fecha: '2026-10-21', hasta: '2026-10-20', motivo: 'x' }).errors.some((e) => e.campo === 'hasta'));
  assert.ok(bad({ tipo: 'turno', recurso: 'Court 9', fecha: '2026-10-21', hora: '20:00', motivo: 'x' }).errors.some((e) => e.campo === 'recurso'));
  assert.ok(bad({ tipo: 'turno', recurso: 'Court 1', fecha: '2026-10-21', hora: '20:15', motivo: 'x' }).errors.some((e) => e.campo === 'hora'));
  assert.ok(bad({ tipo: 'dia', fecha: '2026-10-18', motivo: 'ya pasó' }).errors.some((e) => e.campo === 'fecha'));
  assert.ok(bad({ tipo: 'raro', fecha: '2026-10-21', motivo: 'x' }).errors.some((e) => e.campo === 'tipo'));
});

test('con reservas pagadas dentro de un bloqueo: avisa y permite cancelarlas con devolución total', async () => {
  const ctx = makeAgent();
  const paid = ctx.agent.reserve({ resource: 'Court 1', startAt: WED_20, customer: alice }).booking;
  await pay(ctx, paid);
  const held = ctx.agent.reserve({ resource: 'Court 2', startAt: WED_20, customer: bob }).booking;
  const other = ctx.agent.reserve({ resource: 'Court 1', startAt: slot('2026-10-22', '20:00'), customer: bob }).booking; // otro día

  const r = ctx.agent.createBlock({ tipo: 'dia', fecha: '2026-10-21', motivo: 'Feriado' });
  assert.deepEqual(r.affected.map((b) => b.id).sort(), [paid.id, held.id].sort());
  assert.ok(ctx.store.decisions().some((d) => d.rule === 'BLOQUEO_CREADO' && /2 booking/.test(d.reason)));

  const done = await ctx.agent.cancelBlockedBookings(r.block.id);
  assert.equal(done.results.length, 2);
  assert.ok(done.results.every((x) => x.ok));
  assert.equal(ctx.store.getBooking(paid.id).status, 'cancelled');
  assert.equal(ctx.store.getBooking(paid.id).cancel_rule, 'CANCELADO_POR_COMERCIO');
  assert.equal(ctx.store.getBooking(held.id).status, 'cancelled');
  assert.equal(ctx.store.getBooking(other.id).status, 'held');
  const refund = ctx.store.transfersByStatus('sent').find((t) => t.booking_id === paid.id);
  assert.equal(BigInt(refund.amount_wei), arsToWei(6000));
  assert.equal(refund.to_address, PAYER_A);
  assert.ok(ctx.store.decisions({ bookingId: paid.id }).some((d) => d.rule === 'CANCELADO_POR_COMERCIO' && /Feriado/.test(d.reason)));
  assert.ok(ctx.notifier.forCustomer(alice.id).some((m) => /The venue cancelled your slot/.test(m.text)));
});

test('la devolución por bloqueo respeta los topes del agente (pide aprobación del dueño)', async () => {
  const ctx = makeAgent();
  assert.ok(ctx.agent.updateSettings({ limites: { devolucionMaxAutomaticaArs: 1000, devolucionesMaxDiariasArs: 5000 } }).ok);
  const { booking } = ctx.agent.reserve({ resource: 'Court 1', startAt: WED_20, customer: alice });
  await pay(ctx, booking);
  const k = ctx.agent.createBlock({ tipo: 'dia', fecha: '2026-10-21', motivo: 'Feriado' }).block;
  await ctx.agent.cancelBlockedBookings(k.id);
  const [pending] = ctx.store.transfersByStatus('needs_owner');
  assert.equal(BigInt(pending.amount_wei), arsToWei(6000));
  assert.equal(ctx.store.transfersByStatus('sent').length, 0);
});
