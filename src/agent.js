// El agente: atiende reservas, cobra señas, decide qué hacer con cada cancelación,
// ofrece turnos liberados a la lista de espera y hace el cierre del día.
// Todas las reglas de plata vienen de policy.js; acá se aplican y se registran.
import { newBookingId } from './db.js';
import {
  depositWei, decideCancellation, decideResaleRefund, checkTransferLimits, decidePayout,
} from './policy.js';
import { arsToWei, formatArs } from './money.js';
import {
  localToUtcMs, localDateStr, addDays, formatLocal, startOfLocalDay,
} from './time.js';
import { LocalAgenda, slotIsFreeIn } from './agenda.js';

const MINUTE = 60_000;
const MAX_HOLDS_PER_CUSTOMER = 2;
export const AGENDA_DOWN_MESSAGE = 'No puedo ver el calendario del comercio en este momento, así que no confirmo ni cobro nada. Probá de nuevo en unos minutos.';

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
   * @param {object} [deps.agenda] fuente de agenda (ver agenda.js); por defecto la grilla propia en SQLite
   */
  constructor({ store, business, chain, clock = Date, notifier = nullNotifier, logger = console, publicBaseUrl = 'http://localhost:8402', payoutAddress = null, agenda = new LocalAgenda() }) {
    this.agenda = agenda;
    this.store = store;
    this.business = business;
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
    if (!b.recursos.includes(resource)) return { ok: false, reason: `No existe "${resource}".` };
    const date = localDateStr(startAt, this.offset);
    const valid = b.horarios.some((h) => localToUtcMs(date, h, this.offset) === startAt);
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
    const out = [];
    for (const h of this.business.horarios) {
      const startAt = localToUtcMs(date, h, this.offset);
      for (const resource of this.business.recursos) {
        if (!this.validateSlot(resource, startAt).ok) continue;
        const free = !this.store.activeBookingForSlot(resource, startAt);
        if (onlyFree && !free) continue;
        out.push({ resource, startAt, time: h, free, label: `${this.fmt(startAt)} · ${resource}` });
      }
    }
    return out;
  }

  /** Días (locales) en los que se puede reservar. */
  bookableDays() {
    const today = localDateStr(this.now(), this.offset);
    const days = [];
    for (let i = 0; i <= this.business.diasAdelante; i++) {
      const d = addDays(today, i);
      if (this.listSlots({ dateStr: d }).length > 0) days.push(d);
    }
    return days;
  }

  // --- Agenda externa (Google Calendar) ----------------------------------------
  // Con la agenda local (por defecto) estas funciones devuelven lo mismo que las síncronas de arriba.
  // Con una agenda externa consultan el calendario del comercio, y si no se puede leer, fallan
  // de forma segura: AgendaError al listar, y código "agenda_no_disponible" al reservar o cobrar.

  /** Turnos de un día, descontando lo que ya ocupa el calendario del comercio. Tira AgendaError si no se puede leer. */
  async listSlotsChecked({ dateStr, onlyFree = false } = {}) {
    const slots = this.listSlots({ dateStr, onlyFree: false });
    if (this.agenda.external && slots.length > 0) {
      const events = await this.agenda.events({ fromMs: Math.min(...slots.map((s) => s.startAt)), toMs: Math.max(...slots.map((s) => s.startAt)) + this.business.duracionMinutos * MINUTE });
      for (const s of slots) {
        if (s.free && !this.slotFreeIn(events, s.resource, s.startAt)) { s.free = false; s.agendaBusy = true; }
      }
    }
    return onlyFree ? slots.filter((s) => s.free) : slots;
  }

  slotFreeIn(events, resource, startAt, ignoreBookingId = null) {
    return slotIsFreeIn(ignoreBookingId ? events.filter((e) => e.bookingId !== ignoreBookingId) : events, {
      resource, startAt, durationMin: this.business.duracionMinutos, resources: this.business.recursos,
    });
  }

  /** Lee el calendario justo para un turno. Tira AgendaError si no se puede. */
  async slotFreeInAgenda(resource, startAt, ignoreBookingId = null) {
    if (!this.agenda.external) return true;
    const events = await this.agenda.events({ fromMs: startAt, toMs: startAt + this.business.duracionMinutos * MINUTE });
    return this.slotFreeIn(events, resource, startAt, ignoreBookingId);
  }

  /** Como reserve(), pero antes mira que el calendario del comercio tenga libre ese turno. */
  async reserveChecked(args) {
    if (this.agenda.external) {
      const v = this.validateSlot(args.resource, args.startAt);
      if (!v.ok) return { ok: false, code: 'turno_invalido', reason: v.reason };
      // Si el turno ya lo tiene una reserva de Seña, que responda reserve() ("ocupado", con lista de espera).
      if (!this.store.activeBookingForSlot(args.resource, args.startAt)) {
        try {
          if (!(await this.slotFreeInAgenda(args.resource, args.startAt))) {
            return { ok: false, code: 'ocupado_agenda', reason: 'Ese turno ya está ocupado en la agenda del comercio. Elegí otro.' };
          }
        } catch (err) {
          return this.agendaDown('reservar', err);
        }
      }
    }
    return this.reserve(args);
  }

  /** Como joinWaitlist(), pero distingue un turno ocupado en el calendario (sin lista de espera) de uno libre. */
  async joinWaitlistChecked(args) {
    if (this.agenda.external && !this.store.activeBookingForSlot(args.resource, args.startAt) && this.validateSlot(args.resource, args.startAt).ok) {
      try {
        if (!(await this.slotFreeInAgenda(args.resource, args.startAt))) {
          return { ok: false, code: 'ocupado_agenda', reason: 'Ese turno lo ocupa la agenda del comercio, no una reserva mía, así que no hay lista de espera. Elegí otro.' };
        }
      } catch (err) {
        return this.agendaDown('anotarte en la lista de espera', err);
      }
    }
    return this.joinWaitlist(args);
  }

  agendaDown(what, err) {
    this.logger.warn?.(`[agenda] no se pudo ${what}: ${err.message}`);
    this.log({ kind: 'agenda', rule: 'AGENDA_NO_DISPONIBLE', reason: `No se pudo leer el calendario al intentar ${what}: ${err.message} No se confirma ni se cobra nada.` });
    return { ok: false, code: 'agenda_no_disponible', reason: AGENDA_DOWN_MESSAGE };
  }

  /**
   * Última barrera antes de cobrar: el turno tiene que seguir libre en el calendario del comercio.
   * Si el calendario no responde, no se cobra.
   * @returns {Promise<{ ok: true } | { ok: false, status: number, code: string, reason: string }>}
   */
  async checkAgendaForPayment(booking) {
    if (!this.agenda.external || !booking) return { ok: true };
    try {
      if (await this.slotFreeInAgenda(booking.resource, booking.start_at, booking.id)) return { ok: true };
    } catch (err) {
      const r = this.agendaDown('cobrar una seña', err);
      return { ok: false, status: 503, code: r.code, reason: r.reason };
    }
    this.log({
      booking_id: booking.id, kind: 'agenda', rule: 'TURNO_OCUPADO_EN_AGENDA',
      reason: 'El comercio ocupó ese turno en su calendario mientras se pagaba. No se cobra.',
    });
    return { ok: false, status: 409, code: 'ocupado_agenda', reason: 'Ese turno acaba de ocuparse en la agenda del comercio. No se cobró nada: elegí otro.' };
  }

  eventFor(b) {
    return {
      title: `${b.resource} · ${b.customer_name ?? 'Cliente'} (seña pagada)`,
      description: `Reserva ${b.id}. Seña de ${formatArs(b.deposit_wei)} cobrada en wARS por Seña.`,
      startAt: b.start_at,
      endAt: b.start_at + this.business.duracionMinutos * MINUTE,
    };
  }

  /** Borra el evento de una reserva cancelada. Si falla, el turno queda bloqueado (seguro) y se reintenta solo. */
  async releaseEvent(b, { quiet = false } = {}) {
    if (!this.agenda.external) return true;
    try {
      await this.agenda.release(b.id);
      this.log({ booking_id: b.id, kind: 'agenda', rule: 'EVENTO_BORRADO', reason: 'Se borró el turno del calendario del comercio.' });
      return true;
    } catch (err) {
      this.log({ booking_id: b.id, kind: 'agenda', rule: 'AGENDA_PENDIENTE', reason: `No pude borrar el turno del calendario (${err.message}). El turno sigue bloqueado y lo reintento solo.` });
      if (!quiet) await this.safeNotify(() => this.notifier.toOwner(`⚠️ Se canceló ${b.id} pero no pude borrarlo del calendario (${err.message}). Lo reintento solo; si ves el evento, podés borrarlo a mano.`));
      return false;
    }
  }

  /** Borra del calendario los eventos de reservas que ya están canceladas (por ejemplo, si Google estaba caído al cancelar). */
  async reconcileAgenda() {
    if (!this.agenda.external) return { removed: 0 };
    const now = this.now();
    const events = await this.agenda.events({ fromMs: now - 24 * 60 * MINUTE, toMs: now + (this.business.diasAdelante + 1) * 24 * 60 * MINUTE });
    let removed = 0;
    for (const ev of events) {
      if (!ev.bookingId) continue;
      const b = this.store.getBooking(ev.bookingId);
      // Solo las canceladas: una reserva en curso puede tener el evento recién creado sin confirmar todavía.
      if (b?.status !== 'cancelled') continue;
      if (await this.releaseEvent(b, { quiet: true })) removed++;
    }
    return { removed };
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
      wallet: customer.wallet, chat_id: customer.chatId, created_at: this.now(),
    });
  }

  /**
   * Reserva un turno por unos minutos mientras el cliente paga la seña.
   * @returns {{ ok: true, booking } | { ok: false, code: string, reason: string }}
   */
  reserve({ resource, startAt, customer, source = 'directa', holdMinutes }) {
    const v = this.validateSlot(resource, startAt);
    if (!v.ok) return { ok: false, code: 'turno_invalido', reason: v.reason };
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
          hold_expires_at: now + minutes * MINUTE, created_at: now,
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

    // Con agenda externa, el turno se anota en el calendario ANTES de confirmarlo en la base.
    // Si no se puede anotar, la reserva no se confirma y se devuelve todo (el cobro ya salió).
    let agendaFailure = null;
    let eventWritten = false;
    if (this.agenda.external) {
      const pre = this.store.getBooking(bookingId);
      if (pre && pre.pay_tx !== tx && this.canConfirmPayment(pre, amount)) {
        try {
          await this.agenda.confirm(pre, this.eventFor(pre));
          eventWritten = true;
        } catch (err) {
          agendaFailure = err;
        }
      }
    }

    const result = this.store.tx(() => {
      const b = this.store.getBooking(bookingId);
      if (b && b.pay_tx === tx) return { kind: 'repetido', booking: b };

      if (!agendaFailure && this.canConfirmPayment(b, amount)) {
        const booking = this.store.updateBooking(b.id, {
          status: 'confirmed', payer, pay_tx: tx, paid_at: now, hold_expires_at: null,
        }, now);
        this.log({
          booking_id: b.id, kind: 'cobro', rule: b.status === 'expired' ? 'PAGO_TARDIO_ACEPTADO' : 'SENA_COBRADA',
          reason: `Seña de ${formatArs(amount)} cobrada en wARS. Turno confirmado.` + (b.status === 'expired' ? ' Llegó después del vencimiento pero el turno seguía libre.' : '') +
            (eventWritten ? ' Anotado en el calendario del comercio.' : ''),
          data: { payer }, tx,
        });
        if (b.source === 'lista_espera') {
          const w = this.store.waitlistByOfferedBooking(b.id);
          if (w) this.store.updateWaitlist(w.id, { status: 'done' });
        }
        return { kind: 'confirmado', booking };
      }
      // Pago que no corresponde a una reserva pagable: se devuelve completo.
      const reason = agendaFailure ? `No pude anotar el turno en el calendario del comercio (${agendaFailure.message}).`
        : !b ? 'El pago no corresponde a ninguna reserva.'
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
    // Si se escribió un evento pero la reserva no se confirmó, el evento sobra: se borra (si falla, reconcileAgenda lo limpia).
    // Nunca si la reserva quedó confirmada (otro pago concurrente la confirmó y el evento es el suyo).
    if (result.kind === 'devolver' && (eventWritten || agendaFailure) && result.booking
      && this.store.getBooking(result.booking.id)?.status !== 'confirmed') {
      try { await this.agenda.release(result.booking.id); } catch { /* lo limpia reconcileAgenda si la reserva quedó cancelada */ }
    }
    return result;
  }

  /** ¿Este pago confirma esta reserva? (monto exacto y turno todavía libre) */
  canConfirmPayment(b, amount) {
    return Boolean(b) && amount === BigInt(b.deposit_wei) && (
      b.status === 'held' ||
      (b.status === 'expired' && !this.store.activeBookingForSlot(b.resource, b.start_at))
    );
  }

  // --- Cancelar ---------------------------------------------------------------

  /** Qué pasaría si se cancela ahora, sin cancelar nada (para pedir confirmación). */
  previewCancel({ bookingId, customerId }) {
    const b = this.store.getBooking(bookingId);
    if (!b) return { ok: false, reason: 'No existe esa reserva.' };
    if (customerId && b.customer_id !== customerId) return { ok: false, reason: 'Esa reserva no es tuya.' };
    if (b.status === 'held') return { ok: true, booking: b, refundWei: 0n, rule: 'SIN_PAGO', reason: 'Todavía no pagaste la seña, así que se cancela sin costo.' };
    if (b.status !== 'confirmed') return { ok: false, reason: 'Esa reserva ya no está activa.' };
    const d = decideCancellation({ startAt: b.start_at, now: this.now(), paidWei: b.deposit_wei, policy: this.policy });
    if (d.rule === 'TURNO_EMPEZADO') return { ok: false, reason: d.reason };
    return { ok: true, booking: b, refundWei: d.refundWei, rule: d.rule, reason: d.reason };
  }

  async cancel({ bookingId, customerId, by = 'customer' }) {
    const now = this.now();
    const b = this.store.getBooking(bookingId);
    if (!b) return { ok: false, reason: 'No existe esa reserva.' };
    if (by === 'customer' && b.customer_id !== customerId) return { ok: false, reason: 'Esa reserva no es tuya.' };

    if (b.status === 'held') {
      this.store.updateBooking(b.id, { status: 'cancelled', cancel_rule: 'SIN_PAGO', hold_expires_at: null }, now);
      this.log({ booking_id: b.id, kind: 'cancelacion', rule: 'SIN_PAGO', reason: 'Se canceló antes de pagar la seña. No hay plata que devolver.' });
      if (b.source === 'lista_espera') {
        const w = this.store.waitlistByOfferedBooking(b.id);
        if (w) this.store.updateWaitlist(w.id, { status: 'cancelled' });
      }
      await this.offerSlot(b.resource, b.start_at);
      return { ok: true, refundWei: 0n, rule: 'SIN_PAGO', reason: 'Reserva cancelada. No habías pagado nada.' };
    }
    if (b.status !== 'confirmed') return { ok: false, reason: `La reserva ya está ${b.status === 'cancelled' ? 'cancelada' : 'cerrada'}.` };

    const d = decideCancellation({ startAt: b.start_at, now, paidWei: b.deposit_wei, policy: this.policy });
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
    await this.releaseEvent(b);
    if (d.offerToWaitlist) await this.offerSlot(b.resource, b.start_at);
    await this.processTransfers();
    return { ok: true, refundWei: d.refundWei, rule: d.rule, reason: d.reason, transfer };
  }

  /** Si un turno con seña retenida se vuelve a vender, se devuelve lo retenido. */
  queueResaleRefunds(newBooking) {
    for (const old of this.store.cancelledForSlotWithRetention(newBooking.resource, newBooking.start_at)) {
      if (old.id === newBooking.id) continue;
      const d = decideResaleRefund({ paidWei: old.deposit_wei, alreadyRefundedWei: old.refunded_wei, policy: this.policy });
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
        if (r.code === 'ocupado' || r.code === 'turno_invalido') return null;
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
    await this.safeNotify(() => this.notifier.toOwner(report));
    await this.processTransfers();
    return { report, payout: p };
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
