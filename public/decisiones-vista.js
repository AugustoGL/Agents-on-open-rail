// How each agent decision is shown, in plain English. Lo usan la página pública /decisiones y el panel.
// Todo entra como texto (nunca como HTML) y la parte pública no lleva nombres ni billeteras.
import { h, ahoraServidor, fmtFecha, isTxHash, safeHref, abreviar } from '/static/dom.js';

const TZ = 'America/Argentina/Cordoba';

/** Por cada regla: categoría (color e ícono), título legible y la explicación de por qué decide así. */
const REGLAS = {
  TURNO_LIBRE: { cat: 'espera', grupo: 'turnos', titulo: () => 'Held a slot while waiting for payment', explica: 'When someone books a free slot, the agent holds it for a few minutes so they can pay the deposit.' },
  OFERTA_LISTA_ESPERA: { cat: 'espera', grupo: 'turnos', titulo: () => 'Offered a freed slot to the waitlist', explica: 'When a slot frees up, the agent offers it first to whoever was waiting, in order of arrival.' },
  SENA_COBRADA: { cat: 'cobro', grupo: 'cobros', titulo: (x) => `Collected a deposit${x.monto ? ` of ${x.monto}` : ''}`, explica: 'The deposit is charged with x402 in wARS. Once the payment is confirmed on the network, the slot is confirmed.' },
  PAGO_TARDIO_ACEPTADO: { cat: 'cobro', grupo: 'cobros', titulo: () => 'Accepted a payment that arrived just late', explica: 'If a payment arrives after the booking expired but the slot is still free, it is accepted. Otherwise it is refunded.' },
  PAGO_A_DEVOLVER: { cat: 'devolucion', grupo: 'cobros', titulo: () => 'Refunded a payment that did not belong', explica: 'If a payment arrives that matches no payable booking (different amount, slot taken, duplicate), it is refunded in full.' },
  A_TIEMPO: { cat: 'devolucion', grupo: 'cancelaciones', titulo: (x) => `Cancelled ${hs(x)} ahead: refunded the whole deposit`, explica: 'If it is cancelled with the minimum notice the venue sets, 100 % of the deposit is refunded and the slot is offered to the waitlist.' },
  TARDE_PARCIAL: { cat: 'retencion', grupo: 'cancelaciones', titulo: (x) => `Cancelled ${hs(x)} ahead: refunded part of it`, explica: 'Between the full-refund window and the partial window, a percentage of the deposit is refunded. The rest stays with the venue and is refunded if the slot is resold (if the venue chose that).' },
  MUY_TARDE: { cat: 'retencion', grupo: 'cancelaciones', titulo: (x, d) => `Cancelled ${hs(x)} ahead: the deposit is kept${/resold/.test(d.motivo) ? '; if the slot is resold, it is refunded' : ''}`, explica: 'With very little notice the deposit stays with the venue, which loses the slot. If the slot is sold again, the venue lost nothing and the deposit is refunded (if the policy allows it).' },
  SIN_PAGO: { cat: 'cancelacion', grupo: 'cancelaciones', titulo: () => 'Cancellation without payment: there was no money to refund', explica: 'If it is cancelled before the deposit is paid, nothing is charged or refunded, and the slot is free again.' },
  CANCELADO_POR_COMERCIO: { cat: 'devolucion', grupo: 'cancelaciones', titulo: () => 'The venue cancelled the slot and refunded the whole deposit', explica: 'When the venue is the one that cancels (for example, for a public holiday), the deposit is refunded in full without applying the cancellation policy.' },
  TURNO_EMPEZADO: { cat: 'aviso', grupo: 'cancelaciones', titulo: () => 'Rejected a cancellation: the slot had already started', explica: 'Once the slot has started it can no longer be cancelled or refunded.' },
  REVENTA: { cat: 'devolucion', grupo: 'cancelaciones', titulo: () => 'The slot was resold: refunded what it had kept', explica: 'If a slot whose deposit was kept is sold again, the venue lost nothing: what was kept is refunded.' },
  REVENTA_SIN_DEVOLUCION: { cat: 'libera', grupo: 'cancelaciones', titulo: () => 'The slot was resold: there was nothing left to refund', explica: 'Everything had already been refunded, or the policy does not refund on resale.' },
  RESERVA_VENCIDA: { cat: 'libera', grupo: 'turnos', titulo: () => 'Released a slot because it was not paid in time', explica: 'If nobody pays the deposit within the time the venue sets, the slot is released so someone else can take it.' },
  ANOTADO: { cat: 'espera', grupo: 'turnos', titulo: () => 'Added someone to the waitlist', explica: 'Whoever wants a taken slot joins the waitlist; if the slot frees up, they are first to get the offer.' },
  SALTEADO: { cat: 'aviso', grupo: 'turnos', titulo: () => 'Skipped someone on the waitlist', explica: 'If the slot could not be offered to whoever was first, the agent moves on to the next person.' },
  DEVOLUCION_ENVIADA: { cat: 'devolucion', grupo: 'transferencias', titulo: () => 'Sent a refund', explica: 'Refunds leave the agent\'s wallet, with its attribution tag, and go back to the wallet that paid.' },
  RETIRO_ENVIADO: { cat: 'cierre', grupo: 'transferencias', titulo: () => 'Sent the withdrawal to the venue', explica: 'When the day closes, the agent transfers to the owner only what is no longer committed to future slots.' },
  ESPERA_DUENO: { cat: 'aviso', grupo: 'transferencias', titulo: () => 'Asked the owner for approval before sending money', explica: 'Large refunds, or many in one day, do not go out on their own: the owner approves or rejects them.' },
  APROBADA_POR_DUENO: { cat: 'cobro', grupo: 'transferencias', titulo: () => 'The owner approved a transfer', explica: 'The transfer that was waiting for approval goes out once the owner approves it.' },
  RECHAZADA_POR_DUENO: { cat: 'cancelacion', grupo: 'transferencias', titulo: () => 'The owner rejected a transfer', explica: 'If the owner rejects it, nothing is sent.' },
  FALLO_SIN_ENVIAR: { cat: 'aviso', grupo: 'transferencias', titulo: () => 'A transfer failed and no money left', explica: 'When it is known that nothing went out, the owner is told and it can be retried.' },
  ESTADO_INCIERTO: { cat: 'aviso', grupo: 'transferencias', titulo: () => 'A transfer was left under review', explica: 'If it is not known whether a transfer went out, the agent does NOT retry it on its own, to avoid paying twice: it tells the owner.' },
  SIN_DESTINO: { cat: 'aviso', grupo: 'transferencias', titulo: () => 'There was nowhere to send the money back', explica: 'Without a destination wallet, the owner has to resolve the refund.' },
  JUGADO: { cat: 'cierre', grupo: 'turnos', titulo: () => 'Closed a played slot: the deposit goes to the venue', explica: 'When the slot ends, the deposit is no longer committed and belongs to the venue.' },
  SIN_RETIRO: { cat: 'cierre', grupo: 'transferencias', titulo: () => 'Closed the day: nothing free to withdraw', explica: 'The withdrawal never touches deposits for future slots: only what already belongs to the venue is withdrawn.' },
  RETIRO: { cat: 'cierre', grupo: 'transferencias', titulo: () => 'Closed the day and prepared the withdrawal', explica: 'Balance minus what is committed to future slots: that is what is transferred to the owner.' },
  RETIRO_CON_TOPE: { cat: 'cierre', grupo: 'transferencias', titulo: () => 'Closed the day and prepared the withdrawal (capped)', explica: 'If the free amount is above the maximum per transfer, it withdraws up to the cap.' },
  NFT_ENVIADO: { cat: 'cobro', grupo: 'turnos', titulo: () => 'Sent the booking to the wallet as an NFT', explica: 'When the payment is confirmed, the agent sends the wallet that paid a non-transferable NFT ticket with the booking details. It shows in the wallet without depending on any server.' },
  NFT_QUEMADO: { cat: 'libera', grupo: 'turnos', titulo: () => 'Burned the NFT ticket of a cancelled booking', explica: 'If the booking is cancelled, its ticket ceases to exist: the wallet only shows current bookings.' },
  NFT_USADO: { cat: 'cierre', grupo: 'turnos', titulo: () => 'Marked an NFT ticket as played', explica: 'When the slot is played, the ticket changes to "played" and stays in the wallet as a keepsake.' },
  NFT_FALLO: { cat: 'aviso', grupo: 'turnos', titulo: () => 'Could not send an NFT ticket (the booking stands)', explica: 'If the chain fails, the booking stays confirmed anyway: the ticket is retried on its own and, if it does not go out, the owner can retry from the dashboard.' },
  CONFIGURACION_CAMBIADA: { cat: 'cambio', grupo: 'comercio', titulo: () => 'The venue changed its settings', explica: 'Changes apply to new bookings: those already paid keep their deposit and policy.' },
  BLOQUEO_CREADO: { cat: 'cambio', grupo: 'comercio', titulo: () => 'The venue blocked slots', explica: 'A block (public holiday, maintenance) takes slots off the schedule. If there were already paid bookings, the venue decides whether to cancel them and refund everything.' },
  BLOQUEO_QUITADO: { cat: 'cambio', grupo: 'comercio', titulo: () => 'The venue removed a block', explica: 'The slots are available again.' },
};

function hs(x) {
  if (typeof x.horasAntes !== 'number') return 'in advance';
  const n = x.horasAntes;
  return `${Number.isInteger(n) ? n : n.toFixed(1)} h`;
}

export const GRUPOS = [
  ['', 'All'], ['cobros', 'Payments'], ['cancelaciones', 'Cancellations'], ['turnos', 'Slots and waitlist'], ['transferencias', 'Transfers'], ['comercio', 'Venue changes'],
];

export const grupoDe = (d) => REGLAS[d.regla]?.grupo ?? 'turnos';
export const reglaDe = (d) => REGLAS[d.regla];
export const tituloDe = (d) => REGLAS[d.regla]?.titulo(d.datos ?? {}, d) ?? d.regla;

const claveDia = (iso) => new Intl.DateTimeFormat('sv-SE', { timeZone: TZ }).format(new Date(iso));
const hora = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));

/** Agrupa por día ("Today", "Yesterday", "Wednesday 21 October") respetando el orden (lo más nuevo primero). */
export function agruparPorDia(decisiones) {
  const ahora = ahoraServidor();
  const hoy = claveDia(new Date(ahora).toISOString());
  const ayer = claveDia(new Date(ahora - 24 * 3_600_000).toISOString());
  const grupos = [];
  for (const d of decisiones) {
    const k = claveDia(d.fecha);
    let g = grupos.at(-1);
    if (!g || g.clave !== k) { g = { clave: k, etiqueta: k === hoy ? 'Today' : k === ayer ? 'Yesterday' : fmtFecha(k), items: [] }; grupos.push(g); }
    g.items.push(d);
  }
  return grupos;
}

/**
 * @param {object} d decisión de /api/decisiones
 * @param {{ modoPrueba?: boolean, onReserva?: (id: string) => void }} [opts]  onReserva solo en el panel
 */
export function tarjetaDecision(d, { modoPrueba = false, onReserva } = {}) {
  const regla = REGLAS[d.regla];
  const real = isTxHash(d.tx) && !modoPrueba;
  return h('article', { class: `decision cat-${regla?.cat ?? 'aviso'}` },
    h('div', { class: 'decision-icono', 'aria-hidden': 'true' }),
    h('div', { class: 'decision-cuerpo' },
      h('h3', { class: 'decision-titulo' }, tituloDe(d)),
      h('p', { class: 'decision-detalle' }, d.motivo),
      h('div', { class: 'decision-meta' },
        h('time', { datetime: d.fecha }, hora(d.fecha)),
        h('span', {}, 'Rule ', h('code', {}, d.regla)),
        onReserva && d.reserva ? h('button', { type: 'button', class: 'btn btn-fantasma btn-chico', onclick: () => onReserva(d.reserva) }, `Booking ${d.reserva}`) : null,
        isTxHash(d.tx) ? (real
          ? h('a', { href: safeHref(`https://celoscan.io/tx/${d.tx}`), target: '_blank', rel: 'noopener noreferrer' }, `Transaction ${abreviar(d.tx)}`)
          : h('span', {}, `Simulated transaction ${abreviar(d.tx)}`)) : null),
      regla ? h('details', {}, h('summary', {}, 'Why did it decide this?'), h('p', {}, regla.explica)) : null));
}
