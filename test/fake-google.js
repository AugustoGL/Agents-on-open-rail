// Un Google Calendar de mentira, en memoria, que imita lo justo de la API REST (sin red).
// Se le pasa a GoogleCalendarAgenda como `fetch`. También verifica la firma del JWT de la cuenta de servicio.
import { createVerify, generateKeyPairSync } from 'node:crypto';

export const CALENDAR_ID = 'comercio@group.calendar.google.com';
export const TOKEN_URI = 'https://oauth2.googleapis.com/token';

export function makeServiceAccount() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return {
    publicKey,
    serviceAccount: { client_email: 'sena@proyecto.iam.gserviceaccount.com', private_key: privateKey, token_uri: TOKEN_URI },
  };
}

const json = (status, body) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export class FakeGoogle {
  constructor({ publicKey, pageSize = 250 } = {}) {
    this.publicKey = publicKey;
    this.pageSize = pageSize;
    this.items = new Map(); // id -> evento (como lo guarda Google)
    this.calls = []; // { method, path }
    this.tokenRequests = 0;
    this.down = false; // sin conexión
    this.failWrites = false; // 500 al crear o borrar
    this.fetch = this.fetch.bind(this);
  }

  /** Evento puesto "a mano" por el comercio. */
  addEvent({ summary, startMs, endMs, transparency, status = 'confirmed', location }) {
    const id = `ext${this.items.size + 1}`;
    this.items.set(id, { id, status, summary, location, transparency, start: { dateTime: new Date(startMs).toISOString() }, end: { dateTime: new Date(endMs).toISOString() } });
    return id;
  }

  addAllDay({ summary, date, endDate }) {
    const id = `ext${this.items.size + 1}`;
    this.items.set(id, { id, status: 'confirmed', summary, start: { date }, end: { date: endDate } });
    return id;
  }

  live() { return [...this.items.values()].filter((e) => e.status !== 'cancelled'); }
  count(method, pathPart) { return this.calls.filter((c) => c.method === method && c.path.includes(pathPart)).length; }

  async fetch(url, init = {}) {
    if (this.down) throw new TypeError('fetch failed');
    const u = new URL(url);
    const method = init.method ?? 'GET';
    this.calls.push({ method, path: u.pathname });

    if (url.startsWith(TOKEN_URI)) return this.token(init);

    if (init.headers?.authorization !== 'Bearer fake-token') return json(401, { error: { message: 'Invalid Credentials' } });
    const prefix = `/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}`;
    if (!u.pathname.startsWith(prefix)) return json(404, { error: { message: 'Not Found' } });
    const rest = u.pathname.slice(prefix.length);

    if (rest === '/events' && method === 'GET') return this.list(u);
    if (rest === '/events' && method === 'POST') {
      if (this.failWrites) return json(500, { error: { message: 'Backend Error' } });
      const body = JSON.parse(init.body);
      if (this.items.has(body.id)) return json(409, { error: { message: 'The requested identifier already exists.' } });
      this.items.set(body.id, { ...body, status: 'confirmed' });
      return json(200, this.items.get(body.id));
    }
    const m = /^\/events\/([^/]+)$/.exec(rest);
    if (m && method === 'GET') {
      const ev = this.items.get(m[1]);
      return ev ? json(200, ev) : json(404, { error: { message: 'Not Found' } });
    }
    if (m && method === 'DELETE') {
      if (this.failWrites) return json(500, { error: { message: 'Backend Error' } });
      const ev = this.items.get(m[1]);
      if (!ev) return json(404, { error: { message: 'Not Found' } });
      if (ev.status === 'cancelled') return json(410, { error: { message: 'Resource has been deleted' } });
      ev.status = 'cancelled';
      return new Response(null, { status: 204 });
    }
    return json(400, { error: { message: 'no soportado por el falso' } });
  }

  token(init) {
    this.tokenRequests++;
    const assertion = new URLSearchParams(init.body).get('assertion');
    const [h, c, sig] = (assertion ?? '').split('.');
    const ok = Boolean(sig) && createVerify('RSA-SHA256').update(`${h}.${c}`).verify(this.publicKey, sig, 'base64url');
    const claims = ok ? JSON.parse(Buffer.from(c, 'base64url').toString()) : {};
    if (!ok || claims.iss !== 'sena@proyecto.iam.gserviceaccount.com' || !claims.scope?.includes('calendar') || claims.aud !== TOKEN_URI) {
      return json(400, { error: 'invalid_grant' });
    }
    return json(200, { access_token: 'fake-token', expires_in: 3600, token_type: 'Bearer' });
  }

  list(u) {
    const timeMin = Date.parse(u.searchParams.get('timeMin'));
    const timeMax = Date.parse(u.searchParams.get('timeMax'));
    const start = (e) => Date.parse(e.start.dateTime ?? `${e.start.date}T00:00:00-03:00`);
    const end = (e) => Date.parse(e.end.dateTime ?? `${e.end.date}T00:00:00-03:00`);
    const all = this.live().filter((e) => start(e) < timeMax && end(e) > timeMin).sort((a, b) => start(a) - start(b));
    const from = Number(u.searchParams.get('pageToken') ?? 0);
    const items = all.slice(from, from + this.pageSize);
    return json(200, { items, ...(from + this.pageSize < all.length ? { nextPageToken: String(from + this.pageSize) } : {}) });
  }
}
