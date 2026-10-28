// API HTTP del agente. Sirve para:
// - otros agentes de IA que reservan y pagan solos por x402;
// - la página /pagar/:id, donde una persona paga con su wallet;
// - el registro ERC-8004 (/.well-known/agent-registration.json) y el registro público de decisiones.
import express from 'express';
import { paymentMiddleware } from '@x402/express';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { isAddress, getAddress } from 'viem';
import { formatArs, weiToArsString } from './money.js';
import { localToUtcMs, localDateStr } from './time.js';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createPayingFetch, readPaymentResponse } from './buyer.js';
import { WARS, CELO_NETWORK } from './constants.js';
import { createPanelRouter, createRateLimit } from './panel.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public', import.meta.url));

export function publicBooking(agent, b) {
  return {
    id: b.id,
    recurso: b.resource,
    inicio: new Date(b.start_at).toISOString(),
    inicioLocal: agent.fmt(b.start_at),
    estado: b.status,
    origen: b.source,
    sena: { pesos: weiToArsString(b.deposit_wei), texto: formatArs(b.deposit_wei), wei: b.deposit_wei, token: WARS.address, red: CELO_NETWORK },
    venceEl: b.hold_expires_at ? new Date(b.hold_expires_at).toISOString() : null,
    pagoTx: b.pay_tx ?? null,
    devuelto: { pesos: weiToArsString(b.refunded_wei), texto: formatArs(b.refunded_wei) },
    pagarEn: agent.apiPayUrl(b),
    paginaDePago: agent.payUrl(b),
  };
}

const TOKEN_RE = /^api:[a-f0-9]{32}$/;
/** Texto de una persona: sin caracteres de control, con espacios simples y con largo máximo. */
const cleanText = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
/** Las direcciones de wallet no se muestran enteras en lo público. */
export const maskAddresses = (text) => String(text ?? '').replace(/0x[a-fA-F0-9]{40}(?![a-fA-F0-9])/g, (a) => `${a.slice(0, 6)}…${a.slice(-4)}`);

// Las páginas se arman con el DOM (nunca con innerHTML y datos), así que se puede cerrar todo lo demás.
const PAGE_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

function parseStart(body, agent) {
  if (body.inicio) {
    const ms = Date.parse(body.inicio);
    return Number.isNaN(ms) ? null : ms;
  }
  if (body.fecha && body.hora) return localToUtcMs(body.fecha, body.hora, agent.offset);
  return null;
}

/**
 * @param {object} deps
 * @param {import('./agent.js').SenaAgent} deps.agent
 * @param {{ server, routes }} deps.payments   resultado de createPaymentServer
 * @param {object} [deps.registration]          datos para el archivo ERC-8004
 */
export function createApp({
  agent, payments, registration = {}, logger = console, syncFacilitatorOnStart = true,
  dashboardPassword, trustProxy = false, createLimit = { windowMs: 10 * 60_000, max: 30 }, panelOptions = {},
}) {
  const app = express();
  app.disable('x-powered-by');
  // Detrás de un túnel o proxy (cloudflared) la IP real viene en X-Forwarded-For: solo se confía si se pidió.
  if (trustProxy) app.set('trust proxy', 1);
  app.use(express.json({ limit: '32kb' }));
  const limitCreates = createRateLimit(createLimit);
  const page = (file) => (_req, res) => res.set(PAGE_HEADERS).sendFile(join(PUBLIC_DIR, file));

  app.get('/health', (_req, res) => {
    res.json({ ok: true, negocio: agent.business.nombre, wallet: agent.chain.address, modo: agent.chain.mode });
  });

  // --- Solo en MODO PRUEBA: pagar sin billetera, por el mismo camino x402 (firma Permit2 real + facilitador simulado).
  // En modo real esta ruta ni existe.
  if (agent.chain.mode === 'mock') {
    app.post('/api/modo-prueba/pagar/:id', limitCreates, async (req, res, next) => {
      try {
        const check = agent.checkPayable(req.params.id);
        if (!check.ok) return res.status(check.status).json({ error: check.reason, codigo: check.code });
        const payingFetch = createPayingFetch({ signer: privateKeyToAccount(generatePrivateKey()), maxPerPaymentWei: BigInt(check.booking.deposit_wei) });
        const r = await payingFetch(`http://127.0.0.1:${req.socket.localPort}/api/reservas/${req.params.id}/pagar`, { method: 'POST' });
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          return res.status(r.status === 402 ? 502 : r.status).json({ error: body.error ?? 'No se pudo hacer el pago de prueba.', codigo: body.codigo });
        }
        return res.json({ ok: true, tx: readPaymentResponse(r)?.transaction ?? null });
      } catch (err) { return next(err); }
    });
  }

  // --- Páginas: reserva web, registro público de decisiones y panel del comercio -------------
  app.get('/', page('index.html'));
  app.get('/decisiones', page('decisiones.html'));
  app.get('/guia-estilos', page('css/guia-estilos.html'));
  app.get(['/panel', '/panel/'], page('panel.html'));
  app.use('/panel', createPanelRouter({ agent, password: dashboardPassword, logger, ...panelOptions }));

  app.get('/api/negocio', (_req, res) => {
    const b = agent.business;
    const p = b.politica;
    res.json({
      nombre: b.nombre,
      esDemostracion: Boolean(b.esDemostracion),
      descripcion: b.descripcion,
      recursos: b.recursos,
      horarios: b.horarios,
      duracionMinutos: b.duracionMinutos,
      precioTurno: formatArs(BigInt(b.precioTurnoArs) * 10n ** 18n),
      sena: formatArs(agent.depositWei()),
      moneda: { token: 'wARS', direccion: WARS.address, decimales: WARS.decimals, red: CELO_NETWORK },
      modoPrueba: agent.chain.mode === 'mock',
      hoy: localDateStr(agent.now(), agent.offset),
      listaEsperaMinutos: p.ofertaListaEsperaMinutos,
      diasAdelante: b.diasAdelante,
      anticipacionMinimaMinutos: b.anticipacionMinimaMinutos,
      reservaSinPagarMinutos: b.reservaSinPagarMinutos,
      politica: [
        `Cancelando con ${p.devolucionTotalHorasAntes} h o más de anticipación se devuelve toda la seña.`,
        `Entre ${p.devolucionParcialHorasAntes} y ${p.devolucionTotalHorasAntes} h antes se devuelve el ${p.devolucionParcialPorcentaje}%.`,
        `Con menos de ${p.devolucionParcialHorasAntes} h la seña queda para el negocio.`,
        p.devolverSiSeRevende ? 'Si el turno se vuelve a vender, se devuelve lo retenido.' : null,
        `Las reservas sin pagar se liberan a los ${b.reservaSinPagarMinutos} minutos.`,
      ].filter(Boolean),
    });
  });

  app.get('/api/turnos', (req, res) => {
    const fecha = typeof req.query.fecha === 'string' ? req.query.fecha : undefined;
    if (fecha && !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return res.status(400).json({ error: 'fecha tiene que ser YYYY-MM-DD' });
    const dias = agent.bookableDays();
    const dia = fecha ?? dias.find((d) => agent.listSlots({ dateStr: d, onlyFree: true }).length > 0) ?? dias[0];
    const slots = agent.listSlots({ dateStr: dia, onlyFree: req.query.libres !== 'no' });
    res.json({
      fecha: dia ?? null,
      sena: formatArs(agent.depositWei()),
      turnos: slots.map((s) => ({
        recurso: s.resource, inicio: new Date(s.startAt).toISOString(), hora: s.time, libre: s.free,
        estado: s.blocked ? 'bloqueado' : s.free ? 'libre' : 'ocupado', motivo: s.blockReason,
      })),
      diasDisponibles: dias,
    });
  });

  // Reservar desde otro agente o desde la web. Devuelve un token de cliente para poder cancelar después.
  app.post('/api/reservas', limitCreates, (req, res) => {
    const body = req.body ?? {};
    const startAt = parseStart(body, agent);
    if (!body.recurso || startAt == null) {
      return res.status(400).json({ error: 'Mandá recurso y (inicio ISO) o (fecha YYYY-MM-DD y hora HH:MM).' });
    }
    const wallet = body.cliente?.wallet && isAddress(body.cliente.wallet) ? getAddress(body.cliente.wallet) : undefined;
    const token = typeof body.cliente?.token === 'string' && /^api:[a-f0-9]{32}$/.test(body.cliente.token)
      ? body.cliente.token
      : `api:${randomBytes(16).toString('hex')}`;
    const customer = {
      id: token, name: cleanText(body.cliente?.nombre, 60) || 'Cliente API', channel: body.cliente?.canal === 'web' ? 'web' : 'api', wallet,
      contact: cleanText(body.cliente?.contacto, 80) || undefined,
    };
    const r = agent.reserve({ resource: body.recurso, startAt, customer });
    if (!r.ok) {
      const status = ['ocupado', 'bloqueado'].includes(r.code) ? 409 : r.code === 'muchas_reservas' ? 429 : 400;
      return res.status(status).json({ error: r.reason, codigo: r.code });
    }
    res.status(201).json({ reserva: publicBooking(agent, r.booking), clienteToken: token });
  });

  app.get('/api/reservas/:id', (req, res) => {
    const b = agent.store.getBooking(req.params.id);
    if (!b) return res.status(404).json({ error: 'No existe esa reserva.' });
    res.json({ reserva: publicBooking(agent, b) });
  });

  app.post('/api/reservas/:id/cancelar', async (req, res, next) => {
    try {
      const token = req.body?.clienteToken;
      if (typeof token !== 'string') return res.status(400).json({ error: 'Falta clienteToken.' });
      const r = await agent.cancel({ bookingId: req.params.id, customerId: token });
      if (!r.ok) return res.status(409).json({ error: r.reason });
      res.json({ ok: true, regla: r.rule, motivo: r.reason, devolucion: formatArs(r.refundWei) });
    } catch (err) { next(err); }
  });

  app.post('/api/reservas/:id/lista-espera', (req, res) => {
    const b = agent.store.getBooking(req.params.id);
    const token = req.body?.clienteToken;
    if (!b || typeof token !== 'string') return res.status(400).json({ error: 'Falta la reserva o el clienteToken.' });
    const r = agent.joinWaitlist({ resource: b.resource, startAt: b.start_at, customer: { id: token, name: 'Cliente API', channel: 'api' } });
    if (!r.ok) return res.status(409).json({ error: r.reason });
    res.json({ ok: true, puesto: r.position });
  });

  // Lo que usa la web: anotarse en la lista de espera de un turno ocupado, sin conocer la reserva de otro.
  app.post('/api/lista-espera', limitCreates, (req, res) => {
    const body = req.body ?? {};
    const startAt = parseStart(body, agent);
    if (!body.recurso || startAt == null) return res.status(400).json({ error: 'Mandá recurso y (inicio ISO) o (fecha YYYY-MM-DD y hora HH:MM).' });
    const token = typeof body.cliente?.token === 'string' && TOKEN_RE.test(body.cliente.token) ? body.cliente.token : `api:${randomBytes(16).toString('hex')}`;
    const customer = {
      id: token, name: cleanText(body.cliente?.nombre, 60) || 'Cliente web', channel: body.cliente?.canal === 'web' ? 'web' : 'api',
      contact: cleanText(body.cliente?.contacto, 80) || undefined,
    };
    const r = agent.joinWaitlist({ resource: body.recurso, startAt, customer });
    if (!r.ok) return res.status(409).json({ error: r.reason, codigo: r.code });
    return res.json({ ok: true, puesto: r.position, clienteToken: token });
  });

  // "Mis reservas" de la web: el clienteToken viaja en el cuerpo (nunca en la URL).
  app.post('/api/mis-reservas', (req, res) => {
    const token = req.body?.clienteToken;
    if (typeof token !== 'string' || !TOKEN_RE.test(token)) return res.status(400).json({ error: 'Falta el clienteToken.' });
    const reservas = agent.store.bookingsForCustomer(token).map((b) => publicBooking(agent, b));
    const esperas = agent.store.waitlistForCustomer(token).map((w) => ({
      recurso: w.resource, inicio: new Date(w.start_at).toISOString(), inicioLocal: agent.fmt(w.start_at),
      estado: w.status, puesto: w.status === 'waiting' ? agent.store.waitlistPosition(w) : null,
    }));
    return res.json({ reservas, esperas });
  });

  // Antes de cancelar: cuánto devuelve la política y por qué (la que valía cuando se pagó).
  app.post('/api/reservas/:id/cancelar-vista', (req, res) => {
    const token = req.body?.clienteToken;
    if (typeof token !== 'string') return res.status(400).json({ error: 'Falta clienteToken.' });
    const p = agent.previewCancel({ bookingId: req.params.id, customerId: token });
    if (!p.ok) return res.status(409).json({ error: p.reason });
    return res.json({ ok: true, devolucion: formatArs(p.refundWei), regla: p.rule, motivo: p.reason, reserva: publicBooking(agent, p.booking) });
  });

  // --- Cobro x402 ---------------------------------------------------------------
  // 1) Antes de pedir el pago: si la reserva no se puede pagar, se corta acá y nadie firma nada.
  app.post('/api/reservas/:id/pagar', (req, res, next) => {
    const check = agent.checkPayable(req.params.id);
    if (check.ok || (req.get('payment-signature') && agent.canAcceptLatePayment(req.params.id))) return next();
    return res.status(check.status).json({ error: check.reason, codigo: check.code, reserva: check.booking ? publicBooking(agent, check.booking) : null });
  });
  // 2) x402: responde 402 con el precio en wARS, verifica la firma y liquida con el facilitador.
  if (payments) app.use(paymentMiddleware(payments.routes, payments.server, undefined, undefined, syncFacilitatorOnStart));
  // 3) Solo se llega acá con el pago verificado. La confirmación final la hace onAfterSettle.
  app.post('/api/reservas/:id/pagar', (req, res) => {
    const b = agent.store.getBooking(req.params.id);
    res.json({ ok: true, mensaje: 'Seña pagada. Turno confirmado.', reserva: publicBooking(agent, { ...b, status: 'confirmed' }) });
  });

  // --- Página de pago para personas ------------------------------------------------
  app.get('/pagar/:id', (_req, res) => res.sendFile(join(PUBLIC_DIR, 'pagar.html')));
  app.use('/static', express.static(PUBLIC_DIR, { index: false, maxAge: 0 })); // revalida con ETag: los cambios de diseño se ven al recargar

  // --- Transparencia ------------------------------------------------------------------
  // Datos de una decisión que se pueden mostrar al público: números y textos, nunca nombres ni billeteras.
  const publicData = (d) => {
    let data = {};
    try { data = d.data ? JSON.parse(d.data) : {}; } catch { /* sin datos */ }
    const out = {};
    if (typeof data.hoursBefore === 'number') out.horasAntes = Math.round(data.hoursBefore * 10) / 10;
    if (data.refundWei !== undefined) out.devolucion = formatArs(data.refundWei);
    if (data.collected !== undefined) out.cobrado = formatArs(data.collected);
    if (data.refunded !== undefined) out.devuelto = formatArs(data.refunded);
    if (data.by === 'owner') out.cancelaElComercio = true;
    if (d.kind === 'cobro' && d.booking_id) {
      const b = agent.store.getBooking(d.booking_id);
      if (b) out.monto = formatArs(b.deposit_wei);
    }
    return out;
  };

  app.get('/api/decisiones', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 30, 200);
    res.json({
      decisiones: agent.store.decisions({ limit }).map((d) => ({
        id: d.id, fecha: new Date(d.at).toISOString(), reserva: d.booking_id, tipo: d.kind, regla: d.rule, motivo: maskAddresses(d.reason), tx: d.tx, datos: publicData(d),
      })),
    });
  });

  // Números del agente para la página pública: solo totales.
  app.get('/api/resumen-publico', (_req, res) => {
    const counts = agent.store.decisionCounts();
    const c = (...rules) => rules.reduce((n, r) => n + (counts[r] ?? 0), 0);
    const { total, desde } = agent.store.decisionsSummary();
    res.json({
      decisiones: total,
      desde: desde ? new Date(desde).toISOString() : null,
      senasCobradas: c('SENA_COBRADA', 'PAGO_TARDIO_ACEPTADO'),
      cancelaciones: c('A_TIEMPO', 'TARDE_PARCIAL', 'MUY_TARDE', 'SIN_PAGO', 'CANCELADO_POR_COMERCIO'),
      devolucionesEnviadas: c('DEVOLUCION_ENVIADA'),
      montoDevuelto: formatArs(agent.store.sentRefundsTotal()),
      turnosReubicados: c('OFERTA_LISTA_ESPERA'),
      reservasLiberadas: c('RESERVA_VENCIDA'),
    });
  });

  app.get(['/.well-known/agent-registration.json', '/agent.json'], (_req, res) => {
    res.json(buildRegistration({ agent, ...registration }));
  });

  app.use((req, res) => res.status(404).json({ error: `No existe ${req.method} ${req.path}` }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err.status === 400 || err.type === 'entity.parse.failed') return res.status(400).json({ error: 'El cuerpo del pedido no es un JSON válido.' });
    if (err.status === 413) return res.status(413).json({ error: 'El pedido es demasiado grande.' });
    logger.error?.(`[http] ${err.stack ?? err.message}`);
    return res.status(500).json({ error: 'Error interno.' });
  });
  return app;
}

/** Archivo de registro ERC-8004 (registration-v1). */
export function buildRegistration({ agent, agentId, repoUrl, imageUrl }) {
  const base = agent.publicBaseUrl;
  const reg = {
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: `Seña · ${agent.business.nombre}`,
    description: 'Agente que cobra señas en wARS por x402, aplica una política de cancelación y reubica turnos con lista de espera; reserva por Telegram, web o API.' +
      (agent.business.esDemostracion ? ' Comercio de demostración: los turnos y precios son de ejemplo.' : ''),
    services: [
      { name: 'web', endpoint: base },
      { name: 'x402', endpoint: `${base}/api/reservas/{id}/pagar`, version: '2' },
      { name: 'api', endpoint: `${base}/api/turnos` },
      { name: 'wallet', endpoint: `eip155:42220:${agent.chain.address}` },
    ],
    x402Support: true,
    active: true,
    supportedTrust: ['reputation'],
  };
  if (repoUrl) reg.services.push({ name: 'source', endpoint: repoUrl });
  if (imageUrl) reg.image = imageUrl;
  if (agentId) reg.registrations = [{ agentId: Number(agentId), agentRegistry: 'eip155:42220:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' }];
  return reg;
}
