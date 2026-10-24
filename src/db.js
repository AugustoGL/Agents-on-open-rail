// Base de datos local (SQLite incluido en Node 22, sin dependencias extra).
// Los montos se guardan como texto en wei para no perder precisión.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  resource TEXT NOT NULL,
  start_at INTEGER NOT NULL,
  customer_id TEXT NOT NULL,
  customer_name TEXT,
  channel TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'directa',
  status TEXT NOT NULL,
  deposit_wei TEXT NOT NULL,
  hold_expires_at INTEGER,
  payer TEXT,
  pay_tx TEXT,
  paid_at INTEGER,
  refunded_wei TEXT NOT NULL DEFAULT '0',
  cancel_rule TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
-- Un mismo turno no puede estar reservado o confirmado dos veces.
CREATE UNIQUE INDEX IF NOT EXISTS uq_slot_active
  ON bookings(resource, start_at) WHERE status IN ('held', 'confirmed');
CREATE INDEX IF NOT EXISTS ix_bookings_customer ON bookings(customer_id);

CREATE TABLE IF NOT EXISTS waitlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  resource TEXT NOT NULL,
  start_at INTEGER NOT NULL,
  customer_id TEXT NOT NULL,
  customer_name TEXT,
  channel TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'waiting',
  offered_booking_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_waitlist_customer
  ON waitlist(resource, start_at, customer_id) WHERE status IN ('waiting', 'offered');

CREATE TABLE IF NOT EXISTS decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  booking_id TEXT,
  kind TEXT NOT NULL,
  rule TEXT NOT NULL,
  reason TEXT NOT NULL,
  data TEXT,
  tx TEXT
);

CREATE TABLE IF NOT EXISTS transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  idem_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  booking_id TEXT,
  to_address TEXT NOT NULL,
  amount_wei TEXT NOT NULL,
  status TEXT NOT NULL,
  note TEXT,
  tx TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT,
  channel TEXT NOT NULL,
  wallet TEXT,
  chat_id TEXT,
  created_at INTEGER NOT NULL
);
`;

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export function newBookingId() {
  const bytes = randomBytes(6);
  let s = '';
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return `S-${s}`;
}

export function openDb(path = ':memory:') {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return new Store(db);
}

/** Envoltorio con todas las consultas que usa el agente. */
export class Store {
  constructor(db) {
    this.db = db;
  }

  /** Ejecuta varias operaciones como una sola (o todas, o ninguna). */
  tx(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      this.db.exec('COMMIT');
      return out;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  // --- Reservas ---------------------------------------------------------
  insertBooking(b) {
    this.db.prepare(`INSERT INTO bookings
      (id, resource, start_at, customer_id, customer_name, channel, source, status, deposit_wei,
       hold_expires_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      b.id, b.resource, b.start_at, b.customer_id, b.customer_name ?? null, b.channel, b.source ?? 'directa',
      b.status, String(b.deposit_wei), b.hold_expires_at ?? null, b.created_at, b.created_at,
    );
    return this.getBooking(b.id);
  }

  getBooking(id) {
    return this.db.prepare('SELECT * FROM bookings WHERE id = ?').get(id) ?? null;
  }

  updateBooking(id, fields, now) {
    const keys = Object.keys(fields);
    const sets = keys.map((k) => `${k} = ?`).join(', ');
    const values = keys.map((k) => (typeof fields[k] === 'bigint' ? String(fields[k]) : fields[k]));
    this.db.prepare(`UPDATE bookings SET ${sets}, updated_at = ? WHERE id = ?`).run(...values, now, id);
    return this.getBooking(id);
  }

  activeBookingForSlot(resource, startAt) {
    return this.db.prepare(
      "SELECT * FROM bookings WHERE resource = ? AND start_at = ? AND status IN ('held','confirmed')",
    ).get(resource, startAt) ?? null;
  }

  activeBookingsBetween(fromMs, toMs) {
    return this.db.prepare(
      "SELECT * FROM bookings WHERE start_at >= ? AND start_at < ? AND status IN ('held','confirmed') ORDER BY start_at",
    ).all(fromMs, toMs);
  }

  bookingsForCustomer(customerId, { onlyUpcomingFrom } = {}) {
    if (onlyUpcomingFrom != null) {
      return this.db.prepare(
        "SELECT * FROM bookings WHERE customer_id = ? AND start_at >= ? AND status IN ('held','confirmed') ORDER BY start_at",
      ).all(customerId, onlyUpcomingFrom);
    }
    return this.db.prepare('SELECT * FROM bookings WHERE customer_id = ? ORDER BY start_at DESC LIMIT 20').all(customerId);
  }

  expiredHolds(now) {
    return this.db.prepare("SELECT * FROM bookings WHERE status = 'held' AND hold_expires_at <= ?").all(now);
  }

  finishedConfirmed(now) {
    return this.db.prepare("SELECT * FROM bookings WHERE status = 'confirmed' AND start_at <= ?").all(now);
  }

  /** Suma de señas de turnos confirmados que todavía no pasaron (plata que se podría tener que devolver). */
  liabilitiesWei(now) {
    const rows = this.db.prepare(
      "SELECT deposit_wei, refunded_wei FROM bookings WHERE status = 'confirmed' AND start_at > ?",
    ).all(now);
    return rows.reduce((acc, r) => acc + BigInt(r.deposit_wei) - BigInt(r.refunded_wei), 0n);
  }

  /** Señas retenidas por cancelaciones tardías cuyo turno todavía podría revenderse. */
  retainedWei(now) {
    const rows = this.db.prepare(
      "SELECT deposit_wei, refunded_wei FROM bookings WHERE status = 'cancelled' AND start_at > ? AND pay_tx IS NOT NULL",
    ).all(now);
    return rows.reduce((acc, r) => acc + BigInt(r.deposit_wei) - BigInt(r.refunded_wei), 0n);
  }

  cancelledForSlotWithRetention(resource, startAt) {
    return this.db.prepare(
      `SELECT * FROM bookings WHERE resource = ? AND start_at = ? AND status = 'cancelled'
       AND pay_tx IS NOT NULL ORDER BY updated_at`,
    ).all(resource, startAt).filter((b) => BigInt(b.refunded_wei) < BigInt(b.deposit_wei));
  }

  bookingsUpdatedBetween(fromMs, toMs) {
    return this.db.prepare('SELECT * FROM bookings WHERE updated_at >= ? AND updated_at < ? ORDER BY updated_at').all(fromMs, toMs);
  }

  // --- Lista de espera --------------------------------------------------
  addWaitlist(w) {
    const existing = this.db.prepare(
      "SELECT * FROM waitlist WHERE resource = ? AND start_at = ? AND customer_id = ? AND status IN ('waiting','offered')",
    ).get(w.resource, w.start_at, w.customer_id);
    if (existing) return { entry: existing, created: false };
    const info = this.db.prepare(`INSERT INTO waitlist (resource, start_at, customer_id, customer_name, channel, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'waiting', ?)`).run(w.resource, w.start_at, w.customer_id, w.customer_name ?? null, w.channel, w.created_at);
    return { entry: this.db.prepare('SELECT * FROM waitlist WHERE id = ?').get(info.lastInsertRowid), created: true };
  }

  nextWaiting(resource, startAt) {
    return this.db.prepare(
      "SELECT * FROM waitlist WHERE resource = ? AND start_at = ? AND status = 'waiting' ORDER BY created_at, id LIMIT 1",
    ).get(resource, startAt) ?? null;
  }

  waitlistPosition(entry) {
    const row = this.db.prepare(
      "SELECT COUNT(*) AS n FROM waitlist WHERE resource = ? AND start_at = ? AND status = 'waiting' AND (created_at < ? OR (created_at = ? AND id <= ?))",
    ).get(entry.resource, entry.start_at, entry.created_at, entry.created_at, entry.id);
    return row.n;
  }

  waitlistByOfferedBooking(bookingId) {
    return this.db.prepare('SELECT * FROM waitlist WHERE offered_booking_id = ?').get(bookingId) ?? null;
  }

  updateWaitlist(id, fields) {
    const keys = Object.keys(fields);
    this.db.prepare(`UPDATE waitlist SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => fields[k]), id);
  }

  waitlistForCustomer(customerId) {
    return this.db.prepare("SELECT * FROM waitlist WHERE customer_id = ? AND status IN ('waiting','offered') ORDER BY start_at").all(customerId);
  }

  // --- Decisiones -------------------------------------------------------
  logDecision(d) {
    const info = this.db.prepare(`INSERT INTO decisions (at, booking_id, kind, rule, reason, data, tx)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      d.at, d.booking_id ?? null, d.kind, d.rule, d.reason,
      d.data ? JSON.stringify(d.data, (_, v) => (typeof v === 'bigint' ? v.toString() : v)) : null,
      d.tx ?? null,
    );
    return Number(info.lastInsertRowid);
  }

  setDecisionTx(id, tx) {
    this.db.prepare('UPDATE decisions SET tx = ? WHERE id = ?').run(tx, id);
  }

  decisions({ limit = 20, bookingId } = {}) {
    if (bookingId) return this.db.prepare('SELECT * FROM decisions WHERE booking_id = ? ORDER BY id DESC LIMIT ?').all(bookingId, limit);
    return this.db.prepare('SELECT * FROM decisions ORDER BY id DESC LIMIT ?').all(limit);
  }

  decisionsBetween(fromMs, toMs) {
    return this.db.prepare('SELECT * FROM decisions WHERE at >= ? AND at < ? ORDER BY id').all(fromMs, toMs);
  }

  // --- Transferencias (salidas de plata del agente) ----------------------
  /** Crea la transferencia si no existe esa clave. Nunca crea dos con la misma clave. */
  queueTransfer(t) {
    const existing = this.db.prepare('SELECT * FROM transfers WHERE idem_key = ?').get(t.idem_key);
    if (existing) return { transfer: existing, created: false };
    const info = this.db.prepare(`INSERT INTO transfers (idem_key, kind, booking_id, to_address, amount_wei, status, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      t.idem_key, t.kind, t.booking_id ?? null, t.to_address, String(t.amount_wei), t.status, t.note ?? null, t.created_at, t.created_at,
    );
    return { transfer: this.getTransfer(Number(info.lastInsertRowid)), created: true };
  }

  getTransfer(id) {
    return this.db.prepare('SELECT * FROM transfers WHERE id = ?').get(id) ?? null;
  }

  updateTransfer(id, fields, now) {
    const keys = Object.keys(fields);
    this.db.prepare(`UPDATE transfers SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
      .run(...keys.map((k) => fields[k]), now, id);
    return this.getTransfer(id);
  }

  transfersByStatus(status) {
    return this.db.prepare('SELECT * FROM transfers WHERE status = ? ORDER BY id').all(status);
  }

  /** Devoluciones mandadas (o en curso) desde un momento dado, para el tope diario. */
  refundsSentSince(fromMs) {
    const rows = this.db.prepare(
      "SELECT amount_wei FROM transfers WHERE kind = 'refund' AND status IN ('sending','sent','unknown') AND created_at >= ?",
    ).all(fromMs);
    return rows.reduce((acc, r) => acc + BigInt(r.amount_wei), 0n);
  }

  transfersBetween(fromMs, toMs) {
    return this.db.prepare('SELECT * FROM transfers WHERE created_at >= ? AND created_at < ? ORDER BY id').all(fromMs, toMs);
  }

  // --- Clientes -----------------------------------------------------------
  upsertCustomer(c) {
    this.db.prepare(`INSERT INTO customers (id, name, channel, wallet, chat_id, created_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = COALESCE(excluded.name, customers.name),
        wallet = COALESCE(excluded.wallet, customers.wallet), chat_id = COALESCE(excluded.chat_id, customers.chat_id)`)
      .run(c.id, c.name ?? null, c.channel, c.wallet ?? null, c.chat_id ?? null, c.created_at);
    return this.getCustomer(c.id);
  }

  getCustomer(id) {
    return this.db.prepare('SELECT * FROM customers WHERE id = ?').get(id) ?? null;
  }
}
