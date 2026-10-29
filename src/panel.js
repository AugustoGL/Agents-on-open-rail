// Panel del comercio (/panel): una clave, una sesión y acciones sobre el agente.
// Las rutas no tienen lógica de plata: llaman a los métodos de SenaAgent (que aplican topes y registran decisiones).
//
// Seguridad: clave comparada en tiempo constante, límite de intentos de ingreso, cookie de sesión
// httpOnly + SameSite=Strict (+ Secure con https), token CSRF en toda acción que cambia datos,
// chequeo de Origin y sin guardar nada en caché.
import { Router } from 'express';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { formatArs } from './money.js';
import { addDays, isValidDateStr, localDateStr, weekdayOf } from './time.js';
import { RANGES, WEEKDAY_NAMES, toStored } from './settings.js';

const COOKIE = 'sena_panel';
const sha = (s) => createHash('sha256').update(String(s)).digest();

/** Compara dos textos en tiempo constante (se comparan los hashes, que siempre miden lo mismo). */
export function safeEqual(a, b) {
  return timingSafeEqual(sha(a), sha(b));
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

/** Límite de intentos fallidos por clave (por ejemplo, una IP) en una ventana de tiempo. */
export function createFailureLimiter({ windowMs, max, now = Date.now }) {
  const hits = new Map(); // key -> { count, since }
  const fresh = (key) => {
    const h = hits.get(key);
    if (h && now() - h.since >= windowMs) hits.delete(key);
    return hits.get(key);
  };
  return {
    /** Segundos que faltan para poder intentar de nuevo (0 si se puede). */
    blockedFor(key) {
      const h = fresh(key);
      return h && h.count >= max ? Math.ceil((h.since + windowMs - now()) / 1000) : 0;
    },
    fail(key) {
      const h = fresh(key) ?? { count: 0, since: now() };
      h.count += 1;
      hits.set(key, h);
    },
    reset(key) { hits.delete(key); },
  };
}

/** Middleware que limita cuántos pedidos puede hacer una IP en una ventana (para las rutas públicas que crean cosas). */
export function createRateLimit({ windowMs, max, now = Date.now }) {
  const hits = new Map();
  return (req, res, next) => {
    const key = req.ip ?? 'desconocida';
    const t = now();
    let h = hits.get(key);
    if (!h || t - h.since >= windowMs) { h = { count: 0, since: t }; hits.set(key, h); }
    h.count += 1;
    if (hits.size > 5000) for (const [k, v] of hits) if (t - v.since >= windowMs) hits.delete(k);
    if (h.count > max) {
      res.set('Retry-After', String(Math.ceil((h.since + windowMs - t) / 1000)));
      return res.status(429).json({ error: 'Too many requests in a row. Wait a few minutes and try again.', codigo: 'demasiados_pedidos' });
    }
    return next();
  };
}

const maskAddress = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : null);
const money = (wei) => ({ texto: formatArs(wei), wei: String(wei) });

/** La configuración tal como la edita el panel. */
export function editableConfig(business) {
  const s = toStored(business);
  return {
    nombre: s.nombre, descripcion: s.descripcion ?? '', recursosLista: s.recursosLista, horarios: s.horarios,
    horariosSemana: s.horariosSemana ?? {}, horariosRecurso: s.horariosRecurso ?? {},
    duracionMinutos: s.duracionMinutos, diasAdelante: s.diasAdelante, anticipacionMinimaMinutos: s.anticipacionMinimaMinutos,
    precioTurnoArs: s.precioTurnoArs, senaPorcentaje: s.senaPorcentaje, reservaSinPagarMinutos: s.reservaSinPagarMinutos,
    politica: s.politica, limites: s.limites, cierre: { hora: s.cierre.hora },
  };
}

/**
 * @param {object} deps
 * @param {import('./agent.js').SenaAgent} deps.agent
 * @param {string} [deps.password]  OWNER_DASHBOARD_PASSWORD; sin clave el panel queda deshabilitado
 */
export function createPanelRouter({
  agent, password, logger = console, now = Date.now, sessionTtlMs = 8 * 3_600_000,
  loginWindowMs = 15 * 60_000, maxFailuresPerIp = 5, maxFailuresTotal = 40,
}) {
  const enabled = Boolean(password);
  const router = Router();
  const sessions = new Map(); // token -> { csrf, expires }
  const perIp = createFailureLimiter({ windowMs: loginWindowMs, max: maxFailuresPerIp, now });
  const total = createFailureLimiter({ windowMs: loginWindowMs, max: maxFailuresTotal, now });
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const secure = (req) => req.secure || agent.publicBaseUrl.startsWith('https://');

  router.use((_req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' });
    next();
  });

  const sweep = () => { for (const [t, s] of sessions) if (s.expires <= now()) sessions.delete(t); };
  const sessionOf = (req) => {
    const token = parseCookies(req.get('cookie'))[COOKIE];
    const s = token ? sessions.get(token) : null;
    if (!s) return null;
    if (s.expires <= now()) { sessions.delete(token); return null; }
    return { token, ...s };
  };
  const sameOrigin = (req) => {
    const origin = req.get('origin');
    if (!origin) return true;
    try { return new URL(origin).host === req.get('host'); } catch { return false; }
  };
  const setCookie = (req, res, value, maxAgeSec) => {
    res.append('Set-Cookie', `${COOKIE}=${value}; Path=/panel; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${secure(req) ? '; Secure' : ''}`);
  };

  router.get('/api/session', (req, res) => {
    const s = enabled ? sessionOf(req) : null;
    res.json({
      habilitado: enabled, autenticado: Boolean(s), csrf: s?.csrf ?? null,
      negocio: agent.business.nombre, modo: agent.chain.mode, nft: Boolean(agent.nft), esDemostracion: Boolean(agent.business.esDemostracion),
      mensaje: enabled ? null : 'The dashboard is disabled: OWNER_DASHBOARD_PASSWORD is missing from the .env file.',
    });
  });

  router.use('/api', (req, res, next) => {
    if (!enabled) return res.status(503).json({ error: 'The dashboard is disabled: OWNER_DASHBOARD_PASSWORD is missing from the .env file.', codigo: 'panel_deshabilitado' });
    if (!sameOrigin(req)) return res.status(403).json({ error: 'Request from another origin.', codigo: 'origen' });
    return next();
  });

  router.post('/api/login', (req, res) => {
    const ip = req.ip ?? 'desconocida';
    const wait = Math.max(perIp.blockedFor(ip), total.blockedFor('todas'));
    if (wait > 0) {
      res.set('Retry-After', String(wait));
      return res.status(429).json({ error: `Too many attempts. Try again in ${Math.ceil(wait / 60)} minute(s).`, codigo: 'demasiados_intentos' });
    }
    const given = req.body?.clave;
    if (typeof given !== 'string' || given.length > 200 || !safeEqual(given, password)) {
      perIp.fail(ip);
      total.fail('todas');
      logger.warn?.(`[panel] intento de ingreso fallido desde ${ip}`);
      return res.status(401).json({ error: 'The password is not correct.', codigo: 'clave' });
    }
    perIp.reset(ip);
    sweep();
    const token = randomBytes(32).toString('base64url');
    const csrf = randomBytes(24).toString('base64url');
    sessions.set(token, { csrf, expires: now() + sessionTtlMs });
    setCookie(req, res, token, Math.floor(sessionTtlMs / 1000));
    return res.json({ ok: true, csrf });
  });

  // Todo lo que sigue necesita sesión; lo que cambia datos, además, el token CSRF.
  router.use('/api', (req, res, next) => {
    const s = sessionOf(req);
    if (!s) return res.status(401).json({ error: 'Sign in with the dashboard password.', codigo: 'sin_sesion' });
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const sent = req.get('x-csrf-token');
      if (typeof sent !== 'string' || !safeEqual(sent, s.csrf)) return res.status(403).json({ error: 'The security token (CSRF) is missing. Reload the page.', codigo: 'csrf' });
    }
    req.panelSession = s;
    return next();
  });

  router.post('/api/logout', (req, res) => {
    sessions.delete(req.panelSession.token);
    setCookie(req, res, '', 0);
    res.json({ ok: true });
  });

  // --- Hoy ---------------------------------------------------------------------------
  router.get('/api/hoy', wrap(async (_req, res) => {
    const d = await agent.daySummary();
    res.json({ ...d, wallet: agent.chain.address, modo: agent.chain.mode });
  }));

  // --- Calendario --------------------------------------------------------------------
  router.get('/api/calendario', wrap(async (req, res) => {
    const today = localDateStr(agent.now(), agent.offset);
    const fecha = isValidDateStr(req.query.fecha) ? req.query.fecha : today;
    const semana = req.query.vista === 'semana';
    const start = semana ? addDays(fecha, -((weekdayOf(fecha) + 6) % 7)) : fecha;
    const dias = Array.from({ length: semana ? 7 : 1 }, (_, i) => agent.ownerDay(addDays(start, i)));
    res.json({ vista: semana ? 'semana' : 'dia', fecha, hoy: today, desde: start, anterior: addDays(start, semana ? -7 : -1), siguiente: addDays(start, semana ? 7 : 1), dias });
  }));

  // --- Reservas ----------------------------------------------------------------------
  router.get('/api/reservas', (req, res) => {
    const { estado, fecha, desde, hasta, q, limite } = req.query;
    res.json({ reservas: agent.listBookings({ estado, fecha, desde, hasta, q: typeof q === 'string' ? q.slice(0, 60) : undefined, limite }) });
  });

  router.get('/api/reservas/:id', (req, res) => {
    const b = agent.store.getBooking(req.params.id);
    if (!b) return res.status(404).json({ error: 'That booking does not exist.' });
    const view = (p) => (p.ok ? { ok: true, devolucion: formatArs(p.refundWei), regla: p.rule, motivo: p.reason } : { ok: false, motivo: p.reason });
    return res.json({
      reserva: agent.bookingSummary(b),
      cancelarSegunPolitica: view(agent.previewCancel({ bookingId: b.id })),
      cancelarDevolviendoTodo: view(agent.previewCancel({ bookingId: b.id, fullRefund: true })),
      decisiones: agent.store.decisions({ bookingId: b.id, limit: 30 }).map(decisionView),
    });
  });

  router.post('/api/reservas/:id/cancelar', wrap(async (req, res) => {
    const total = req.body?.devolucion === 'total';
    const motivo = typeof req.body?.motivo === 'string' ? req.body.motivo.replace(/\s+/g, ' ').trim().slice(0, 120) : null;
    const r = await agent.cancel({ bookingId: req.params.id, by: 'owner', fullRefund: total, reason: motivo || null });
    if (!r.ok) return res.status(409).json({ error: r.reason });
    return res.json({ ok: true, regla: r.rule, motivo: r.reason, devolucion: formatArs(r.refundWei) });
  }));

  router.post('/api/reservas/:id/nft/reintentar', wrap(async (req, res) => {
    const r = await agent.retryNft(req.params.id);
    return r.ok ? res.json({ ok: true, nft: r.nft }) : res.status(409).json({ error: r.reason });
  }));

  // --- Decisiones --------------------------------------------------------------------
  router.get('/api/decisiones', (req, res) => {
    const limit = Math.min(Number(req.query.limite) || 50, 300);
    res.json({ decisiones: agent.store.decisions({ limit }).map(decisionView) });
  });

  // --- Pendientes --------------------------------------------------------------------
  router.get('/api/pendientes', (_req, res) => {
    const rows = ['needs_owner', 'failed', 'unknown'].flatMap((s) => agent.store.transfersByStatus(s));
    res.json({
      transferencias: rows.map((t) => ({
        id: t.id, tipo: t.kind === 'refund' ? 'refund' : 'withdrawal', reserva: t.booking_id, destino: t.to_address, monto: money(t.amount_wei),
        estado: t.status, nota: t.note, error: t.error, puedeAprobar: ['needs_owner', 'failed'].includes(t.status), creada: new Date(t.created_at).toISOString(),
      })),
    });
  });

  router.post('/api/transferencias/:id/aprobar', wrap(async (req, res) => {
    const r = await agent.approveTransfer(req.params.id);
    if (!r.ok) return res.status(409).json({ error: r.reason });
    return res.json({ ok: true, estado: r.transfer.status, tx: r.transfer.tx });
  }));
  router.post('/api/transferencias/:id/rechazar', wrap(async (req, res) => {
    const r = await agent.rejectTransfer(req.params.id);
    if (!r.ok) return res.status(409).json({ error: r.reason });
    return res.json({ ok: true });
  }));

  // --- Configuración -----------------------------------------------------------------
  const configView = () => ({
    config: editableConfig(agent.business),
    rangos: RANGES,
    dias: WEEKDAY_NAMES,
    soloLectura: {
      esDemostracion: Boolean(agent.business.esDemostracion),
      modo: agent.chain.mode,
      direccionDeRetiro: maskAddress(agent.payoutAddress),
      billeteraDelAgente: agent.chain.address,
      aviso: 'The withdrawal address, keys, PAY_TO and the mode are changed only in the .env file, for security.',
    },
    historial: agent.store.settingsLog({ limit: 60 }).map((r) => ({
      id: r.id, fecha: new Date(r.at).toISOString(), quien: r.actor, campo: r.field, antes: r.old_value, despues: r.new_value,
    })),
  });
  router.get('/api/config', (_req, res) => res.json(configView()));
  router.put('/api/config', (req, res) => {
    const r = agent.updateSettings(req.body?.cambios, { actor: 'panel', ip: req.ip });
    if (!r.ok) return res.status(400).json({ error: 'Not saved: check the marked fields.', errores: r.errors });
    return res.json({ ok: true, cambios: r.changes.map((c) => c.field), ...configView() });
  });

  // --- Bloqueos ----------------------------------------------------------------------
  const blockView = (k) => ({
    id: k.id, tipo: k.kind, recurso: k.resource, desde: new Date(k.from_at).toISOString(), hasta: new Date(k.to_at).toISOString(),
    desdeLocal: agent.fmt(k.from_at), hastaLocal: agent.fmt(k.to_at - 60_000), motivo: k.reason, creadoPor: k.created_by,
    afectadas: agent.bookingsAffectedBy(k).map((b) => agent.bookingSummary(b)),
  });
  router.get('/api/bloqueos', (_req, res) => res.json({
    hoy: localDateStr(agent.now(), agent.offset), recursos: agent.business.recursosTodos, bloqueos: agent.store.activeBlocks(agent.now()).map(blockView),
  }));
  router.post('/api/bloqueos', (req, res) => {
    const r = agent.createBlock(req.body ?? {}, { actor: 'panel', ip: req.ip });
    if (!r.ok) return res.status(400).json({ error: 'The block was not created: check the marked fields.', errores: r.errors });
    return res.status(201).json({ ok: true, bloqueo: blockView(r.block) });
  });
  router.delete('/api/bloqueos/:id', (req, res) => {
    const r = agent.removeBlock(req.params.id);
    return r.ok ? res.json({ ok: true }) : res.status(404).json({ error: r.reason });
  });
  router.post('/api/bloqueos/:id/cancelar-reservas', wrap(async (req, res) => {
    const r = await agent.cancelBlockedBookings(req.params.id);
    return r.ok ? res.json({ ok: true, resultados: r.results }) : res.status(404).json({ error: r.reason });
  }));

  // --- Cierre del día ----------------------------------------------------------------
  router.get('/api/cierre', (_req, res) => {
    const u = agent.lastClosing();
    res.json({ ultimo: u ? { fecha: new Date(u.at).toISOString(), dia: u.day, reporte: u.report } : null });
  });
  router.post('/api/cierre', wrap(async (_req, res) => {
    const { report } = await agent.dailyClose();
    res.json({ ok: true, reporte: report });
  }));

  router.use((_req, res) => res.status(404).json({ error: 'That dashboard route does not exist.' }));
  return router;
}

function decisionView(d) {
  return { id: d.id, fecha: new Date(d.at).toISOString(), reserva: d.booking_id, tipo: d.kind, regla: d.rule, motivo: d.reason, tx: d.tx };
}
