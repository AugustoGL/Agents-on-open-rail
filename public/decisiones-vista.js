// Cómo se muestra cada decisión del agente, en castellano claro. Lo usan la página pública /decisiones y el panel.
// Todo entra como texto (nunca como HTML) y la parte pública no lleva nombres ni billeteras.
import { h, ahoraServidor, fmtFecha, isTxHash, safeHref, abreviar } from '/static/dom.js';

const TZ = 'America/Argentina/Cordoba';

/** Por cada regla: categoría (color e ícono), título legible y la explicación de por qué decide así. */
const REGLAS = {
  TURNO_LIBRE: { cat: 'espera', grupo: 'turnos', titulo: () => 'Guardó un turno mientras esperaba el pago', explica: 'Cuando alguien reserva un turno libre, el agente lo guarda unos minutos para que pueda pagar la seña.' },
  OFERTA_LISTA_ESPERA: { cat: 'espera', grupo: 'turnos', titulo: () => 'Le ofreció un turno liberado a la lista de espera', explica: 'Si se libera un turno, el agente se lo ofrece primero a quien estaba esperando, en orden de llegada.' },
  SENA_COBRADA: { cat: 'cobro', grupo: 'cobros', titulo: (x) => `Cobró una seña${x.monto ? ` de ${x.monto}` : ''}`, explica: 'La seña se cobra por x402 en wARS. Cuando el pago se confirma en la red, el turno queda confirmado.' },
  PAGO_TARDIO_ACEPTADO: { cat: 'cobro', grupo: 'cobros', titulo: () => 'Aceptó un pago que llegó justo tarde', explica: 'Si el pago llega después de vencer la reserva pero el turno sigue libre, se acepta. Si no, se devuelve.' },
  PAGO_A_DEVOLVER: { cat: 'devolucion', grupo: 'cobros', titulo: () => 'Devolvió un pago que no correspondía', explica: 'Si llega un pago que no coincide con ninguna reserva pagable (monto distinto, turno ocupado, duplicado), se devuelve completo.' },
  A_TIEMPO: { cat: 'devolucion', grupo: 'cancelaciones', titulo: (x) => `Canceló ${hs(x)} antes: devolvió toda la seña`, explica: 'Si se cancela con la anticipación mínima que fija el comercio, se devuelve el 100 % de la seña y el turno se ofrece a la lista de espera.' },
  TARDE_PARCIAL: { cat: 'retencion', grupo: 'cancelaciones', titulo: (x) => `Canceló ${hs(x)} antes: devolvió una parte`, explica: 'Entre el plazo total y el plazo parcial se devuelve un porcentaje de la seña. El resto queda para el comercio y se devuelve si el turno se revende (si el comercio lo eligió).' },
  MUY_TARDE: { cat: 'retencion', grupo: 'cancelaciones', titulo: (x, d) => `Canceló ${hs(x)} antes: la seña queda${/vuelve a vender/.test(d.motivo) ? '; si el turno se revende, se devuelve' : ''}`, explica: 'Con muy poca anticipación la seña queda para el comercio, que pierde el turno. Si el turno se vuelve a vender, no perdió nada y se devuelve (si la política lo permite).' },
  SIN_PAGO: { cat: 'cancelacion', grupo: 'cancelaciones', titulo: () => 'Cancelación sin pago: no había plata que devolver', explica: 'Si se cancela antes de pagar la seña no se cobra ni se devuelve nada, y el turno vuelve a estar libre.' },
  CANCELADO_POR_COMERCIO: { cat: 'devolucion', grupo: 'cancelaciones', titulo: () => 'El comercio canceló el turno y devolvió toda la seña', explica: 'Cuando es el comercio el que cancela (por ejemplo, por un feriado), la seña se devuelve completa sin aplicar la política de cancelación.' },
  TURNO_EMPEZADO: { cat: 'aviso', grupo: 'cancelaciones', titulo: () => 'Rechazó una cancelación: el turno ya había empezado', explica: 'Una vez que el turno empezó ya no se puede cancelar ni devolver.' },
  REVENTA: { cat: 'devolucion', grupo: 'cancelaciones', titulo: () => 'El turno se volvió a vender: devolvió lo que había retenido', explica: 'Si un turno cuya seña quedó retenida se vende de nuevo, el comercio no perdió nada: se devuelve lo retenido.' },
  REVENTA_SIN_DEVOLUCION: { cat: 'libera', grupo: 'cancelaciones', titulo: () => 'El turno se volvió a vender: no quedaba nada para devolver', explica: 'Ya se había devuelto todo o la política no devuelve en reventa.' },
  RESERVA_VENCIDA: { cat: 'libera', grupo: 'turnos', titulo: () => 'Liberó un turno porque no se pagó a tiempo', explica: 'Si nadie paga la seña dentro del tiempo que fija el comercio, el turno se libera para que lo tome otra persona.' },
  ANOTADO: { cat: 'espera', grupo: 'turnos', titulo: () => 'Anotó a alguien en la lista de espera', explica: 'Quien quiere un turno ocupado se anota; si el turno se libera, es el primero en recibir la oferta.' },
  SALTEADO: { cat: 'aviso', grupo: 'turnos', titulo: () => 'Salteó a alguien de la lista de espera', explica: 'Si no se le pudo ofrecer el turno a quien estaba primero, el agente sigue con el siguiente.' },
  DEVOLUCION_ENVIADA: { cat: 'devolucion', grupo: 'transferencias', titulo: () => 'Mandó una devolución', explica: 'Las devoluciones salen de la billetera del agente, con su marca de atribución, y vuelven a la billetera con la que se pagó.' },
  RETIRO_ENVIADO: { cat: 'cierre', grupo: 'transferencias', titulo: () => 'Mandó el retiro al comercio', explica: 'Al cerrar el día el agente transfiere al dueño solo lo que ya no está comprometido en turnos futuros.' },
  ESPERA_DUENO: { cat: 'aviso', grupo: 'transferencias', titulo: () => 'Pidió aprobación al dueño antes de mandar plata', explica: 'Las devoluciones grandes, o muchas en un día, no salen solas: el dueño las aprueba o las rechaza.' },
  APROBADA_POR_DUENO: { cat: 'cobro', grupo: 'transferencias', titulo: () => 'El dueño aprobó una transferencia', explica: 'La transferencia que esperaba aprobación sale una vez que el dueño la aprueba.' },
  RECHAZADA_POR_DUENO: { cat: 'cancelacion', grupo: 'transferencias', titulo: () => 'El dueño rechazó una transferencia', explica: 'Si el dueño la rechaza, no se manda nada.' },
  FALLO_SIN_ENVIAR: { cat: 'aviso', grupo: 'transferencias', titulo: () => 'Una transferencia falló y no salió plata', explica: 'Cuando se sabe que no salió, se avisa al dueño y se puede reintentar.' },
  ESTADO_INCIERTO: { cat: 'aviso', grupo: 'transferencias', titulo: () => 'Una transferencia quedó en revisión', explica: 'Si no se sabe si una transferencia salió, el agente NO la reintenta sola, para no pagar dos veces: avisa al dueño.' },
  SIN_DESTINO: { cat: 'aviso', grupo: 'transferencias', titulo: () => 'No había adónde devolver la plata', explica: 'Sin una billetera de destino, la devolución la tiene que resolver el dueño.' },
  JUGADO: { cat: 'cierre', grupo: 'turnos', titulo: () => 'Cerró un turno jugado: la seña pasa al comercio', explica: 'Cuando termina el turno, la seña deja de estar comprometida y es del comercio.' },
  SIN_RETIRO: { cat: 'cierre', grupo: 'transferencias', titulo: () => 'Cerró el día: no había nada libre para retirar', explica: 'El retiro nunca toca señas de turnos futuros: se retira solo lo que ya es del comercio.' },
  RETIRO: { cat: 'cierre', grupo: 'transferencias', titulo: () => 'Cerró el día y preparó el retiro', explica: 'Saldo menos lo comprometido en turnos futuros: eso es lo que se le transfiere al dueño.' },
  RETIRO_CON_TOPE: { cat: 'cierre', grupo: 'transferencias', titulo: () => 'Cerró el día y preparó el retiro (con tope)', explica: 'Si lo libre supera el máximo por transferencia, se retira hasta el tope.' },
  CONFIGURACION_CAMBIADA: { cat: 'cambio', grupo: 'comercio', titulo: () => 'El comercio cambió su configuración', explica: 'Los cambios valen para reservas nuevas: las que ya se pagaron conservan su seña y su política.' },
  BLOQUEO_CREADO: { cat: 'cambio', grupo: 'comercio', titulo: () => 'El comercio bloqueó turnos', explica: 'Un bloqueo (feriado, mantenimiento) saca turnos de la agenda. Si ya había reservas pagadas, el comercio decide si las cancela y devuelve todo.' },
  BLOQUEO_QUITADO: { cat: 'cambio', grupo: 'comercio', titulo: () => 'El comercio quitó un bloqueo', explica: 'Los turnos vuelven a estar disponibles.' },
};

function hs(x) {
  if (typeof x.horasAntes !== 'number') return 'con anticipación';
  const n = x.horasAntes;
  return `${Number.isInteger(n) ? n : n.toFixed(1).replace('.', ',')} h`;
}

export const GRUPOS = [
  ['', 'Todo'], ['cobros', 'Cobros'], ['cancelaciones', 'Cancelaciones'], ['turnos', 'Turnos y espera'], ['transferencias', 'Transferencias'], ['comercio', 'Cambios del comercio'],
];

export const grupoDe = (d) => REGLAS[d.regla]?.grupo ?? 'turnos';
export const reglaDe = (d) => REGLAS[d.regla];
export const tituloDe = (d) => REGLAS[d.regla]?.titulo(d.datos ?? {}, d) ?? d.regla;

const claveDia = (iso) => new Intl.DateTimeFormat('sv-SE', { timeZone: TZ }).format(new Date(iso));
const hora = (iso) => new Intl.DateTimeFormat('es-AR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));

/** Agrupa por día ("Hoy", "Ayer", "miércoles 21 de octubre") respetando el orden (lo más nuevo primero). */
export function agruparPorDia(decisiones) {
  const ahora = ahoraServidor();
  const hoy = claveDia(new Date(ahora).toISOString());
  const ayer = claveDia(new Date(ahora - 24 * 3_600_000).toISOString());
  const grupos = [];
  for (const d of decisiones) {
    const k = claveDia(d.fecha);
    let g = grupos.at(-1);
    if (!g || g.clave !== k) { g = { clave: k, etiqueta: k === hoy ? 'Hoy' : k === ayer ? 'Ayer' : fmtFecha(k), items: [] }; grupos.push(g); }
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
        h('span', {}, 'Regla ', h('code', {}, d.regla)),
        onReserva && d.reserva ? h('button', { type: 'button', class: 'btn btn-fantasma btn-chico', onclick: () => onReserva(d.reserva) }, `Reserva ${d.reserva}`) : null,
        isTxHash(d.tx) ? (real
          ? h('a', { href: safeHref(`https://celoscan.io/tx/${d.tx}`), target: '_blank', rel: 'noopener noreferrer' }, `Transacción ${abreviar(d.tx)}`)
          : h('span', {}, `Transacción simulada ${abreviar(d.tx)}`)) : null),
      regla ? h('details', {}, h('summary', {}, '¿Por qué lo decidió así?'), h('p', {}, regla.explica)) : null));
}
