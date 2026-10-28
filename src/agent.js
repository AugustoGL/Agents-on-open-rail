// El agente: atiende reservas, cobra señas, decide qué hacer con cada cancelación,
// ofrece turnos liberados a la lista de espera y hace el cierre del día.
// Todas las reglas de plata vienen de policy.js; acá se aplican y se registran.
import { newBookingId } from './db.js';
import {
  depositWei, decideCancellation, decideResaleRefund, checkTransferLimits, decidePayout,
} from './policy.js';
import { arsToWei, formatArs } from './money.js';
import {
  localToUtcMs, localDateStr, addDays, formatLocal, formatLocalDay, startOfLocalDay, weekdayOf, isValidDateStr, localTimeStr,
} from './time.js';
import {
  BusinessSettings, deriveBusiness, hoursFor, applyPatch, pickEditable,
} from './settings.js';

const MINUTE = 60_000;
const MAX_HOLDS_PER_CUSTOMER = 2;

export const nullNotifier = {
  async toCustomer() {},
  async toOwner() {},
};

export class SenaAgent {
  /**
   * @param {object} deps
   * @param {import('./db.js').Store} deps.store
   * @param {object} deps.business  contenido de config/negocio.json
   * @param {object} deps.chain     { address, sendWars({to, amountWei}), balanceWei() }
   * @param {{ now(): number }} [deps.clock]
   * @param {object} [deps.notifier] { toCustomer(customerId, text), toOwner(text) }
   * @param {string} [deps.publicBaseUrl]
   * @param {string} [deps.payoutAddress] dirección del dueño para el retiro diario
   * @param {BusinessSettings} [deps.settings] guarda los cambios de configuración (por defecto, en la misma base)
   */
  constructor({ store, business, chain, clock = Date, notifier = nullNotifier, logger = console, publicBaseUrl = 'http://localhost:8402', payoutAddress = null, settings = null }) {
    this.store = store;
    this.business = deriveBusiness(business);
    this.settings = settings ?? new BusinessSettings(store, { now: () => this.now() });
    this.chain = chain;
    this.clock = clock;
    this.notifier = notifier;
    this.logger = logger;
    this.publicBaseUrl = publicBaseUrl.replace(/\/$/, '');
    this.payoutAddress = payoutAddress;
    this._processing = null;
  }

  now() { return this.clock.now(); }
  get offset() { return this.business.utcOffsetMinutos; }
  get policy() { return this.business.politica; }
  get limits() { return this.business.limites; }
  fmt(ms) { return formatLocal(ms, this.offset); }

  log(d) {
    return this.store.logDecision({ at: this.now(), ...d });
  }

  async safeNotify(fn) {
    try { await fn(); } catch (err) { this.logger.warn?.(`[aviso] no se pudo notificar: ${err.message}`); }
  }

  // --- Turnos -------------------------------------------------------------

  /** ¿Es un turno que existe en la grilla del negocio y está dentro del rango reservable? */
  validateSlot(resource, startAt) {
    const b = this.business;
    if (!b.recursos.includes(resource)) {
      return { ok: false, reason: b.recursosTodos.includes(resource) ? `"${resource}" no está disponible por ahora.` : `No existe "${resource}".` };
    }
    const date = localDateStr(startAt, this.offset);
    const valid = hoursFor(b, resource, weekdayOf(date)).some((h) => localToUtcMs(date, h, this.offset) === startAt);
    if (!valid) return { ok: false, reason: 'Ese horario no está en la grilla de turnos.' };
    const now = this.now();
    if (startAt < now + b.anticipacionMinimaMinutos * MINUTE) {
      return { ok: false, reason: `Hay que reservar con al menos ${b.anticipacionMinimaMinutos} minutos de anticipación.` };
    }
    if (startAt > now + b.diasAdelante * 24 * 60 * MINUTE) {
      return { ok: false, reason: `Solo se puede reservar hasta ${b.diasAdelante} días adelante.` };
    }
    return { ok: true };
  }

  /** Lista de turnos de un día local ("YYYY-MM-DD"), con su estado. */
  listSlots({ dateStr, onlyFree = false } = {}) {
    const date = dateStr ?? localDateStr(this.now(), this.offset);
    const weekday = weekdayOf(date);
    const blocks = this.store.blocksOverlapping(localToUtcMs(date, '00:00', this.offset), localToUtcMs(addDays(date, 1), '00:00', this.offset) + this.business.duracionMinutos * MINUTE);
    // Orden: por horario y, dentro del horario, por cancha.
    const entries = [];
    this.business.recursos.forEach((resource, index) => {
      for (const time of hoursFor(this.business, resource, weekday)) entries.push({ resource, index, time });
    });
    entries.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : a.index - b.index));
    const out = [];
    for (const { resource, time } of entries) {
      const startAt = localToUtcMs(date, time, this.offset);
      if (!this.validateSlot(resource, startAt).ok) continue;
      const block = this.blockFor(resource, startAt, blocks);
      const free = !block && !this.store.activeBookingForSlot(resource, startAt);
      if (onlyFree && !free) continue;
      out.push({ resource, startAt, time, free, blocked: Boolean(block), blockReason: block?.reason ?? null, label: `${this.fmt(startAt)} · ${resource}` });
    }
    return out;
  }

  /** Bloqueo vigente que pisa este turno de esta cancha (o null). */
  blockFor(resource, startAt, blocks = null) {
    const end = startAt + this.business.duracionMinutos * MINUTE;
    const list = blocks ?? this.store.blocksOverlapping(startAt, end);
    return list.find((k) => k.from_at < end && k.to_at > startAt && (k.resource === null || k.resource === resource)) ?? null;
  }

  /** Días (locales) en los que se puede reservar. */
  bookableDays() {
    const today = localDateStr(this.now(), this.offset);
    const days = [];
    for (let i = 0; i <= this.business.diasAdelante; i++) {
      const d = addDays(today, i);
      if (this.listSlots({ dateStr: d }).some((s) => !s.blocked)) days.push(d);
    }
    return days;
  }

  depositWei() {
    return depositWei(this.business);
  }

  payUrl(booking) { return `${this.publicBaseUrl}/pagar/${booking.id}`; }
  apiPayUrl(booking) { return `${this.publicBaseUrl}/api/reservas/${booking.id}/pagar`; }

  describe(b) {
    const estados = {
      held: `reservada, falta pagar la seña (vence ${this.fmt(b.hold_expires_at)})`,
      confirmed: 'confirmada',
      cancelled: 'cancelada',
      expired: 'vencida sin pago',
      completed: 'jugada',
    };
    return `${b.id} · ${this.fmt(b.start_at)} · ${b.resource} · seña ${formatArs(b.deposit_wei)} · ${estados[b.status] ?? b.status}`;
  }

  // --- Reservar -------------------------------------------------------------

  ensureCustomer(customer) {
    return this.store.upsertCustomer({
      id: customer.id, name: customer.name, channel: customer.channel,
      wallet: customer.wallet, chat_id: customer.chatId, contact: customer.contact, created_at: this.now(),
    });
  }

  /**
   * Reserva un turno por unos minutos mientras el cliente paga la seña.
   * @returns {{ ok: true, booking } | { ok: false, code: string, reason: string }}
   */
  reserve({ resource, startAt, customer, source = 'directa', holdMinutes }) {
    const v = this.validateSlot(resource, startAt);
    if (!v.ok) return { ok: false, code: 'turno_invalido', reason: v.reason };
    const blocked = this.blockFor(resource, startAt);
    if (blocked) return { ok: false, code: 'bloqueado', reason: `Ese turno no está disponible (${blocked.reason}).` };
    this.ensureCustomer(customer);

    const now = this.now();
    const holds = this.store.bookingsForCustomer(customer.id, { onlyUpcomingFrom: now }).filter((b) => b.status === 'held');
    if (holds.length >= MAX_HOLDS_PER_CUSTOMER) {
      return { ok: false, code: 'muchas_reservas', reason: `Ya tenés ${holds.length} reservas sin pagar. Pagá o cancelá alguna antes de reservar otra.` };
    }
    if (this.store.activeBookingForSlot(resource, startAt)) {
      return { ok: false, code: 'ocupado', reason: 'Ese turno ya está tomado. Podés anotarte en la lista de espera.' };
    }
    const minutes = holdMinutes ?? this.business.reservaSinPagarMinutos;
    let booking;
    for (let attempt = 0; !booking; attempt++) {
      try {
        booking = this.store.insertBooking({
          id: newBookingId(), resource, start_at: startAt, customer_id: customer.id, customer_name: customer.name,
          channel: customer.channel, source, status: 'held', deposit_wei: this.depositWei(),
          hold_expires_at: now + minutes * MINUTE, terms: this.termsNow(), created_at: now,
        });
      } catch (err) {
        if (/bookings\.id/.test(err.message) && attempt < 3) continue; // choque de id: probar otro
        if (/UNIQUE/i.test(err.message)) return { ok: false, code: 'ocupado', reason: 'Ese turno se acaba de tomar. Podés anotarte en la lista de espera.' };
        throw err;
      }
    }
    this.log({
      booking_id: booking.id, kind: 'reserva', rule: source === 'lista_espera' ? 'OFERTA_LISTA_ESPERA' : 'TURNO_LIBRE',
      reason: `Turno libre: ${resource}, ${this.fmt(startAt)}. Se reserva ${minutes} min para pagar la seña de ${formatArs(booking.deposit_wei)}.`,
      data: { customer: customer.id, channel: customer.channel },
    });
    return { ok: true, booking };
  }

  /** Condiciones vigentes: se guardan en cada reserva para que un cambio de configuración no las altere. */
  termsNow() {
    const b = this.business;
    return { politica: { ...b.politica }, precioTurnoArs: b.precioTurnoArs, senaPorcentaje: b.senaPorcentaje, duracionMinutos: b.duracionMinutos };
  }

  /** Política con la que se pagó una reserva (si es una reserva vieja sin copia, la vigente). */
  policyOf(booking) {
    try {
      return JSON.parse(booking.terms)?.politica ?? this.policy;
    } catch {
      return this.policy;
    }
  }

  /** ¿Se puede pagar esta reserva ahora? Lo usa el servidor antes y durante el cobro x402. */
  checkPayable(bookingId) {
    const b = this.store.getBooking(bookingId);
    if (!b) return { ok: false, status: 404, code: 'no_existe', reason: 'No existe esa reserva.' };
    if (b.status === 'confirmed') return { ok: false, status: 409, code: 'ya_pagada', reason: 'Esa reserva ya está pagada.', booking: b };
    if (b.status === 'expired') return { ok: false, status: 410, code: 'vencida', reason: 'Se venció el tiempo para pagar la seña. Reservá de nuevo.', booking: b };
    if (b.status !== 'held') return { ok: false, status: 410, code: 'no_disponible', reason: 'La reserva ya no está activa.', booking: b };
    if (b.hold_expires_at <= this.now()) return { ok: false, status: 410, code: 'vencida', reason: 'Se venció el tiempo para pagar la seña.', booking: b };
    return { ok: true, booking: b };
  }

  /** Un pago que llega apenas vencida la reserva se acepta si nadie más tomó el turno. */
  canAcceptLatePayment(bookingId) {
    const check = this.checkPayable(bookingId);
    if (check.ok) return true;
    if (check.code !== 'vencida') return false;
    const active = this.store.activeBookingForSlot(check.booking.resource, check.booking.start_at);
    return !active || active.id === check.booking.id;
  }

  // --- Cobro ------------------------------------------------------------------

  /**
   * Se llama cuando el facilitador x402 confirmó el cobro en la cadena.
   * Es idempotente: si llega dos veces el mismo pago no hace nada la segunda vez.
   */
  async onPaymentSettled({ bookingId, payer, tx, amountWei }) {
    const now = this.now();
    const amount = BigInt(amountWei);
    const result = this.store.tx(() => {
      const b = this.store.getBooking(bookingId);
      if (b && b.pay_tx === tx) return { kind: 'repetido', booking: b };

      const canConfirm = b && amount === BigInt(b.deposit_wei) && (
        b.status === 'held' ||
        (b.status === 'expired' && !this.store.activeBookingForSlot(b.resource, b.start_at))
      );
      if (canConfirm) {
        const booking = this.store.updateBooking(b.id, {
          status: 'confirmed', payer, pay_tx: tx, paid_at: now, hold_expires_at: null,
        }, now);
        this.log({
          booking_id: b.id, kind: 'cobro', rule: b.status === 'expired' ? 'PAGO_TARDIO_ACEPTADO' : 'SENA_COBRADA',
          reason: `Seña de ${formatArs(amount)} cobrada en wARS. Turno confirmado.` + (b.status === 'expired' ? ' Llegó después del vencimiento pero el turno seguía libre.' : ''),
          data: { payer }, tx,
        });
        if (b.source === 'lista_espera') {
          const w = this.store.waitlistByOfferedBooking(b.id);
          if (w) this.store.updateWaitlist(w.id, { status: 'done' });
        }
        return { kind: 'confirmado', booking };
      }
      // Pago que no corresponde a una reserva pagable: se devuelve completo.
      const reason = !b ? 'El pago no corresponde a ninguna reserva.'
        : amount !== BigInt(b.deposit_wei) ? `El monto pagado (${formatArs(amount)}) no coincide con la seña (${formatArs(b.deposit_wei)}).`
          : b.status === 'confirmed' ? 'La reserva ya estaba pagada (pago duplicado).'
            : 'La reserva ya no estaba disponible cuando llegó el pago.';
      this.log({ booking_id: b?.id ?? null, kind: 'cobro', rule: 'PAGO_A_DEVOLVER', reason: `${reason} Se devuelve todo.`, data: { payer, amountWei: amount }, tx });
      return { kind: 'devolver', booking: b, reason };
    });

    if (result.kind === 'confirmado') {
      const b = result.booking;
      this.queueResaleRefunds(b);
      await this.safeNotify(() => this.notifier.toCustomer(b.customer_id,
        `✅ Listo, tu turno quedó confirmado.\n${this.describe(b)}\nSi necesitás cancelar, usá /cancelar ${b.id}.`, { booking: b }));
      await this.safeNotify(() => this.notifier.toOwner(`💰 Seña cobrada: ${this.describe(b)}\nTx: ${tx}`));
    } else if (result.kind === 'devolver') {
      this.queueTransfer({
        kind: 'refund', booking: result.booking, to: payer, amountWei: amount,
        idemKey: `refund:payment:${tx}`, note: result.reason, rule: 'PAGO_A_DEVOLVER',
      });
      await this.safeNotify(() => this.notifier.toOwner(`↩️ Pago que no correspondía (${result.reason}). Se devuelve ${formatArs(amount)} a ${payer}.`));
    }
    await this.processTransfers();
    return result;
  }

  // --- Cancelar ---------------------------------------------------------------

  /** Qué pasaría si se cancela ahora, sin cancelar nada (para pedir confirmación). */
  previewCancel({ bookingId, customerId, fullRefund = false }) {
    const b = this.store.getBooking(bookingId);
    if (!b) return { ok: false, reason: 'No existe esa reserva.' };
    if (customerId && b.customer_id !== customerId) return { ok: false, reason: 'Esa reserva no es tuya.' };
    if (b.status === 'held') return { ok: true, booking: b, refundWei: 0n, rule: 'SIN_PAGO', reason: 'Todavía no pagaste la seña, así que se cancela sin costo.' };
    if (b.status !== 'confirmed') return { ok: false, reason: 'Esa reserva ya no está activa.' };
    if (fullRefund) {
      const remaining = BigInt(b.deposit_wei) - BigInt(b.refunded_wei);
      return { ok: true, booking: b, refundWei: remaining, rule: 'CANCELADO_POR_COMERCIO', reason: `Cancela el comercio: se devuelve toda la seña (${formatArs(remaining)}).` };
    }
    const d = decideCancellation({ startAt: b.start_at, now: this.now(), paidWei: b.deposit_wei, policy: this.policyOf(b) });
    if (d.rule === 'TURNO_EMPEZADO') return { ok: false, reason: d.reason };
    return { ok: true, booking: b, refundWei: d.refundWei, rule: d.rule, reason: d.reason };
  }

  /**
   * Cancela una reserva. Con by = 'owner' cancela el comercio; con by = 'wallet' cancela quien pagó (ya probó ser dueño de la
   * billetera con una firma); con fullRefund devuelve toda la seña
   * sin aplicar la política (por ejemplo cuando se bloquea un turno ya pagado).
   */
  async cancel({ bookingId, customerId, by = 'customer', fullRefund = false, reason = null }) {
    const now = this.now();
    const b = this.store.getBooking(bookingId);
    if (!b) return { ok: false, reason: 'No existe esa reserva.' };
    if (by === 'customer' && b.customer_id !== customerId) return { ok: false, reason: 'Esa reserva no es tuya.' };
    const because = reason ? ` (${reason})` : '';
    const notifyOwnerCancel = () => (by === 'owner'
      ? this.safeNotify(() => this.notifier.toCustomer(b.customer_id, `❌ El comercio canceló tu turno ${b.id} · ${this.fmt(b.start_at)} · ${b.resource}${because}.`))
      : undefined);

    if (b.status === 'held') {
      this.store.updateBooking(b.id, { status: 'cancelled', cancel_rule: 'SIN_PAGO', hold_expires_at: null }, now);
      this.log({
        booking_id: b.id, kind: 'cancelacion', rule: 'SIN_PAGO',
        reason: by === 'owner' ? `El comercio canceló la reserva antes de que se pagara la seña${because}. No hay plata que devolver.` : 'Se canceló antes de pagar la seña. No hay plata que devolver.',
      });
      if (b.source === 'lista_espera') {
        const w = this.store.waitlistByOfferedBooking(b.id);
        if (w) this.store.updateWaitlist(w.id, { status: 'cancelled' });
      }
      await notifyOwnerCancel();
      await this.offerSlot(b.resource, b.start_at);
      return { ok: true, refundWei: 0n, rule: 'SIN_PAGO', reason: 'Reserva cancelada. No habías pagado nada.' };
    }
    if (b.status !== 'confirmed') return { ok: false, reason: `La reserva ya está ${b.status === 'cancelled' ? 'cancelada' : 'cerrada'}.` };

    let d;
    if (fullRefund) {
      const remaining = BigInt(b.deposit_wei) - BigInt(b.refunded_wei);
      d = {
        refundWei: remaining, rule: 'CANCELADO_POR_COMERCIO', hoursBefore: (b.start_at - now) / 3_600_000, offerToWaitlist: false,
        reason: `El comercio canceló el turno${because}. Se devuelve toda la seña: ${formatArs(remaining)}.`,
      };
    } else {
      d = decideCancellation({ startAt: b.start_at, now, paidWei: b.deposit_wei, policy: this.policyOf(b) });
    }
    if (d.rule === 'TURNO_EMPEZADO') {
      this.log({ booking_id: b.id, kind: 'cancelacion', rule: d.rule, reason: d.reason });
      return { ok: false, reason: d.reason };
    }
    this.store.updateBooking(b.id, { status: 'cancelled', cancel_rule: d.rule }, now);
    this.log({
      booking_id: b.id, kind: 'cancelacion', rule: d.rule, reason: d.reason,
      data: { hoursBefore: Number(d.hoursBefore.toFixed(2)), refundWei: d.refundWei, by },
    });
    let transfer = null;
    if (d.refundWei > 0n) {
      transfer = this.queueTransfer({
        kind: 'refund', booking: b, to: b.payer, amountWei: d.refundWei,
        idemKey: `refund:${b.id}:cancelacion`, note: d.reason, rule: d.rule,
      });
    }
    await this.safeNotify(() => this.notifier.toOwner(`❌ Cancelación ${b.id} (${d.rule}): ${d.reason}`));
    await notifyOwnerCancel();
    if (d.offerToWaitlist) await this.offerSlot(b.resource, b.start_at);
    await this.processTransfers();
    return { ok: true, refundWei: d.refundWei, rule: d.rule, reason: d.reason, transfer };
  }

  /** Si un turno con seña retenida se vuelve a vender, se devuelve lo retenido. */
  queueResaleRefunds(newBooking) {
    for (const old of this.store.cancelledForSlotWithRetention(newBooking.resource, newBooking.start_at)) {
      if (old.id === newBooking.id) continue;
      const d = decideResaleRefund({ paidWei: old.deposit_wei, alreadyRefundedWei: old.refunded_wei, policy: this.policyOf(old) });
      this.log({ booking_id: old.id, kind: 'reventa', rule: d.rule, reason: d.reason, data: { newBooking: newBooking.id } });
      if (d.refundWei > 0n) {
        this.queueTransfer({
          kind: 'refund', booking: old, to: old.payer, amountWei: d.refundWei,
          idemKey: `refund:${old.id}:reventa`, note: d.reason, rule: d.rule,
        });
      }
    }
  }

  // --- Lista de espera ------------------------------------------------------

  joinWaitlist({ resource, startAt, customer }) {
    const v = this.validateSlot(resource, startAt);
    if (!v.ok) return { ok: false, reason: v.reason };
    const blocked = this.blockFor(resource, startAt);
    if (blocked) return { ok: false, code: 'bloqueado', reason: `Ese turno no está disponible (${blocked.reason}).` };
    const active = this.store.activeBookingForSlot(resource, startAt);
    if (!active) return { ok: false, code: 'libre', reason: 'Ese turno está libre: podés reservarlo directamente.' };
    if (active.customer_id === customer.id) return { ok: false, reason: 'Ese turno ya es tuyo.' };
    this.ensureCustomer(customer);
    const { entry, created } = this.store.addWaitlist({
      resource, start_at: startAt, customer_id: customer.id, customer_name: customer.name, channel: customer.channel, created_at: this.now(),
    });
    const position = this.store.waitlistPosition(entry);
    if (created) {
      this.log({ kind: 'lista_espera', rule: 'ANOTADO', reason: `Alguien se anotó en la lista de espera de ${resource}, ${this.fmt(startAt)} (puesto ${position}).`, data: { customer: customer.id } });
    }
    return { ok: true, position, created };
  }

  /** Ofrece un turno libre a la primera persona de la lista de espera. */
  async offerSlot(resource, startAt) {
    if (startAt <= this.now()) return null;
    if (this.store.activeBookingForSlot(resource, startAt)) return null;
    for (;;) {
      const w = this.store.nextWaiting(resource, startAt);
      if (!w) return null;
      const customer = { id: w.customer_id, name: w.customer_name, channel: w.channel };
      const r = this.reserve({ resource, startAt, customer, source: 'lista_espera', holdMinutes: this.policy.ofertaListaEsperaMinutos });
      if (!r.ok) {
        this.store.updateWaitlist(w.id, { status: 'expired' });
        this.log({ kind: 'lista_espera', rule: 'SALTEADO', reason: `No se le pudo ofrecer el turno al siguiente de la lista: ${r.reason}`, data: { customer: w.customer_id } });
        if (['ocupado', 'turno_invalido', 'bloqueado'].includes(r.code)) return null;
        continue;
      }
      this.store.updateWaitlist(w.id, { status: 'offered', offered_booking_id: r.booking.id });
      await this.safeNotify(() => this.notifier.toCustomer(w.customer_id,
        `🎾 Se liberó el turno que esperabas: ${resource}, ${this.fmt(startAt)}.\n` +
        `Te lo guardo ${this.policy.ofertaListaEsperaMinutos} minutos. Seña: ${formatArs(r.booking.deposit_wei)}.\n` +
        `Pagá acá: ${this.payUrl(r.booking)}`, { booking: r.booking, pay: true }));
      return r.booking;
    }
  }

  // --- Tareas periódicas ------------------------------------------------------

  /** Vence reservas sin pagar y ofrece esos turnos a la lista de espera. */
  async expireHolds() {
    const now = this.now();
    const expired = this.store.expiredHolds(now);
    for (const b of expired) {
      this.store.updateBooking(b.id, { status: 'expired' }, now);
      this.log({ booking_id: b.id, kind: 'vencimiento', rule: 'RESERVA_VENCIDA', reason: 'Pasó el tiempo para pagar la seña. Se libera el turno.' });
      if (b.source === 'lista_espera') {
        const w = this.store.waitlistByOfferedBooking(b.id);
        if (w) this.store.updateWaitlist(w.id, { status: 'expired' });
      }
      await this.safeNotify(() => this.notifier.toCustomer(b.customer_id, `⌛ Se venció tu reserva ${b.id} (${this.fmt(b.start_at)}) porque no se pagó la seña a tiempo.`));
      await this.offerSlot(b.resource, b.start_at);
    }
    return expired.length;
  }

  /** Marca como jugados los turnos confirmados que ya terminaron. */
  completeFinished() {
    const now = this.now();
    const done = this.store.finishedConfirmed(now - this.business.duracionMinutos * MINUTE);
    for (const b of done) {
      this.store.updateBooking(b.id, { status: 'completed' }, now);
      this.log({ booking_id: b.id, kind: 'cierre_turno', rule: 'JUGADO', reason: 'El turno terminó. La seña pasa a ser del negocio.' });
    }
    return done.length;
  }

  // --- Salidas de plata ---------------------------------------------------------

  /**
   * Agenda una transferencia de wARS que va a mandar la wallet del agente (con el tag).
   * Aplica los topes: si se pasa, queda esperando la aprobación del dueño.
   */
  queueTransfer({ kind, booking, to, amountWei, idemKey, note, rule }) {
    const now = this.now();
    const amount = BigInt(amountWei);
    if (!to) {
      this.log({ booking_id: booking?.id ?? null, kind: 'transferencia', rule: 'SIN_DESTINO', reason: 'No hay dirección a la que devolver. Lo tiene que resolver el dueño.' });
      this.safeNotify(() => this.notifier.toOwner(`⚠️ Hay que devolver ${formatArs(amount)} de ${booking?.id ?? '¿?'} pero no hay dirección de destino.`));
      return null;
    }
    const sentToday = this.store.refundsSentSince(startOfLocalDay(now, this.offset));
    const lim = checkTransferLimits({ amountWei: amount, kind, sentTodayWei: sentToday, limits: this.limits });
    const status = lim.ok ? 'pending' : 'needs_owner';
    const { transfer, created } = this.store.queueTransfer({
      idem_key: idemKey, kind, booking_id: booking?.id ?? null, to_address: to, amount_wei: amount,
      status, note, created_at: now,
    });
    if (!created) return transfer;
    if (kind === 'refund' && booking) {
      const current = this.store.getBooking(booking.id);
      this.store.updateBooking(booking.id, { refunded_wei: BigInt(current.refunded_wei) + amount }, now);
    }
    if (!lim.ok) {
      this.log({ booking_id: booking?.id ?? null, kind: 'transferencia', rule: 'ESPERA_DUENO', reason: `${lim.reason} Queda esperando que el dueño la apruebe.`, data: { transfer: transfer.id, rule } });
      this.safeNotify(() => this.notifier.toOwner(
        `✋ Necesito tu aprobación para transferir ${formatArs(amount)} (${kind === 'refund' ? 'devolución' : 'retiro'}${booking ? ` de ${booking.id}` : ''}).\n` +
        `Motivo: ${lim.reason}\nAprobá con /aprobar ${transfer.id} o rechazá con /rechazar ${transfer.id}.`));
    }
    return transfer;
  }

  /** Manda las transferencias pendientes. Nunca reintenta una que pudo haber salido. */
  async processTransfers() {
    if (this._processing) return this._processing;
    this._processing = (async () => {
      let sent = 0;
      for (const t of this.store.transfersByStatus('pending')) {
        const now = this.now();
        this.store.updateTransfer(t.id, { status: 'sending' }, now);
        try {
          const { hash } = await this.chain.sendWars({ to: t.to_address, amountWei: BigInt(t.amount_wei) });
          this.store.updateTransfer(t.id, { status: 'sent', tx: hash, error: null }, this.now());
          this.log({
            booking_id: t.booking_id, kind: 'transferencia', rule: t.kind === 'refund' ? 'DEVOLUCION_ENVIADA' : 'RETIRO_ENVIADO',
            reason: `Se enviaron ${formatArs(t.amount_wei)} en wARS a ${t.to_address}.`, tx: hash,
          });
          sent++;
          if (t.kind === 'refund' && t.booking_id) {
            const b = this.store.getBooking(t.booking_id);
            if (b) {
              await this.safeNotify(() => this.notifier.toCustomer(b.customer_id,
                `↩️ Te devolví ${formatArs(t.amount_wei)} en wARS por la reserva ${b.id}.\nMotivo: ${t.note ?? ''}\nTx: ${hash}`));
            }
          }
        } catch (err) {
          const definitelyNotSent = Boolean(err.notSent);
          this.store.updateTransfer(t.id, { status: definitelyNotSent ? 'failed' : 'unknown', error: String(err.message).slice(0, 500) }, this.now());
          this.log({
            booking_id: t.booking_id, kind: 'transferencia', rule: definitelyNotSent ? 'FALLO_SIN_ENVIAR' : 'ESTADO_INCIERTO',
            reason: definitelyNotSent
              ? `No se pudo mandar la transferencia (no salió de la wallet): ${err.message}`
              : `La transferencia pudo haber salido o no. No se reintenta sola: hay que revisarla en el explorador. ${err.message}`,
          });
          await this.safeNotify(() => this.notifier.toOwner(
            `⚠️ Transferencia #${t.id} ${definitelyNotSent ? 'falló sin salir' : 'en estado incierto'}: ${err.message}\n` +
            (definitelyNotSent ? `Reintentá con /aprobar ${t.id} cuando la wallet tenga saldo.` : 'Revisala antes de hacer nada.')));
        }
      }
      return sent;
    })();
    try { return await this._processing; } finally { this._processing = null; }
  }

  /** El dueño aprueba una transferencia retenida por los topes (o reintenta una fallida). */
  async approveTransfer(id) {
    const t = this.store.getTransfer(Number(id));
    if (!t) return { ok: false, reason: 'No existe esa transferencia.' };
    if (!['needs_owner', 'failed'].includes(t.status)) return { ok: false, reason: `La transferencia está "${t.status}", no se puede aprobar.` };
    this.store.updateTransfer(t.id, { status: 'pending' }, this.now());
    this.log({ booking_id: t.booking_id, kind: 'transferencia', rule: 'APROBADA_POR_DUENO', reason: `El dueño aprobó la transferencia #${t.id} de ${formatArs(t.amount_wei)}.` });
    await this.processTransfers();
    return { ok: true, transfer: this.store.getTransfer(t.id) };
  }

  async rejectTransfer(id) {
    const t = this.store.getTransfer(Number(id));
    if (!t) return { ok: false, reason: 'No existe esa transferencia.' };
    if (!['needs_owner', 'failed'].includes(t.status)) return { ok: false, reason: `La transferencia está "${t.status}", no se puede rechazar.` };
    const now = this.now();
    this.store.updateTransfer(t.id, { status: 'rejected' }, now);
    if (t.kind === 'refund' && t.booking_id) {
      const b = this.store.getBooking(t.booking_id);
      if (b) this.store.updateBooking(b.id, { refunded_wei: BigInt(b.refunded_wei) - BigInt(t.amount_wei) }, now);
    }
    this.log({ booking_id: t.booking_id, kind: 'transferencia', rule: 'RECHAZADA_POR_DUENO', reason: `El dueño rechazó la transferencia #${t.id}.` });
    return { ok: true };
  }

  // --- Cierre del día -----------------------------------------------------------

  /** Plata que el agente sabe que debe o que todavía podría tener que devolver. */
  committedWei() {
    const now = this.now();
    const owed = ['pending', 'needs_owner', 'sending', 'unknown', 'failed']
      .flatMap((s) => this.store.transfersByStatus(s))
      .reduce((acc, t) => acc + BigInt(t.amount_wei), 0n);
    return {
      futureDeposits: this.store.liabilitiesWei(now),
      retained: this.store.retainedWei(now),
      owedTransfers: owed,
    };
  }

  /** Resumen del día y, si corresponde, retiro de lo que ya es del negocio. */
  async dailyClose({ dateStr } = {}) {
    const now = this.now();
    const day = dateStr ?? localDateStr(now, this.offset);
    const from = localToUtcMs(day, '00:00', this.offset);
    const to = localToUtcMs(addDays(day, 1), '00:00', this.offset);
    const decisions = this.store.decisionsBetween(from, to);
    const count = (rule) => decisions.filter((d) => d.rule === rule).length;
    const cobros = decisions.filter((d) => d.kind === 'cobro' && d.rule !== 'PAGO_A_DEVOLVER');
    const transfers = this.store.transfersBetween(from, to);
    const refunded = transfers.filter((t) => t.kind === 'refund' && t.status === 'sent').reduce((a, t) => a + BigInt(t.amount_wei), 0n);
    const collected = cobros.reduce((acc, d) => {
      const b = d.booking_id ? this.store.getBooking(d.booking_id) : null;
      return acc + (b ? BigInt(b.deposit_wei) : 0n);
    }, 0n);

    const balance = await this.chain.balanceWei();
    const c = this.committedWei();
    const liabilities = c.futureDeposits + c.retained + c.owedTransfers;
    const reserve = arsToWei(this.business.cierre?.reservaMinimaArs ?? 0);
    const p = decidePayout({ balanceWei: balance, liabilitiesWei: liabilities, reserveWei: reserve, maxTransferWei: arsToWei(this.limits.transferenciaMaxArs) });

    let payoutLine = `Retiro: ${p.reason}`;
    if (p.amountWei > 0n) {
      if (!this.payoutAddress) {
        payoutLine += ' No hay dirección de retiro configurada (OWNER_PAYOUT_ADDRESS), así que no se transfiere nada.';
      } else {
        const t = this.queueTransfer({ kind: 'payout', to: this.payoutAddress, amountWei: p.amountWei, idemKey: `payout:${day}`, note: p.reason, rule: p.rule });
        payoutLine += t ? ` Transferencia #${t.id} a ${this.payoutAddress}.` : '';
      }
    }
    this.log({ kind: 'cierre', rule: p.rule, reason: p.reason, data: { day, balance, liabilities, collected, refunded } });

    const report = [
      `📊 Cierre del ${day} — ${this.business.nombre}`,
      `Señas cobradas: ${cobros.length} (${formatArs(collected)})`,
      `Devoluciones enviadas: ${formatArs(refunded)}`,
      `Cancelaciones: a tiempo ${count('A_TIEMPO')}, parciales ${count('TARDE_PARCIAL')}, tardías ${count('MUY_TARDE')}, sin pago ${count('SIN_PAGO')}`,
      `Reservas vencidas: ${count('RESERVA_VENCIDA')} · Turnos reubicados desde la lista de espera: ${count('OFERTA_LISTA_ESPERA')}`,
      `Saldo de la wallet: ${formatArs(balance)} · Comprometido: ${formatArs(liabilities)}`,
      payoutLine,
    ].join('\n');
    this.store.setSetting('ultimo_cierre', { at: now, day, report }, now);
    await this.safeNotify(() => this.notifier.toOwner(report));
    await this.processTransfers();
    return { report, payout: p };
  }

  // --- Configuración y bloqueos (panel del comercio) ------------------------------

  /**
   * Cambia la configuración del negocio. Solo se pueden tocar los campos editables; todo se valida y
   * cada cambio queda registrado. Vale para reservas nuevas: las existentes conservan sus condiciones.
   * @returns {{ ok: true, business, changes } | { ok: false, errors: {campo, mensaje}[] }}
   */
  updateSettings(patch, { actor = 'panel', ip = null } = {}) {
    const { picked, errors } = pickEditable(patch);
    if (errors.length) return { ok: false, errors };
    const merged = applyPatch(this.business, picked);
    const res = this.settings.save(merged, { previous: this.business, actor: ip ? `${actor} (${ip})` : actor });
    if (!res.ok) return res;
    this.business = res.business;
    if (res.changes.length) {
      this.log({
        kind: 'configuracion', rule: 'CONFIGURACION_CAMBIADA',
        reason: `El comercio cambió su configuración (${res.changes.map((c) => c.field).join(', ')}). Vale para reservas nuevas; las ya pagadas conservan sus condiciones.`,
      });
    }
    return res;
  }

  /** Reservas vigentes (esperando pago o confirmadas) que quedan dentro de un bloqueo. */
  bookingsAffectedBy(block) {
    const dur = this.business.duracionMinutos * MINUTE;
    return this.store.activeBookingsBetween(block.from_at - dur, block.to_at)
      .filter((b) => b.start_at + dur > block.from_at && (block.resource === null || b.resource === block.resource));
  }

  /**
   * Bloquea un turno, una cancha (uno o varios días) o un día entero.
   * @param {{ tipo: 'turno'|'recurso'|'dia', recurso?: string, fecha: string, hasta?: string, hora?: string, motivo: string }} input
   * @returns {{ ok: true, block, affected: object[] } | { ok: false, errors }}
   */
  createBlock({ tipo, recurso, fecha, hasta, hora, motivo } = {}, { actor = 'panel', ip = null } = {}) {
    const errors = [];
    const err = (campo, mensaje) => errors.push({ campo, mensaje });
    const reason = String(motivo ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!reason) err('motivo', 'Contá el motivo del bloqueo: lo ven los clientes.');
    else if (reason.length > 120) err('motivo', 'El motivo puede tener hasta 120 caracteres.');
    if (!['turno', 'recurso', 'dia'].includes(tipo)) err('tipo', 'El bloqueo es de un turno, de una cancha o de un día entero.');
    if (!isValidDateStr(fecha)) err('fecha', 'La fecha no es válida (usá el calendario).');
    let last = fecha;
    if (hasta !== undefined && hasta !== null && hasta !== '') {
      if (!isValidDateStr(hasta)) err('hasta', 'La fecha "hasta" no es válida.');
      else if (isValidDateStr(fecha) && hasta < fecha) err('hasta', 'La fecha "hasta" no puede ser anterior a "desde".');
      else if (isValidDateStr(fecha) && hasta > addDays(fecha, 366)) err('hasta', 'Un bloqueo puede durar hasta un año.');
      else last = hasta;
    }
    if (tipo === 'turno' || tipo === 'recurso') {
      if (!this.business.recursosTodos.includes(recurso)) err('recurso', 'Elegí una cancha de la lista.');
    }
    let from; let to;
    if (errors.length === 0) {
      if (tipo === 'turno') {
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(hora))) err('hora', 'Elegí el horario del turno.');
        else if (!hoursFor(this.business, recurso, weekdayOf(fecha)).includes(hora)) err('hora', `A las ${hora} no hay turno en ${recurso} ese día.`);
        else { from = localToUtcMs(fecha, hora, this.offset); to = from + this.business.duracionMinutos * MINUTE; }
      } else {
        from = localToUtcMs(fecha, '00:00', this.offset);
        to = localToUtcMs(addDays(last, 1), '00:00', this.offset);
      }
      if (errors.length === 0 && to <= this.now()) err('fecha', 'Ese bloqueo ya pasó.');
    }
    if (errors.length) return { ok: false, errors };

    const block = this.store.insertBlock({
      kind: tipo, resource: tipo === 'dia' ? null : recurso, from_at: from, to_at: to, reason,
      created_at: this.now(), created_by: ip ? `${actor} (${ip})` : actor,
    });
    const scope = tipo === 'turno' ? `el turno de ${recurso} del ${this.fmt(from)}`
      : `${tipo === 'recurso' ? recurso : 'todas las canchas'} ${last === fecha ? `el ${fecha}` : `del ${fecha} al ${last}`}`;
    const affected = this.bookingsAffectedBy(block);
    this.log({
      kind: 'bloqueo', rule: 'BLOQUEO_CREADO',
      reason: `El comercio bloqueó ${scope}.${affected.length ? ` Hay ${affected.length} reserva(s) adentro que el comercio tiene que resolver.` : ''}`,
    });
    return { ok: true, block, affected };
  }

  removeBlock(id) {
    const block = this.store.getBlock(Number(id));
    if (!block || block.removed_at) return { ok: false, reason: 'No existe ese bloqueo.' };
    this.store.removeBlock(block.id, this.now());
    this.log({ kind: 'bloqueo', rule: 'BLOQUEO_QUITADO', reason: `El comercio quitó un bloqueo (${block.kind}). Esos turnos vuelven a estar disponibles.` });
    return { ok: true };
  }

  /** Cancela con devolución total las reservas que quedaron dentro de un bloqueo. Pasa por el mismo agente (topes y decisiones). */
  async cancelBlockedBookings(blockId) {
    const block = this.store.getBlock(Number(blockId));
    if (!block || block.removed_at) return { ok: false, reason: 'No existe ese bloqueo.' };
    const results = [];
    for (const b of this.bookingsAffectedBy(block)) {
      const r = await this.cancel({ bookingId: b.id, by: 'owner', fullRefund: true, reason: block.reason });
      results.push({ id: b.id, ok: r.ok, devolucion: formatArs(r.refundWei ?? 0n), motivo: r.reason });
    }
    return { ok: true, results };
  }

  // --- Vistas para el panel -------------------------------------------------------

  /** Una reserva con los datos que ve el dueño (nombre y contacto incluidos). */
  bookingSummary(b) {
    const customer = this.store.getCustomer(b.customer_id);
    return {
      id: b.id, recurso: b.resource, inicio: new Date(b.start_at).toISOString(), inicioLocal: this.fmt(b.start_at),
      estado: b.status, origen: b.source, canal: b.channel, cliente: b.customer_name ?? null, contacto: customer?.contact ?? b.customer_contact ?? null,
      sena: { texto: formatArs(b.deposit_wei), wei: String(b.deposit_wei) }, devuelto: { texto: formatArs(b.refunded_wei), wei: String(b.refunded_wei) },
      pagador: b.payer ?? null, pagoTx: b.pay_tx ?? null, venceEl: b.hold_expires_at ? new Date(b.hold_expires_at).toISOString() : null,
      reglaCancelacion: b.cancel_rule ?? null,
    };
  }

  listBookings({ estado, fecha, desde, hasta, q, limite = 100 } = {}) {
    let fromMs; let toMs;
    if (fecha && isValidDateStr(fecha)) { fromMs = localToUtcMs(fecha, '00:00', this.offset); toMs = localToUtcMs(addDays(fecha, 1), '00:00', this.offset); }
    if (desde && isValidDateStr(desde)) fromMs = localToUtcMs(desde, '00:00', this.offset);
    if (hasta && isValidDateStr(hasta)) toMs = localToUtcMs(addDays(hasta, 1), '00:00', this.offset);
    return this.store.searchBookings({ status: estado || undefined, fromMs, toMs, q: q || undefined, limit: Math.min(Number(limite) || 100, 300) })
      .map((b) => this.bookingSummary(b));
  }

  /** Calendario propio de un día, por cancha, con el estado de cada turno (libre, esperando pago, confirmado o bloqueado). */
  ownerDay(dateStr) {
    const date = dateStr;
    const weekday = weekdayOf(date);
    const dur = this.business.duracionMinutos * MINUTE;
    const dayStart = localToUtcMs(date, '00:00', this.offset);
    const dayEnd = localToUtcMs(addDays(date, 1), '00:00', this.offset);
    const bookings = this.store.activeBookingsBetween(dayStart, dayEnd);
    const blocks = this.store.blocksOverlapping(dayStart - dur, dayEnd);
    const now = this.now();
    const used = new Set();
    const byName = new Map();
    const resourceEntry = (nombre) => {
      if (!byName.has(nombre)) byName.set(nombre, { nombre, activa: this.business.recursos.includes(nombre), turnos: [] });
      return byName.get(nombre);
    };
    for (const nombre of this.business.recursos) resourceEntry(nombre);
    const cell = (resource, startAt, hora, booking, extra = {}) => {
      const block = this.blockFor(resource, startAt, blocks);
      return {
        hora, startAt, inicio: new Date(startAt).toISOString(),
        estado: booking ? (booking.status === 'confirmed' ? 'confirmado' : 'esperando_pago') : block ? 'bloqueado' : 'libre',
        pasado: startAt + dur <= now,
        reserva: booking ? this.bookingSummary(booking) : null,
        bloqueo: block ? { id: block.id, motivo: block.reason, tipo: block.kind } : null,
        ...extra,
      };
    };
    for (const nombre of this.business.recursos) {
      for (const hora of hoursFor(this.business, nombre, weekday)) {
        const startAt = localToUtcMs(date, hora, this.offset);
        const booking = bookings.find((x) => x.resource === nombre && x.start_at === startAt) ?? null;
        if (booking) used.add(booking.id);
        resourceEntry(nombre).turnos.push(cell(nombre, startAt, hora, booking));
      }
    }
    // Reservas que ya no caen en la grilla actual (por ejemplo, si se cambiaron los horarios): no se esconden.
    for (const booking of bookings) {
      if (used.has(booking.id)) continue;
      resourceEntry(booking.resource).turnos.push(cell(booking.resource, booking.start_at, localTimeStr(booking.start_at, this.offset), booking, { fueraDeGrilla: true }));
    }
    const recursos = [...byName.values()];
    for (const r of recursos) r.turnos.sort((a, b) => a.startAt - b.startAt);
    return { fecha: date, etiqueta: formatLocalDay(dayStart + 12 * 3_600_000, this.offset), recursos };
  }

  /** Números del día para el panel: señas cobradas, devoluciones, saldo y lo comprometido. */
  async daySummary({ dateStr } = {}) {
    const now = this.now();
    const day = dateStr ?? localDateStr(now, this.offset);
    const from = localToUtcMs(day, '00:00', this.offset);
    const to = localToUtcMs(addDays(day, 1), '00:00', this.offset);
    const decisions = this.store.decisionsBetween(from, to);
    const cobros = decisions.filter((d) => d.kind === 'cobro' && d.rule !== 'PAGO_A_DEVOLVER');
    const collected = cobros.reduce((acc, d) => {
      const b = d.booking_id ? this.store.getBooking(d.booking_id) : null;
      return acc + (b ? BigInt(b.deposit_wei) : 0n);
    }, 0n);
    const refunds = this.store.transfersBetween(from, to).filter((t) => t.kind === 'refund' && t.status === 'sent');
    const refunded = refunds.reduce((a, t) => a + BigInt(t.amount_wei), 0n);
    const c = this.committedWei();
    const balance = await this.chain.balanceWei();
    const money = (wei) => ({ texto: formatArs(wei), wei: String(wei) });
    return {
      fecha: day,
      turnos: this.store.activeBookingsBetween(from, to).map((b) => this.bookingSummary(b)),
      cobradas: { cantidad: cobros.length, total: money(collected) },
      devoluciones: { cantidad: refunds.length, total: money(refunded) },
      saldo: money(balance),
      comprometido: { senasFuturas: money(c.futureDeposits), retenido: money(c.retained), transferenciasPorSalir: money(c.owedTransfers), total: money(c.futureDeposits + c.retained + c.owedTransfers) },
      pendientes: this.store.transfersByStatus('needs_owner').length + this.store.transfersByStatus('failed').length + this.store.transfersByStatus('unknown').length,
      listaDeEspera: this.store.waitingCount(),
    };
  }

  /** El último cierre del día que se hizo (o null). */
  lastClosing() {
    return this.store.getSetting('ultimo_cierre');
  }

  /** Lo que ve el dueño con /hoy. */
  todaySummary() {
    const now = this.now();
    const day = localDateStr(now, this.offset);
    const from = localToUtcMs(day, '00:00', this.offset);
    const rows = this.store.activeBookingsBetween(from, localToUtcMs(addDays(day, 1), '00:00', this.offset));
    if (rows.length === 0) return `Hoy (${day}) no hay turnos reservados.`;
    return [`Turnos de hoy (${day}):`, ...rows.map((b) => `• ${this.describe(b)} — ${b.customer_name ?? b.customer_id}`)].join('\n');
  }
}
