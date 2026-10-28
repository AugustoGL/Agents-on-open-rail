// Datos de demostración: reservas ficticias en todos los estados y decisiones variadas, para que el panel,
// el registro público y las capturas no se vean vacíos. Solo para el MODO PRUEBA (cadena simulada).
// Todo es inventado: nombres, billeteras y transacciones.
import { randomBytes } from 'node:crypto';
import { SenaAgent } from '../src/agent.js';
import { createMockChain } from '../src/chain.js';
import { BusinessSettings } from '../src/settings.js';
import { loadBusiness } from '../src/config.js';
import { localToUtcMs, localDateStr, addDays } from '../src/time.js';

const hex = (n) => randomBytes(n).toString('hex');
const wallet = () => `0x${hex(20)}`;
const quiet = { info() {}, warn() {}, error() {} };

/**
 * Carga el escenario en la base. Devuelve un resumen con lo que creó.
 * @param {{ store: object, hoyMs?: number, payoutAddress?: string }} opts
 */
export async function sembrar({ store, hoyMs = Date.now(), payoutAddress = '0x000000000000000000000000000000000000dEaD' }) {
  const business = new BusinessSettings(store).loadOrSeed(() => loadBusiness());
  const offset = business.utcOffsetMinutos;
  const today = localDateStr(hoyMs, offset);
  const T = (dayOff, hhmm) => localToUtcMs(addDays(today, dayOff), hhmm, offset);

  let now = T(-6, '10:00');
  const clock = { now: () => now };
  const chain = createMockChain({ logger: quiet });
  const agent = new SenaAgent({ store, business, chain, clock, logger: quiet, payoutAddress });
  const at = (ms) => { now = Math.max(now, ms); };

  const personas = {
    marta: { name: 'Marta G.', channel: 'web', contact: '351 555-0101' },
    beto: { name: 'Beto P.', channel: 'telegram', contact: null },
    luli: { name: 'Luli R.', channel: 'web', contact: 'luli@ejemplo.com' },
    nico: { name: 'Nico S.', channel: 'web', contact: null },
    ceci: { name: 'Ceci T.', channel: 'telegram', contact: null },
    fede: { name: 'Fede A.', channel: 'web', contact: '351 555-0102' },
    sofi: { name: 'Sofi M.', channel: 'api', contact: null },
    tomas: { name: 'Tomás L.', channel: 'web', contact: null },
    vale: { name: 'Vale D.', channel: 'telegram', contact: null },
    juani: { name: 'Juani C.', channel: 'web', contact: '351 555-0103' },
    ana: { name: 'Ana B.', channel: 'api', contact: null },
    pablo: { name: 'Pablo E.', channel: 'web', contact: null },
    lara: { name: 'Lara F.', channel: 'telegram', contact: null },
    gus: { name: 'Gus H.', channel: 'web', contact: '351 555-0104' },
  };
  let tg = 1000;
  for (const p of Object.values(personas)) {
    p.id = p.channel === 'telegram' ? `tg:${++tg}` : `api:${hex(16)}`;
    p.wallet = wallet();
  }

  const reservar = (quien, resource, dayOff, hora, { source } = {}) => {
    const r = agent.reserve({ resource, startAt: T(dayOff, hora), customer: { ...personas[quien] }, source });
    if (!r.ok) throw new Error(`Semilla: no se pudo reservar ${resource} ${dayOff} ${hora} (${r.reason})`);
    return r.booking;
  };
  const pagar = async (quien, booking) => {
    chain.credit(booking.deposit_wei);
    await agent.onPaymentSettled({ bookingId: booking.id, payer: personas[quien].wallet, tx: `0x${hex(32)}`, amountWei: booking.deposit_wei });
  };
  const cancelar = (quien, booking) => agent.cancel({ bookingId: booking.id, customerId: personas[quien].id });
  const crear = {};

  // 1. Un turno jugado (estado "jugada").
  at(T(-6, '10:00'));
  const b1 = reservar('marta', 'Cancha 1', -5, '20:00');
  at(T(-6, '10:06')); await pagar('marta', b1);

  // 2. Cancelación a tiempo: devuelve toda la seña.
  at(T(-6, '11:00'));
  const b2 = reservar('beto', 'Cancha 2', -5, '18:30');
  at(T(-6, '11:04')); await pagar('beto', b2);
  at(T(-6, '15:30')); await cancelar('beto', b2);

  // 3. Se juega el turno de Marta y se cierra el día.
  at(T(-5, '22:00')); agent.completeFinished();
  await agent.dailyClose({ dateStr: addDays(today, -5) });

  // 4. Reservas que van a terminar en cancelación tardía, reventa y lista de espera (se resuelven en orden de reloj, abajo).
  at(T(-5, '09:00'));
  const b3 = reservar('luli', 'Cancha 1', -3, '21:30');
  at(T(-5, '09:05')); await pagar('luli', b3);
  at(T(-4, '10:00'));
  agent.joinWaitlist({ resource: 'Cancha 1', startAt: T(-3, '21:30'), customer: { ...personas.nico } });
  at(T(-4, '12:00'));
  const b4 = reservar('ceci', 'Cancha 2', -2, '12:00');
  at(T(-4, '12:03')); await pagar('ceci', b4);

  // 5. Una reserva que nadie paga: se libera sola.
  at(T(-3, '16:00'));
  reservar('fede', 'Cancha 1', -2, '17:00');
  at(T(-3, '16:20')); await agent.expireHolds();

  // 6. Cancelación muy tardía de Luli (2,5 h antes): la seña queda, se le ofrece el turno a Nico, Nico paga y a Luli se le devuelve.
  at(T(-3, '19:00')); await cancelar('luli', b3);
  const oferta = store.activeBookingForSlot('Cancha 1', T(-3, '21:30'));
  at(T(-3, '19:12')); await pagar('nico', oferta);
  // Cancelación tardía parcial de Ceci (15 h antes): devuelve el 50 %.
  at(T(-3, '21:00')); await cancelar('ceci', b4);

  // 7. Otra jugada, y cierre del día con retiro.
  at(T(-2, '11:00'));
  const b5 = reservar('sofi', 'Cancha 2', -1, '20:00');
  at(T(-2, '11:02')); await pagar('sofi', b5);
  at(T(-1, '23:00')); agent.completeFinished();
  await agent.dailyClose({ dateStr: addDays(today, -1) });

  // 8. El comercio cambia la configuración y la devuelve a como estaba.
  at(T(-1, '23:40'));
  agent.updateSettings({ politica: { ofertaListaEsperaMinutos: 45 } }, { ip: '127.0.0.1' });
  at(T(-1, '23:50'));
  agent.updateSettings({ politica: { ofertaListaEsperaMinutos: business.politica.ofertaListaEsperaMinutos } }, { ip: '127.0.0.1' });

  // 9. Devoluciones grandes: esperan al dueño; una se aprueba, otra se rechaza y otra queda pendiente.
  at(T(0, '08:00'));
  const grandes = [];
  for (const [quien, cancha, hora] of [['juani', 'Cancha 1', '09:00'], ['pablo', 'Cancha 2', '09:00'], ['lara', 'Cancha 1', '10:30']]) {
    const b = reservar(quien, cancha, 3, hora);
    at(now + 120_000); await pagar(quien, b); grandes.push([quien, b]);
  }
  agent.updateSettings({ limites: { devolucionMaxAutomaticaArs: 1000, devolucionesMaxDiariasArs: 5000 } });
  for (const [quien, b] of grandes) { at(now + 60_000); await cancelar(quien, b); }
  agent.updateSettings({ limites: { devolucionMaxAutomaticaArs: business.limites.devolucionMaxAutomaticaArs, devolucionesMaxDiariasArs: business.limites.devolucionesMaxDiariasArs } });
  const esperando = store.transfersByStatus('needs_owner');
  at(now + 60_000); await agent.approveTransfer(esperando[0].id);
  at(now + 60_000); await agent.rejectTransfer(esperando[1].id);

  // 10. Reservas de los próximos días en distintos estados + bloqueos.
  at(T(0, '08:30'));
  const futuras = [
    ['tomas', 'Cancha 1', 2, '20:00', true], ['gus', 'Cancha 2', 1, '20:00', true], ['marta', 'Cancha 1', 1, '18:30', true],
    ['vale', 'Cancha 2', 4, '21:30', true], ['ana', 'Cancha 1', 5, '17:00', true], ['beto', 'Cancha 2', 2, '18:30', true],
  ];
  for (const [quien, cancha, off, hora] of futuras) { const b = reservar(quien, cancha, off, hora); at(now + 90_000); await pagar(quien, b); crear[`${quien}-${off}`] = b; }
  // Dos que esperan el pago (con tiempo de sobra) y una persona en lista de espera.
  at(Math.max(now, hoyMs - 3 * 60_000));
  const sinPagar = [['luli', 'Cancha 2', 1, '21:30'], ['fede', 'Cancha 1', 1, '20:00']];
  for (const [quien, cancha, off, hora] of sinPagar) reservar(quien, cancha, off, hora);
  agent.joinWaitlist({ resource: 'Cancha 1', startAt: T(1, '18:30'), customer: { ...personas.lara } });

  // Bloqueos: uno con una reserva pagada adentro que el dueño canceló (devolución total), uno vigente con aviso y dos vacíos.
  at(Math.max(now, hoyMs - 2 * 60_000));
  const feriado = agent.createBlock({ tipo: 'dia', fecha: addDays(today, 2), motivo: 'Feriado' }, { ip: '127.0.0.1' });
  await agent.cancelBlockedBookings(feriado.block.id);
  agent.createBlock({ tipo: 'dia', fecha: addDays(today, 4), motivo: 'Torneo del club' }, { ip: '127.0.0.1' }); // deja una reserva pagada adentro: el panel avisa
  agent.createBlock({ tipo: 'recurso', recurso: 'Cancha 2', fecha: addDays(today, 5), hasta: addDays(today, 6), motivo: 'Mantenimiento' }, { ip: '127.0.0.1' });
  agent.createBlock({ tipo: 'turno', recurso: 'Cancha 1', fecha: addDays(today, 1), hora: '12:00', motivo: 'Clase de pádel' }, { ip: '127.0.0.1' });

  now = hoyMs;
  return {
    reservas: store.searchBookings({ limit: 500 }).length,
    decisiones: store.decisionsSummary().total,
    estados: Object.fromEntries(['held', 'confirmed', 'cancelled', 'expired', 'completed'].map((s) => [s, store.searchBookings({ status: s, limit: 500 }).length])),
    pendientes: store.transfersByStatus('needs_owner').length,
    bloqueos: store.activeBlocks(hoyMs).length,
  };
}
