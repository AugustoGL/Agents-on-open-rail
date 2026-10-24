import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arsToWei } from '../src/money.js';
import { makeAgent, slot, alice, bob, carla, PAYER_A, PAYER_B, HOUR, MIN } from './helpers.js';

const SENA = arsToWei(6000);
const WED_20 = slot('2026-10-21', '20:00');

/** Simula el cobro x402: la plata entra a la wallet y el facilitador avisa. */
async function pay(ctx, booking, payer, tx = `0x${'ab'.repeat(32)}${booking.id}`) {
  ctx.chain.credit(booking.deposit_wei);
  return ctx.agent.onPaymentSettled({ bookingId: booking.id, payer, tx, amountWei: booking.deposit_wei });
}

test('reservar un turno libre lo guarda 15 minutos y cobra la seña correcta', () => {
  const { agent } = makeAgent();
  const r = agent.reserve({ resource: 'Cancha 1', startAt: WED_20, customer: alice });
  assert.ok(r.ok);
  assert.equal(r.booking.status, 'held');
  assert.equal(BigInt(r.booking.deposit_wei), SENA);
  assert.equal(r.booking.hold_expires_at - agent.now(), 15 * MIN);
  assert.match(agent.payUrl(r.booking), /\/pagar\/S-[A-Z0-9]{6}$/);
});

test('no se puede reservar dos veces el mismo turno', () => {
  const { agent } = makeAgent();
  assert.ok(agent.reserve({ resource: 'Cancha 1', startAt: WED_20, customer: alice }).ok);
  const r = agent.reserve({ resource: 'Cancha 1', startAt: WED_20, customer: bob });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'ocupado');
  assert.ok(agent.reserve({ resource: 'Cancha 2', startAt: WED_20, customer: bob }).ok);
});

test('rechaza turnos fuera de la grilla, muy cerca o muy lejos', () => {
  const { agent } = makeAgent();
  assert.equal(agent.reserve({ resource: 'Cancha 1', startAt: slot('2026-10-21', '20:15'), customer: alice }).code, 'turno_invalido');
  assert.equal(agent.reserve({ resource: 'Cancha 9', startAt: WED_20, customer: alice }).code, 'turno_invalido');
  assert.equal(agent.reserve({ resource: 'Cancha 1', startAt: slot('2026-10-19', '10:30'), customer: alice }).code, 'turno_invalido');
  assert.equal(agent.reserve({ resource: 'Cancha 1', startAt: slot('2026-10-30', '20:00'), customer: alice }).code, 'turno_invalido');
});

test('un cliente no puede acaparar turnos sin pagar', () => {
  const { agent } = makeAgent();
  assert.ok(agent.reserve({ resource: 'Cancha 1', startAt: WED_20, customer: alice }).ok);
  assert.ok(agent.reserve({ resource: 'Cancha 2', startAt: WED_20, customer: alice }).ok);
  assert.equal(agent.reserve({ resource: 'Cancha 1', startAt: slot('2026-10-21', '21:30'), customer: alice }).code, 'muchas_reservas');
});

test('listar turnos marca libres y ocupados', () => {
  const { agent } = makeAgent();
  agent.reserve({ resource: 'Cancha 1', startAt: WED_20, customer: alice });
  const slots = agent.listSlots({ dateStr: '2026-10-21' });
  assert.equal(slots.length, 14);
  assert.equal(slots.find((s) => s.resource === 'Cancha 1' && s.startAt === WED_20).free, false);
  assert.equal(agent.listSlots({ dateStr: '2026-10-21', onlyFree: true }).length, 13);
  // Hoy a las 10:00 ya no se puede reservar el de 09:00 ni el de 10:30 (anticipación de 60 min).
  assert.ok(agent.listSlots({ dateStr: '2026-10-19' }).every((s) => s.startAt >= agent.now() + 60 * MIN));
});

test('cobrar confirma el turno, avisa y es idempotente', async () => {
  const ctx = makeAgent();
  const { booking } = ctx.agent.reserve({ resource: 'Cancha 1', startAt: WED_20, customer: alice });
  const tx = `0x${'cd'.repeat(32)}`;
  const r = await pay(ctx, booking, PAYER_A, tx);
  assert.equal(r.kind, 'confirmado');
  const b = ctx.store.getBooking(booking.id);
  assert.equal(b.status, 'confirmed');
  assert.equal(b.payer, PAYER_A);
  assert.equal(b.pay_tx, tx);
  assert.ok(ctx.notifier.forCustomer(alice.id).some((m) => m.text.includes('confirmado')));
  assert.ok(ctx.notifier.forOwner().some((m) => m.text.includes('Seña cobrada')));
  const again = await ctx.agent.onPaymentSettled({ bookingId: booking.id, payer: PAYER_A, tx, amountWei: booking.deposit_wei });
  assert.equal(again.kind, 'repetido');
  assert.equal(ctx.chain.state.sent.length, 0);
});

test('un segundo pago de la misma reserva se devuelve entero', async () => {
  const ctx = makeAgent();
  const { booking } = ctx.agent.reserve({ resource: 'Cancha 1', startAt: WED_20, customer: alice });
  await pay(ctx, booking, PAYER_A, `0x${'01'.repeat(32)}`);
  const r = await pay(ctx, booking, PAYER_B, `0x${'02'.repeat(32)}`);
  assert.equal(r.kind, 'devolver');
  assert.equal(ctx.chain.state.sent.length, 1);
  assert.equal(ctx.chain.state.sent[0].to, PAYER_B);
  assert.equal(ctx.chain.state.sent[0].amountWei, SENA);
  assert.equal(ctx.store.getBooking(booking.id).payer, PAYER_A);
});

test('cancelar a tiempo devuelve todo y ofrece el turno a la lista de espera', async () => {
  const ctx = makeAgent();
  const { booking } = ctx.agent.reserve({ resource: 'Cancha 1', startAt: WED_20, customer: alice });
  await pay(ctx, booking, PAYER_A);
  const w = ctx.agent.joinWaitlist({ resource: 'Cancha 1', startAt: WED_20, customer: bob });
  assert.ok(w.ok);
  assert.equal(w.position, 1);

  const r = await ctx.agent.cancel({ bookingId: booking.id, customerId: alice.id });
  assert.ok(r.ok);
  assert.equal(r.rule, 'A_TIEMPO');
  assert.equal(ctx.chain.state.sent.length, 1);
  assert.equal(ctx.chain.state.sent[0].to, PAYER_A);
  assert.equal(ctx.chain.state.sent[0].amountWei, SENA);
  const transfer = ctx.store.transfersByStatus('sent')[0];
  assert.equal(transfer.kind, 'refund');

  const offer = ctx.store.activeBookingForSlot('Cancha 1', WED_20);
  assert.equal(offer.customer_id, bob.id);
  assert.equal(offer.source, 'lista_espera');
  assert.equal(offer.hold_expires_at - ctx.agent.now(), 30 * MIN);
  assert.ok(ctx.notifier.forCustomer(bob.id).some((m) => m.text.includes('Se liberó')));
  assert.ok(ctx.notifier.forCustomer(alice.id).some((m) => m.text.includes('Te devolví')));
});

test('cancelación tardía retiene la seña, y si el turno se revende la devuelve', async () => {
  const ctx = makeAgent();
  const { booking } = ctx.agent.reserve({ resource: 'Cancha 1', startAt: WED_20, customer: alice });
  await pay(ctx, booking, PAYER_A);
  ctx.agent.joinWaitlist({ resource: 'Cancha 1', startAt: WED_20, customer: bob });

  ctx.clock.set(WED_20 - 3 * HOUR);
  const r = await ctx.agent.cancel({ bookingId: booking.id, customerId: alice.id });
  assert.equal(r.rule, 'MUY_TARDE');
  assert.equal(r.refundWei, 0n);
  assert.equal(ctx.chain.state.sent.length, 0);

  const offer = ctx.store.activeBookingForSlot('Cancha 1', WED_20);
  assert.equal(offer.customer_id, bob.id);
  await pay(ctx, offer, PAYER_B);

  assert.equal(ctx.chain.state.sent.length, 1);
  assert.equal(ctx.chain.state.sent[0].to, PAYER_A);
  assert.equal(ctx.chain.state.sent[0].amountWei, SENA);
  assert.equal(BigInt(ctx.store.getBooking(booking.id).refunded_wei), SENA);
  assert.ok(ctx.store.decisions({ bookingId: booking.id }).some((d) => d.rule === 'REVENTA'));
});

test('cancelación parcial devuelve la mitad y la reventa devuelve el resto', async () => {
  const ctx = makeAgent();
  const { booking } = ctx.agent.reserve({ resource: 'Cancha 1', startAt: WED_20, customer: alice });
  await pay(ctx, booking, PAYER_A);
  ctx.agent.joinWaitlist({ resource: 'Cancha 1', startAt: WED_20, customer: bob });
  ctx.clock.set(WED_20 - 10 * HOUR);
  const r = await ctx.agent.cancel({ bookingId: booking.id, customerId: alice.id });
  assert.equal(r.rule, 'TARDE_PARCIAL');
  assert.equal(ctx.chain.state.sent[0].amountWei, SENA / 2n);
  const offer = ctx.store.activeBookingForSlot('Cancha 1', WED_20);
  await pay(ctx, offer, PAYER_B);
  assert.equal(ctx.chain.state.sent.length, 2);
  assert.equal(ctx.chain.state.sent[1].amountWei, SENA / 2n);
  assert.equal(BigInt(ctx.store.getBooking(booking.id).refunded_wei), SENA);
});

test('solo el dueño de la reserva la puede cancelar; sin pago no hay devolución', async () => {
  const ctx = makeAgent();
  const { booking } = ctx.agent.reserve({ resource: 'Cancha 1', startAt: WED_20, customer: alice });
  const other = await ctx.agent.cancel({ bookingId: booking.id, customerId: bob.id });
  assert.equal(other.ok, false);
  const r = await ctx.agent.cancel({ bookingId: booking.id, customerId: alice.id });
  assert.equal(r.rule, 'SIN_PAGO');
  assert.equal(ctx.store.getBooking(booking.id).status, 'cancelled');
  assert.equal(ctx.chain.state.sent.length, 0);
});

test('las reservas sin pagar vencen y el turno pasa al siguiente de la lista', async () => {
  const ctx = makeAgent();
  const { booking } = ctx.agent.reserve({ resource: 'Cancha 1', startAt: WED_20, customer: alice });
  ctx.agent.joinWaitlist({ resource: 'Cancha 1', startAt: WED_20, customer: bob });
  ctx.agent.joinWaitlist({ resource: 'Cancha 1', startAt: WED_20, customer: carla });

  ctx.clock.advance(16 * MIN);
  assert.equal(await ctx.agent.expireHolds(), 1);
  assert.equal(ctx.store.getBooking(booking.id).status, 'expired');
  let offer = ctx.store.activeBookingForSlot('Cancha 1', WED_20);
  assert.equal(offer.customer_id, bob.id);

  // Beto no paga en los 30 minutos: pasa a Carla.
  ctx.clock.advance(31 * MIN);
  await ctx.agent.expireHolds();
  offer = ctx.store.activeBookingForSlot('Cancha 1', WED_20);
  assert.equal(offer.customer_id, carla.id);
  assert.equal(ctx.agent.checkPayable(offer.id).ok, true);
});

test('un pago tardío se acepta si el turno sigue libre y se devuelve si no', async () => {
  const ctx = makeAgent();
  const a = ctx.agent.reserve({ resource: 'Cancha 1', startAt: WED_20, customer: alice }).booking;
  const b = ctx.agent.reserve({ resource: 'Cancha 2', startAt: WED_20, customer: bob }).booking;
  ctx.clock.advance(16 * MIN);
  await ctx.agent.expireHolds();
  assert.equal(ctx.agent.checkPayable(a.id).code, 'vencida');

  const late = await pay(ctx, a, PAYER_A);
  assert.equal(late.kind, 'confirmado');
  assert.equal(ctx.store.getBooking(a.id).status, 'confirmed');

  ctx.agent.reserve({ resource: 'Cancha 2', startAt: WED_20, customer: carla });
  const lost = await pay(ctx, b, PAYER_B);
  assert.equal(lost.kind, 'devolver');
  assert.equal(ctx.chain.state.sent.at(-1).to, PAYER_B);
});

test('una devolución por encima del tope espera al dueño', async () => {
  const ctx = makeAgent();
  ctx.agent.business = { ...ctx.agent.business, limites: { ...ctx.agent.business.limites, devolucionMaxAutomaticaArs: 5000 } };
  const { booking } = ctx.agent.reserve({ resource: 'Cancha 1', startAt: WED_20, customer: alice });
  await pay(ctx, booking, PAYER_A);
  await ctx.agent.cancel({ bookingId: booking.id, customerId: alice.id });
  assert.equal(ctx.chain.state.sent.length, 0);
  const [t] = ctx.store.transfersByStatus('needs_owner');
  assert.ok(t);
  assert.ok(ctx.notifier.forOwner().some((m) => m.text.includes(`/aprobar ${t.id}`)));
  const ok = await ctx.agent.approveTransfer(t.id);
  assert.ok(ok.ok);
  assert.equal(ok.transfer.status, 'sent');
  assert.equal(ctx.chain.state.sent.length, 1);
});

test('rechazar una devolución retenida la anula', async () => {
  const ctx = makeAgent();
  ctx.agent.business = { ...ctx.agent.business, limites: { ...ctx.agent.business.limites, devolucionMaxAutomaticaArs: 5000 } };
  const { booking } = ctx.agent.reserve({ resource: 'Cancha 1', startAt: WED_20, customer: alice });
  await pay(ctx, booking, PAYER_A);
  await ctx.agent.cancel({ bookingId: booking.id, customerId: alice.id });
  const [t] = ctx.store.transfersByStatus('needs_owner');
  assert.ok((await ctx.agent.rejectTransfer(t.id)).ok);
  assert.equal(BigInt(ctx.store.getBooking(booking.id).refunded_wei), 0n);
});

test('una transferencia que falla sin salir se puede reintentar; una incierta no', async () => {
  const ctx = makeAgent();
  const { booking } = ctx.agent.reserve({ resource: 'Cancha 1', startAt: WED_20, customer: alice });
  await pay(ctx, booking, PAYER_A);
  ctx.chain.state.failNext = { message: 'sin gas', notSent: true };
  await ctx.agent.cancel({ bookingId: booking.id, customerId: alice.id });
  const [failed] = ctx.store.transfersByStatus('failed');
  assert.ok(failed);
  const retry = await ctx.agent.approveTransfer(failed.id);
  assert.equal(retry.transfer.status, 'sent');

  const ctx2 = makeAgent();
  const b2 = ctx2.agent.reserve({ resource: 'Cancha 1', startAt: WED_20, customer: alice }).booking;
  await pay(ctx2, b2, PAYER_A);
  ctx2.chain.state.failNext = { message: 'timeout del nodo', notSent: false };
  await ctx2.agent.cancel({ bookingId: b2.id, customerId: alice.id });
  const [unknown] = ctx2.store.transfersByStatus('unknown');
  assert.ok(unknown);
  assert.equal((await ctx2.agent.approveTransfer(unknown.id)).ok, false);
  assert.equal(ctx2.chain.state.sent.length, 0);
});

test('el cierre del día solo retira lo que ya es del negocio', async () => {
  const ctx = makeAgent();
  const past = ctx.agent.reserve({ resource: 'Cancha 1', startAt: slot('2026-10-19', '17:00'), customer: alice }).booking;
  await pay(ctx, past, PAYER_A);
  const future = ctx.agent.reserve({ resource: 'Cancha 1', startAt: WED_20, customer: bob }).booking;
  await pay(ctx, future, PAYER_B);

  // A las 23:00 el turno de las 17:00 ya se jugó; el del miércoles sigue comprometido.
  ctx.clock.set(slot('2026-10-19', '23:00'));
  assert.equal(ctx.agent.completeFinished(), 1);
  const { payout, report } = await ctx.agent.dailyClose();
  assert.equal(payout.amountWei, SENA);
  assert.equal(ctx.chain.state.sent.length, 1);
  assert.equal(ctx.chain.state.sent[0].to, '0x000000000000000000000000000000000000dEaD');
  assert.match(report, /Señas cobradas: 2/);

  // Repetir el cierre el mismo día no retira dos veces.
  await ctx.agent.dailyClose();
  assert.equal(ctx.chain.state.sent.length, 1);
});

test('el registro de decisiones explica cada paso', async () => {
  const ctx = makeAgent();
  const { booking } = ctx.agent.reserve({ resource: 'Cancha 1', startAt: WED_20, customer: alice });
  await pay(ctx, booking, PAYER_A);
  await ctx.agent.cancel({ bookingId: booking.id, customerId: alice.id });
  const rules = ctx.store.decisions({ bookingId: booking.id }).map((d) => d.rule).reverse();
  assert.deepEqual(rules, ['TURNO_LIBRE', 'SENA_COBRADA', 'A_TIEMPO', 'DEVOLUCION_ENVIADA']);
  assert.ok(ctx.store.decisions({ bookingId: booking.id }).find((d) => d.rule === 'DEVOLUCION_ENVIADA').tx.startsWith('0x'));
});
