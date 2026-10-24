// Horas locales del negocio. Argentina usa UTC-3 todo el año (sin horario de verano),
// así que alcanza con un desfase fijo que se configura en config/negocio.json.

const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const pad = (n) => String(n).padStart(2, '0');

/** Fecha y hora local ("2026-10-22", "21:30") -> milisegundos UTC. */
export function localToUtcMs(dateStr, timeStr, offsetMin) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  return Date.UTC(y, m - 1, d, hh, mm) - offsetMin * 60_000;
}

function shifted(ms, offsetMin) {
  return new Date(ms + offsetMin * 60_000);
}

/** "2026-10-22" en hora local. */
export function localDateStr(ms, offsetMin) {
  const t = shifted(ms, offsetMin);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** "21:30" en hora local. */
export function localTimeStr(ms, offsetMin) {
  const t = shifted(ms, offsetMin);
  return `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`;
}

/** "jue 22/10 21:30" en hora local. */
export function formatLocal(ms, offsetMin) {
  const t = shifted(ms, offsetMin);
  return `${DIAS[t.getUTCDay()]} ${pad(t.getUTCDate())}/${pad(t.getUTCMonth() + 1)} ${localTimeStr(ms, offsetMin)}`;
}

/** "jue 22/10" en hora local. */
export function formatLocalDay(ms, offsetMin) {
  const t = shifted(ms, offsetMin);
  return `${DIAS[t.getUTCDay()]} ${pad(t.getUTCDate())}/${pad(t.getUTCMonth() + 1)}`;
}

/** Suma días a una fecha local "YYYY-MM-DD". */
export function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Inicio del día local (00:00) en milisegundos UTC. */
export function startOfLocalDay(ms, offsetMin) {
  return localToUtcMs(localDateStr(ms, offsetMin), '00:00', offsetMin);
}
