// Google Calendar como fuente de agenda, por la API REST y con una cuenta de servicio.
// Sin librerías: el JWT se firma con node:crypto y las llamadas usan fetch (Node 22).
//
// Un solo calendario para todas las canchas: cada evento nombra la cancha en el título o en el lugar
// (ver eventBlocksResource en agenda.js). Los eventos que crea Seña llevan el id de la reserva.
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { AgendaError, eventIdFor } from './agenda.js';
import { localToUtcMs } from './time.js';

const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const API = 'https://www.googleapis.com/calendar/v3';
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';
const MAX_PAGES = 10;

const b64url = (input) => Buffer.from(input).toString('base64url');

/** JWT RS256 que Google cambia por un access token (flujo de cuenta de servicio). */
export function signServiceAccountJwt({ clientEmail, privateKey, tokenUri, nowSec }) {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: clientEmail, scope: SCOPE, aud: tokenUri, iat: nowSec, exp: nowSec + 3600 }));
  const unsigned = `${header}.${claims}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(privateKey, 'base64url');
  return `${unsigned}.${signature}`;
}

export class GoogleCalendarAgenda {
  external = true;
  name = 'google';

  /**
   * @param {object} opts
   * @param {{client_email: string, private_key: string, token_uri?: string}} opts.serviceAccount
   * @param {string} opts.calendarId
   * @param {number} opts.utcOffsetMinutes  desfase del negocio (para eventos de día completo)
   * @param {typeof fetch} [opts.fetch]
   * @param {() => number} [opts.now]       ms; solo para el vencimiento del token
   * @param {number} [opts.timeoutMs]
   */
  constructor({ serviceAccount, calendarId, utcOffsetMinutes, fetch: fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 8000 }) {
    if (!serviceAccount?.client_email || !serviceAccount?.private_key) throw new Error('La cuenta de servicio de Google no tiene client_email o private_key.');
    if (!calendarId) throw new Error('Falta el id del calendario de Google.');
    this.sa = serviceAccount;
    this.calendarId = calendarId;
    this.offset = utcOffsetMinutes;
    this.fetch = fetchImpl;
    this.now = now;
    this.timeoutMs = timeoutMs;
    this.token = null;
    this.tokenExpiresAt = 0;
  }

  /** Lee el JSON de la cuenta de servicio del disco. Falla con un mensaje claro si no se puede. */
  static fromFile(path, opts) {
    let serviceAccount;
    try {
      serviceAccount = JSON.parse(readFileSync(path, 'utf8'));
    } catch (err) {
      throw new Error(`No pude leer la cuenta de servicio de Google (${path}): ${err.code ?? err.message}`);
    }
    return new GoogleCalendarAgenda({ ...opts, serviceAccount });
  }

  async accessToken() {
    if (this.token && this.now() < this.tokenExpiresAt) return this.token;
    const tokenUri = this.sa.token_uri ?? DEFAULT_TOKEN_URI;
    const assertion = signServiceAccountJwt({
      clientEmail: this.sa.client_email, privateKey: this.sa.private_key, tokenUri, nowSec: Math.floor(this.now() / 1000),
    });
    const res = await this.send(tokenUri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
    });
    if (!res.ok) throw new AgendaError(`Google no me dio acceso al calendario (${res.status}). Revisá la cuenta de servicio.`);
    const body = await res.json().catch(() => null);
    if (!body?.access_token) throw new AgendaError('Google respondió sin token de acceso.');
    this.token = body.access_token;
    this.tokenExpiresAt = this.now() + Math.max(0, (Number(body.expires_in) || 3600) - 60) * 1000;
    return this.token;
  }

  /** fetch con tiempo máximo; cualquier falla de red se convierte en AgendaError. */
  async send(url, init) {
    try {
      return await this.fetch(url, { ...init, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (err) {
      throw new AgendaError('No pude conectar con Google Calendar.', { cause: err });
    }
  }

  async api(method, path, { query, body } = {}, retried = false) {
    const token = await this.accessToken();
    const url = `${API}/calendars/${encodeURIComponent(this.calendarId)}${path}${query ? `?${new URLSearchParams(query)}` : ''}`;
    const res = await this.send(url, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 && !retried) {
      this.token = null;
      return this.api(method, path, { query, body }, true);
    }
    return res;
  }

  async fail(res, what) {
    let detail = '';
    try { detail = (await res.json())?.error?.message ?? ''; } catch { /* sin detalle */ }
    const hint = res.status === 404 ? ' (¿el calendario está compartido con la cuenta de servicio?)' : '';
    throw new AgendaError(`Google Calendar no pudo ${what} (${res.status}${detail ? `: ${detail}` : ''})${hint}`);
  }

  parseWhen(w) {
    if (w?.dateTime) return Date.parse(w.dateTime);
    if (w?.date) return localToUtcMs(w.date, '00:00', this.offset);
    return NaN;
  }

  /** Eventos del calendario entre dos instantes. Si no se pueden leer todos, falla: nunca devuelve una lista parcial. */
  async events({ fromMs, toMs }) {
    const out = [];
    let pageToken;
    for (let page = 0; page < MAX_PAGES; page++) {
      const query = {
        timeMin: new Date(fromMs).toISOString(),
        timeMax: new Date(toMs).toISOString(),
        singleEvents: 'true',
        orderBy: 'startTime',
        showDeleted: 'false',
        maxResults: '250',
        fields: 'nextPageToken,items(id,status,summary,location,transparency,start,end,extendedProperties/private)',
        ...(pageToken ? { pageToken } : {}),
      };
      const res = await this.api('GET', '/events', { query });
      if (!res.ok) await this.fail(res, 'leer los eventos');
      const body = await res.json().catch(() => null);
      if (!body || !Array.isArray(body.items ?? [])) throw new AgendaError('Google Calendar respondió algo que no entiendo.');
      for (const ev of body.items ?? []) {
        if (ev.status === 'cancelled' || ev.transparency === 'transparent') continue;
        const startAt = this.parseWhen(ev.start);
        const endAt = this.parseWhen(ev.end);
        if (Number.isNaN(startAt) || Number.isNaN(endAt)) continue;
        out.push({
          id: ev.id, startAt, endAt, allDay: Boolean(ev.start?.date),
          text: `${ev.summary ?? ''} ${ev.location ?? ''}`,
          bookingId: ev.extendedProperties?.private?.senaBookingId ?? null,
        });
      }
      pageToken = body.nextPageToken;
      if (!pageToken) return out;
    }
    throw new AgendaError('El calendario tiene demasiados eventos en ese rango para leerlo completo.');
  }

  /** Crea el evento de una reserva pagada. Idempotente: el id del evento sale del id de la reserva. */
  async confirm(booking, { title, description, startAt, endAt }) {
    const id = eventIdFor(booking.id);
    const res = await this.api('POST', '/events', {
      body: {
        id,
        summary: title,
        description,
        start: { dateTime: new Date(startAt).toISOString() },
        end: { dateTime: new Date(endAt).toISOString() },
        extendedProperties: { private: { senaBookingId: booking.id } },
      },
    });
    if (res.ok) return { eventId: id };
    if (res.status === 409) {
      // Ya existe un evento con ese id: sirve solo si sigue vivo (si lo borraron, el turno no está anotado).
      const existing = await this.api('GET', `/events/${id}`, { query: { fields: 'id,status' } });
      if (existing.ok && (await existing.json().catch(() => null))?.status !== 'cancelled') return { eventId: id };
      throw new AgendaError('El evento de esa reserva ya existía y fue borrado del calendario.');
    }
    return this.fail(res, 'anotar el turno');
  }

  /** Borra el evento de una reserva. Si ya no existe, está bien. */
  async release(bookingId) {
    const res = await this.api('DELETE', `/events/${eventIdFor(bookingId)}`);
    if (res.ok || res.status === 404 || res.status === 410) return;
    await this.fail(res, 'borrar el evento');
  }
}
