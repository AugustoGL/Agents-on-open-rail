// Fuente de agenda: de dónde sale la disponibilidad de los turnos y dónde se anotan los confirmados.
//
// Seña no reemplaza el sistema de turnos del comercio: cobra la seña y deja el turno anotado
// donde el comercio ya mira. Una fuente de agenda implementa (todo async):
//
//   events({ fromMs, toMs })     -> [{ id, startAt, endAt, text, allDay, bookingId }] eventos que ocupan el calendario
//   confirm(booking, evento)     -> crea el evento de una reserva pagada (idempotente por id de reserva)
//   release(bookingId)           -> borra ese evento (si ya no existe, no es error)
//
// Si una operación no puede completarse tira AgendaError: quien llama NO debe confirmar ni cobrar.
import { normalizeText } from './text.js';

export class AgendaError extends Error {
  constructor(message, { cause } = {}) {
    super(message);
    this.name = 'AgendaError';
    this.cause = cause;
  }
}

/** Agenda por defecto: la grilla propia en SQLite. No hay nada externo que consultar ni escribir. */
export class LocalAgenda {
  external = false;
  name = 'local';

  async events() { return []; }
  async confirm() { return null; }
  async release() {}
}

/**
 * Id del evento de una reserva. Google exige letras a-v y dígitos; el hexadecimal del id de la
 * reserva lo cumple y permite crear y borrar el evento sin guardar nada extra en la base.
 */
export function eventIdFor(bookingId) {
  return `sena${Buffer.from(String(bookingId)).toString('hex')}`;
}

/**
 * ¿Este evento ocupa este recurso (una cancha)?
 * Regla simple: el evento nombra la cancha en el título o en el lugar ("Cancha 1 - Pérez").
 * Si no nombra ninguna cancha (ej. "Torneo", "Feriado") ocupa todas: es lo más seguro.
 */
export function eventBlocksResource(eventText, resource, allResources) {
  const text = normalizeText(eventText);
  // Con límites de palabra para que "Cancha 1" no coincida con "Cancha 10".
  const mentions = (r) => new RegExp(`(^|[^a-z0-9])${normalizeText(r).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`).test(text);
  const named = allResources.filter(mentions);
  if (named.length === 0) return true;
  return named.includes(resource);
}

/** ¿Está libre ese recurso en ese turno según los eventos del calendario? */
export function slotIsFreeIn(events, { resource, startAt, durationMin, resources }) {
  const endAt = startAt + durationMin * 60_000;
  return !events.some((ev) => ev.startAt < endAt && ev.endAt > startAt && eventBlocksResource(ev.text, resource, resources));
}
