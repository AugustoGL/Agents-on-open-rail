// Motor de reglas de plata (rule texts are in English). Es código fijo y determinista: el modelo de lenguaje
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
      reason: `The slot already started (${(-hoursBefore).toFixed(1)} h ago). It cannot be cancelled or refunded.`,
      hoursBefore,
      offerToWaitlist: false,
    };
  }
  if (hoursBefore >= policy.devolucionTotalHorasAntes) {
    return {
      refundWei: paid,
      rule: 'A_TIEMPO',
      reason: `Cancelled ${h} h ahead (minimum ${policy.devolucionTotalHorasAntes} h). The whole deposit is refunded: ${formatArs(paid)}.`,
      hoursBefore,
      offerToWaitlist: true,
    };
  }
  if (hoursBefore >= policy.devolucionParcialHorasAntes) {
    const refund = percentOf(paid, policy.devolucionParcialPorcentaje);
    return {
      refundWei: refund,
      rule: 'TARDE_PARCIAL',
      reason: `Cancelled ${h} h ahead, between ${policy.devolucionParcialHorasAntes} and ${policy.devolucionTotalHorasAntes} h. ${policy.devolucionParcialPorcentaje}% is refunded: ${formatArs(refund)}.` +
        (policy.devolverSiSeRevende ? ' If the slot is resold, the rest is refunded.' : ''),
      hoursBefore,
      offerToWaitlist: true,
    };
  }
  return {
    refundWei: 0n,
    rule: 'MUY_TARDE',
    reason: `Cancelled ${h} h ahead (less than ${policy.devolucionParcialHorasAntes} h). The deposit stays with the venue.` +
      (policy.devolverSiSeRevende ? ' If the slot is resold, it is refunded.' : ''),
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
    return { refundWei: 0n, rule: 'REVENTA_SIN_DEVOLUCION', reason: 'Nothing is left to refund.' };
  }
  return {
    refundWei: remaining,
    rule: 'REVENTA',
    reason: `The slot was resold, so what had been kept is refunded: ${formatArs(remaining)}.`,
  };
}

/**
 * Topes de seguridad para cualquier transferencia que mande el agente.
 * Por encima del tope automático, la transferencia queda esperando la aprobación del dueño.
 */
export function checkTransferLimits({ amountWei, kind, sentTodayWei, limits }) {
  const amount = BigInt(amountWei);
  const hardMax = arsToWei(limits.transferenciaMaxArs);
  if (amount <= 0n) return { ok: false, needsOwner: false, reason: 'The amount must be greater than zero.' };
  if (amount > hardMax) {
    return { ok: false, needsOwner: true, reason: `It exceeds the maximum per transfer (${formatArs(hardMax)}).` };
  }
  if (kind === 'refund') {
    const autoMax = arsToWei(limits.devolucionMaxAutomaticaArs);
    const dailyMax = arsToWei(limits.devolucionesMaxDiariasArs);
    if (amount > autoMax) {
      return { ok: false, needsOwner: true, reason: `The refund exceeds the automatic limit (${formatArs(autoMax)}).` };
    }
    if (BigInt(sentTodayWei) + amount > dailyMax) {
      return { ok: false, needsOwner: true, reason: `It would go over the daily refund limit (${formatArs(dailyMax)}).` };
    }
  }
  return { ok: true, needsOwner: false, reason: 'Within the limits.' };
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
      reason: `Balance ${formatArs(balanceWei)}, committed in deposits for future slots ${formatArs(liabilitiesWei)}, reserve ${formatArs(reserveWei)}. Nothing is free to withdraw.`,
    };
  }
  const amount = minBig(available, BigInt(maxTransferWei));
  return {
    amountWei: amount,
    rule: amount < available ? 'RETIRO_CON_TOPE' : 'RETIRO',
    reason: `Balance ${formatArs(balanceWei)} minus deposits for future slots ${formatArs(liabilitiesWei)} and reserve ${formatArs(reserveWei)}: ${formatArs(available)} can be withdrawn.` +
      (amount < available ? ` ${formatArs(amount)} is transferred because of the per-transfer limit.` : ''),
  };
}
