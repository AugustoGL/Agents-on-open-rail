// Motor de reglas de plata. Es código fijo y determinista: el modelo de lenguaje
// nunca decide cuánto se devuelve ni cuánto se transfiere. Cada función devuelve
// también una regla con nombre y un motivo en castellano, que van al registro de decisiones.
import { arsToWei, percentOf, formatArs, minBig } from './money.js';

const HOUR = 3_600_000;

/** Seña que se cobra por un turno, en wei de wARS. */
export function depositWei(business) {
  return percentOf(arsToWei(business.precioTurnoArs), business.senaPorcentaje);
}

/**
 * Qué hacer cuando un cliente cancela un turno ya pagado.
 * @returns {{ refundWei: bigint, rule: string, reason: string, hoursBefore: number, offerToWaitlist: boolean }}
 */
export function decideCancellation({ startAt, now, paidWei, policy }) {
  const paid = BigInt(paidWei);
  const hoursBefore = (startAt - now) / HOUR;
  const h = hoursBefore.toFixed(1);

  if (hoursBefore <= 0) {
    return {
      refundWei: 0n,
      rule: 'TURNO_EMPEZADO',
      reason: `El turno ya empezó (hace ${(-hoursBefore).toFixed(1)} h). No se puede cancelar ni devolver.`,
      hoursBefore,
      offerToWaitlist: false,
    };
  }
  if (hoursBefore >= policy.devolucionTotalHorasAntes) {
    return {
      refundWei: paid,
      rule: 'A_TIEMPO',
      reason: `Canceló ${h} h antes (mínimo ${policy.devolucionTotalHorasAntes} h). Se devuelve toda la seña: ${formatArs(paid)}.`,
      hoursBefore,
      offerToWaitlist: true,
    };
  }
  if (hoursBefore >= policy.devolucionParcialHorasAntes) {
    const refund = percentOf(paid, policy.devolucionParcialPorcentaje);
    return {
      refundWei: refund,
      rule: 'TARDE_PARCIAL',
      reason: `Canceló ${h} h antes, entre ${policy.devolucionParcialHorasAntes} y ${policy.devolucionTotalHorasAntes} h. Se devuelve el ${policy.devolucionParcialPorcentaje}%: ${formatArs(refund)}.` +
        (policy.devolverSiSeRevende ? ' Si el turno se vuelve a vender, se devuelve el resto.' : ''),
      hoursBefore,
      offerToWaitlist: true,
    };
  }
  return {
    refundWei: 0n,
    rule: 'MUY_TARDE',
    reason: `Canceló ${h} h antes (menos de ${policy.devolucionParcialHorasAntes} h). La seña queda para el negocio.` +
      (policy.devolverSiSeRevende ? ' Si el turno se vuelve a vender, se devuelve.' : ''),
    hoursBefore,
    offerToWaitlist: true,
  };
}

/**
 * El turno de una cancelación tardía se volvió a vender: el negocio no perdió nada,
 * así que se devuelve lo que se había retenido.
 */
export function decideResaleRefund({ paidWei, alreadyRefundedWei, policy }) {
  const remaining = BigInt(paidWei) - BigInt(alreadyRefundedWei);
  if (!policy.devolverSiSeRevende || remaining <= 0n) {
    return { refundWei: 0n, rule: 'REVENTA_SIN_DEVOLUCION', reason: 'No queda nada retenido para devolver.' };
  }
  return {
    refundWei: remaining,
    rule: 'REVENTA',
    reason: `El turno se volvió a vender, así que se devuelve lo que se había retenido: ${formatArs(remaining)}.`,
  };
}

/**
 * Topes de seguridad para cualquier transferencia que mande el agente.
 * Por encima del tope automático, la transferencia queda esperando la aprobación del dueño.
 */
export function checkTransferLimits({ amountWei, kind, sentTodayWei, limits }) {
  const amount = BigInt(amountWei);
  const hardMax = arsToWei(limits.transferenciaMaxArs);
  if (amount <= 0n) return { ok: false, needsOwner: false, reason: 'El monto tiene que ser mayor a cero.' };
  if (amount > hardMax) {
    return { ok: false, needsOwner: true, reason: `Supera el máximo por transferencia (${formatArs(hardMax)}).` };
  }
  if (kind === 'refund') {
    const autoMax = arsToWei(limits.devolucionMaxAutomaticaArs);
    const dailyMax = arsToWei(limits.devolucionesMaxDiariasArs);
    if (amount > autoMax) {
      return { ok: false, needsOwner: true, reason: `La devolución supera el tope automático (${formatArs(autoMax)}).` };
    }
    if (BigInt(sentTodayWei) + amount > dailyMax) {
      return { ok: false, needsOwner: true, reason: `Se pasaría del tope diario de devoluciones (${formatArs(dailyMax)}).` };
    }
  }
  return { ok: true, needsOwner: false, reason: 'Dentro de los topes.' };
}

/**
 * Cuánto se le puede pasar al dueño en el cierre del día.
 * Regla: nunca se retira plata que todavía se podría tener que devolver
 * (las señas de turnos que no pasaron), y se deja una reserva mínima.
 */
export function decidePayout({ balanceWei, liabilitiesWei, reserveWei, maxTransferWei }) {
  const available = BigInt(balanceWei) - BigInt(liabilitiesWei) - BigInt(reserveWei);
  if (available <= 0n) {
    return {
      amountWei: 0n,
      rule: 'SIN_RETIRO',
      reason: `Saldo ${formatArs(balanceWei)}, comprometido en señas de turnos futuros ${formatArs(liabilitiesWei)}, reserva ${formatArs(reserveWei)}. No queda nada libre para retirar.`,
    };
  }
  const amount = minBig(available, BigInt(maxTransferWei));
  return {
    amountWei: amount,
    rule: amount < available ? 'RETIRO_CON_TOPE' : 'RETIRO',
    reason: `Saldo ${formatArs(balanceWei)} menos señas de turnos futuros ${formatArs(liabilitiesWei)} y reserva ${formatArs(reserveWei)}: se pueden retirar ${formatArs(available)}.` +
      (amount < available ? ` Se transfiere ${formatArs(amount)} por el tope por transferencia.` : ''),
  };
}
