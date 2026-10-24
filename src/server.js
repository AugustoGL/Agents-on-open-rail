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
import { localToUtcMs } from './time.js';
import { WARS, CELO_NETWORK } from './constants.js';

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
export function createApp({ agent, payments, registration = {}, logger = console, syncFacilitatorOnStart = true }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true, negocio: agent.business.nombre, wallet: agent.chain.address, modo: agent.chain.mode });
  });

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
      turnos: slots.map((s) => ({ recurso: s.resource, inicio: new Date(s.startAt).toISOString(), hora: s.time, libre: s.free })),
      diasDisponibles: dias,
    });
  });

  // Reservar desde otro agente o desde la web. Devuelve un token de cliente para poder cancelar después.
  app.post('/api/reservas', (req, res) => {
    const body = req.body ?? {};
    const startAt = parseStart(body, agent);
    if (!body.recurso || startAt == null) {
      return res.status(400).json({ error: 'Mandá recurso y (inicio ISO) o (fecha YYYY-MM-DD y hora HH:MM).' });
    }
    const wallet = body.cliente?.wallet && isAddress(body.cliente.wallet) ? getAddress(body.cliente.wallet) : undefined;
    const token = typeof body.cliente?.token === 'string' && /^api:[a-f0-9]{32}$/.test(body.cliente.token)
      ? body.cliente.token
      : `api:${randomBytes(16).toString('hex')}`;
    const customer = { id: token, name: String(body.cliente?.nombre ?? 'Cliente API').slice(0, 60), channel: 'api', wallet };
    const r = agent.reserve({ resource: body.recurso, startAt, customer });
    if (!r.ok) {
      const status = r.code === 'ocupado' ? 409 : r.code === 'muchas_reservas' ? 429 : 400;
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
  app.use('/static', express.static(PUBLIC_DIR, { index: false, maxAge: '1h' }));

  // --- Transparencia ------------------------------------------------------------------
  app.get('/api/decisiones', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 30, 200);
    res.json({
      decisiones: agent.store.decisions({ limit }).map((d) => ({
        id: d.id, fecha: new Date(d.at).toISOString(), reserva: d.booking_id, tipo: d.kind, regla: d.rule, motivo: d.reason, tx: d.tx,
      })),
    });
  });

  app.get(['/.well-known/agent-registration.json', '/agent.json'], (_req, res) => {
    res.json(buildRegistration({ agent, ...registration }));
  });

  app.use((req, res) => res.status(404).json({ error: `No existe ${req.method} ${req.path}` }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    logger.error?.(`[http] ${err.stack ?? err.message}`);
    res.status(500).json({ error: 'Error interno.' });
  });
  return app;
}

/** Archivo de registro ERC-8004 (registration-v1). */
export function buildRegistration({ agent, agentId, repoUrl, imageUrl }) {
  const base = agent.publicBaseUrl;
  const reg = {
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: `Seña · ${agent.business.nombre}`,
    description: 'Agente que cobra señas de turnos en wARS (peso argentino de Ripio) sobre Celo por x402 y decide solo qué hacer con cada cancelación: devuelve, retiene o reubica el turno con la lista de espera.' +
      (agent.business.esDemostracion ? ' Comercio de demostración.' : ''),
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
