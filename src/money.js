// Plata: wARS está atado 1:1 al peso y usa 18 decimales.
// Todo lo que se guarda o se transfiere va en "wei" (BigInt, la unidad mínima).
// Todo lo que ve una persona va en pesos con formato argentino.
import { parseUnits, formatUnits } from 'viem';
import { WARS } from './constants.js';

/** Convierte pesos (número o texto, ej. "5000" o "5000.50") a unidades mínimas de wARS. */
export function arsToWei(ars) {
  const text = typeof ars === 'number' ? ars.toFixed(2) : String(ars).trim();
  if (!/^\d+(\.\d{1,18})?$/.test(text)) throw new Error(`Monto en pesos inválido: ${ars}`);
  return parseUnits(text, WARS.decimals);
}

/** Convierte unidades mínimas de wARS a pesos como texto decimal exacto ("5000.5"). */
export function weiToArsString(wei) {
  return formatUnits(BigInt(wei), WARS.decimals);
}

/** Display format: "$ 5,000" or "$ 5,000.50". */
export function formatArs(wei) {
  const [ent, dec = ''] = weiToArsString(wei).split('.');
  const entFmt = ent.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const cents = dec.padEnd(2, '0').slice(0, 2);
  return cents === '00' ? `$ ${entFmt}` : `$ ${entFmt}.${cents}`;
}

/** Porcentaje entero de un monto en wei, redondeado hacia abajo (nunca se devuelve de más). */
export function percentOf(wei, pct) {
  if (!Number.isInteger(pct) || pct < 0 || pct > 100) throw new Error(`Porcentaje inválido: ${pct}`);
  return (BigInt(wei) * BigInt(pct)) / 100n;
}

export function minBig(a, b) {
  return a < b ? a : b;
}
