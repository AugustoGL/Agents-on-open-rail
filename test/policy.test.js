import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arsToWei, formatArs, percentOf, weiToArsString } from '../src/money.js';
import { depositWei, decideCancellation, decideResaleRefund, checkTransferLimits, decidePayout } from '../src/policy.js';
import { localToUtcMs, formatLocal, localDateStr, addDays } from '../src/time.js';
import { business, HOUR } from './helpers.js';

const policy = business.politica;
const limits = business.limites;

test('pesos <-> wARS con 18 decimales', () => {
  assert.equal(arsToWei('1'), 10n ** 18n);
  assert.equal(arsToWei(6000), 6000n * 10n ** 18n);
  assert.equal(arsToWei('0.5'), 5n * 10n ** 17n);
  assert.equal(weiToArsString(arsToWei('1234.5')), '1234.5');
  assert.throws(() => arsToWei('-3'));
  assert.throws(() => arsToWei('abc'));
});

test('formato argentino', () => {
  assert.equal(formatArs(arsToWei(6000)), '$ 6.000');
  assert.equal(formatArs(arsToWei('1234567.5')), '$ 1.234.567,50');
  assert.equal(formatArs(0n), '$ 0');
});

test('porcentajes redondean para abajo y validan', () => {
  assert.equal(percentOf(101n, 50), 50n);
  assert.throws(() => percentOf(10n, 101));
  assert.throws(() => percentOf(10n, 1.5));
});

test('la seña es el 25% del turno', () => {
  assert.equal(depositWei(business), arsToWei(6000));
});

test('horas locales de Córdoba (UTC-3)', () => {
  const ms = localToUtcMs('2026-10-22', '21:30', -180);
  assert.equal(new Date(ms).toISOString(), '2026-10-23T00:30:00.000Z');
  assert.equal(formatLocal(ms, -180), 'jue 22/10 21:30');
  assert.equal(localDateStr(ms, -180), '2026-10-22');
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
});

test('cancelación a tiempo devuelve todo', () => {
  const paid = arsToWei(6000);
  const d = decideCancellation({ startAt: 100 * HOUR, now: 100 * HOUR - 30 * HOUR, paidWei: paid, policy });
  assert.equal(d.rule, 'A_TIEMPO');
  assert.equal(d.refundWei, paid);
  assert.ok(d.offerToWaitlist);
});

test('cancelación entre 6 y 24 h devuelve la mitad', () => {
  const d = decideCancellation({ startAt: 100 * HOUR, now: 90 * HOUR, paidWei: arsToWei(6000), policy });
  assert.equal(d.rule, 'TARDE_PARCIAL');
  assert.equal(d.refundWei, arsToWei(3000));
});

test('cancelación con menos de 6 h no devuelve nada', () => {
  const d = decideCancellation({ startAt: 100 * HOUR, now: 98 * HOUR, paidWei: arsToWei(6000), policy });
  assert.equal(d.rule, 'MUY_TARDE');
  assert.equal(d.refundWei, 0n);
});

test('los bordes exactos de 24 h y 6 h caen del lado del cliente', () => {
  assert.equal(decideCancellation({ startAt: 48 * HOUR, now: 24 * HOUR, paidWei: 100n, policy }).rule, 'A_TIEMPO');
  assert.equal(decideCancellation({ startAt: 12 * HOUR, now: 6 * HOUR, paidWei: 100n, policy }).rule, 'TARDE_PARCIAL');
});

test('no se cancela un turno que ya empezó', () => {
  const d = decideCancellation({ startAt: 10 * HOUR, now: 10 * HOUR + 1, paidWei: 100n, policy });
  assert.equal(d.rule, 'TURNO_EMPEZADO');
  assert.equal(d.refundWei, 0n);
});

test('reventa devuelve solo lo retenido', () => {
  const r = decideResaleRefund({ paidWei: arsToWei(6000), alreadyRefundedWei: arsToWei(3000), policy });
  assert.equal(r.rule, 'REVENTA');
  assert.equal(r.refundWei, arsToWei(3000));
  const none = decideResaleRefund({ paidWei: arsToWei(6000), alreadyRefundedWei: arsToWei(6000), policy });
  assert.equal(none.refundWei, 0n);
  const off = decideResaleRefund({ paidWei: 10n, alreadyRefundedWei: 0n, policy: { ...policy, devolverSiSeRevende: false } });
  assert.equal(off.refundWei, 0n);
});

test('topes de transferencias', () => {
  assert.ok(checkTransferLimits({ amountWei: arsToWei(6000), kind: 'refund', sentTodayWei: 0n, limits }).ok);
  const big = checkTransferLimits({ amountWei: arsToWei(25000), kind: 'refund', sentTodayWei: 0n, limits });
  assert.equal(big.ok, false);
  assert.equal(big.needsOwner, true);
  const daily = checkTransferLimits({ amountWei: arsToWei(6000), kind: 'refund', sentTodayWei: arsToWei(58000), limits });
  assert.equal(daily.needsOwner, true);
  assert.equal(checkTransferLimits({ amountWei: 0n, kind: 'refund', sentTodayWei: 0n, limits }).ok, false);
  assert.ok(checkTransferLimits({ amountWei: arsToWei(250000), kind: 'payout', sentTodayWei: 0n, limits }).ok);
  assert.equal(checkTransferLimits({ amountWei: arsToWei(400000), kind: 'payout', sentTodayWei: 0n, limits }).needsOwner, true);
});

test('el retiro nunca toca plata comprometida', () => {
  const none = decidePayout({ balanceWei: arsToWei(10000), liabilitiesWei: arsToWei(12000), reserveWei: 0n, maxTransferWei: arsToWei(300000) });
  assert.equal(none.amountWei, 0n);
  const some = decidePayout({ balanceWei: arsToWei(30000), liabilitiesWei: arsToWei(12000), reserveWei: arsToWei(1000), maxTransferWei: arsToWei(300000) });
  assert.equal(some.amountWei, arsToWei(17000));
  const capped = decidePayout({ balanceWei: arsToWei(500000), liabilitiesWei: 0n, reserveWei: 0n, maxTransferWei: arsToWei(300000) });
  assert.equal(capped.amountWei, arsToWei(300000));
  assert.equal(capped.rule, 'RETIRO_CON_TOPE');
});
