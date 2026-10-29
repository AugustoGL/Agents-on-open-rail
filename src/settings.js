// Configuración del negocio guardada en la base de datos: validación, cambios y registro.
// config/negocio.json solo aporta los valores iniciales (se importa una sola vez, con la tabla vacía).
//
// Forma guardada (además de lo de negocio.json):
//   recursosLista: [{ nombre, activo }]       canchas (se pueden renombrar y desactivar, no borrar)
//   horarios: ["09:00", ...]                  horarios base de todos los días
//   horariosSemana: { "0": [...], ... }       por día de la semana (0 = domingo); [] = cerrado
//   horariosRecurso: { "Court 1": { "6": [...] } }   por cancha y día; pisa a lo anterior
// Al cargarla se agregan dos campos derivados: recursos (canchas activas) y recursosTodos.
import { readFileSync } from 'node:fs';

export const DEFAULT_CLOSE_TIME = '23:30';
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} .,'°º#()+-]*$/u;
const WEEKDAY_KEYS = ['0', '1', '2', '3', '4', '5', '6'];
export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Rangos sensatos de cada número editable (también los usa el panel para mostrar ayudas). */
export const RANGES = {
  duracionMinutos: { min: 15, max: 480, label: 'The slot length', unit: 'minutes' },
  diasAdelante: { min: 1, max: 90, label: 'The maximum days ahead', unit: 'days' },
  anticipacionMinimaMinutos: { min: 0, max: 10080, label: 'The minimum notice', unit: 'minutes' },
  precioTurnoArs: { min: 100, max: 10_000_000, label: 'The slot price', unit: 'pesos' },
  senaPorcentaje: { min: 1, max: 100, label: 'The deposit percentage', unit: '%' },
  reservaSinPagarMinutos: { min: 5, max: 120, label: 'The time to pay', unit: 'minutes' },
  'politica.devolucionTotalHorasAntes': { min: 0, max: 720, label: 'The hours for a full refund', unit: 'hours' },
  'politica.devolucionParcialHorasAntes': { min: 0, max: 720, label: 'The hours for a partial refund', unit: 'hours' },
  'politica.devolucionParcialPorcentaje': { min: 0, max: 100, label: 'The partial refund percentage', unit: '%' },
  'politica.ofertaListaEsperaMinutos': { min: 5, max: 240, label: 'The waitlist offer time', unit: 'minutes' },
  'limites.devolucionMaxAutomaticaArs': { min: 0, max: 100_000_000, label: 'The automatic refund limit', unit: 'pesos' },
  'limites.devolucionesMaxDiariasArs': { min: 0, max: 100_000_000, label: 'The daily refund limit', unit: 'pesos' },
  'limites.transferenciaMaxArs': { min: 0, max: 100_000_000, label: 'The maximum per transfer', unit: 'pesos' },
  utcOffsetMinutos: { min: -720, max: 840, label: 'The time offset', unit: 'minutes' },
  'cierre.reservaMinimaArs': { min: 0, max: 100_000_000, label: 'The close minimum reserve', unit: 'pesos' },
};

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const toMin = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
const clone = (v) => JSON.parse(JSON.stringify(v));
const money = (n) => `$ ${n.toLocaleString('en-US')}`;

/** Agrega los campos derivados (canchas activas y todas) sin validar nada. Acepta la forma vieja (recursos: [texto]). */
export function deriveBusiness(b) {
  const lista = b.recursosLista ?? (b.recursos ?? []).map((nombre) => ({ nombre, activo: true }));
  return { ...b, recursosLista: lista, recursos: lista.filter((r) => r.activo).map((r) => r.nombre), recursosTodos: lista.map((r) => r.nombre) };
}

/** Lo que se guarda: sin campos derivados ni marcas de edición. */
export function toStored(b) {
  const { recursos, recursosTodos, ...rest } = b; // eslint-disable-line no-unused-vars
  return { ...rest, recursosLista: (b.recursosLista ?? deriveBusiness(b).recursosLista).map((r) => ({ nombre: r.nombre, activo: Boolean(r.activo) })) };
}

/** Horarios de una cancha en un día de la semana: pisa la cancha, después el día, después los base. */
export function hoursFor(b, resource, weekday) {
  const day = String(weekday);
  return b.horariosRecurso?.[resource]?.[day] ?? b.horariosSemana?.[day] ?? b.horarios;
}

/**
 * Valida una configuración completa. No tira: devuelve { ok, errors: [{ campo, mensaje }], business, renames }.
 * @param {object} input
 * @param {{ previous?: object }} [opts]  configuración vigente (para detectar renombres y canchas borradas)
 */
export function validateBusiness(input, { previous } = {}) {
  const errors = [];
  const err = (campo, mensaje) => errors.push({ campo, mensaje });
  if (!isObj(input)) return { ok: false, errors: [{ campo: '', mensaje: 'The settings must be an object.' }], business: null, renames: [] };
  const out = {};

  const text = (key, { max, required = true, label }) => {
    const v = input[key];
    if (v === undefined || v === null || v === '') {
      if (required) err(key, `"${key}" is missing from the business settings.`);
      else out[key] = '';
      return;
    }
    if (typeof v !== 'string') return err(key, `${label} must be text.`);
    const t = v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (t.length > max) return err(key, `${label} can have up to ${max} characters.`);
    if (required && t === '') return err(key, `${label} cannot be empty.`);
    out[key] = t;
  };
  const integer = (path, raw, { required = true } = {}) => {
    const r = RANGES[path];
    if (raw === undefined || raw === null || raw === '') {
      if (required) err(path, `"${path}" is missing from the business settings.`);
      return undefined;
    }
    const n = typeof raw === 'number' ? raw : (typeof raw === 'string' ? Number(raw.trim()) : NaN);
    if (!Number.isInteger(n)) { err(path, `${r.label} must be a whole number.`); return undefined; }
    if (n < r.min || n > r.max) {
      const f = r.unit === 'pesos' ? money : (x) => `${x}`;
      err(path, `${r.label} must be between ${f(r.min)} and ${f(r.max)}${r.unit === 'pesos' ? '' : ` ${r.unit}`}.`);
      return undefined;
    }
    return n;
  };

  text('nombre', { max: 80, label: 'The name' });
  text('descripcion', { max: 500, required: false, label: 'The description' });
  out.esDemostracion = input.esDemostracion === undefined ? false : Boolean(input.esDemostracion);
  const offset = integer('utcOffsetMinutos', input.utcOffsetMinutos);
  if (offset !== undefined) out.utcOffsetMinutos = offset;
  for (const k of ['duracionMinutos', 'diasAdelante', 'anticipacionMinimaMinutos', 'precioTurnoArs', 'senaPorcentaje', 'reservaSinPagarMinutos']) {
    const n = integer(k, input[k]);
    if (n !== undefined) out[k] = n;
  }

  // Canchas
  const renames = [];
  let lista = input.recursosLista;
  if (lista === undefined && Array.isArray(input.recursos)) lista = input.recursos.map((nombre) => ({ nombre, activo: true }));
  if (!Array.isArray(lista) || lista.length === 0) {
    err('recursosLista', 'There must be at least one court.');
  } else if (lista.length > 20) {
    err('recursosLista', 'There cannot be more than 20 courts.');
  } else {
    const seen = new Set(); const clean = [];
    lista.forEach((r, i) => {
      const item = typeof r === 'string' ? { nombre: r, activo: true } : r;
      const nombre = String(item?.nombre ?? '').replace(/\s+/g, ' ').trim();
      const campo = `recursosLista.${i}`;
      if (!nombre) return err(campo, `Court ${i + 1} has no name.`);
      if (nombre.length > 40) return err(campo, `The court name "${nombre.slice(0, 20)}…" is too long (maximum 40 characters).`);
      if (!NAME_RE.test(nombre)) return err(campo, `The name "${nombre}" has characters that cannot be used. Use letters, numbers, spaces and . , ' ° # ( ) + -`);
      if (seen.has(nombre.toLowerCase())) return err(campo, `There are two courts named "${nombre}".`);
      seen.add(nombre.toLowerCase());
      clean.push({ nombre, activo: item.activo === undefined ? true : Boolean(item.activo) });
      const anterior = typeof item?.anterior === 'string' ? item.anterior : null;
      if (anterior && anterior !== nombre) renames.push({ from: anterior, to: nombre });
      return undefined;
    });
    if (clean.length === lista.length) {
      if (!clean.some((r) => r.activo)) err('recursosLista', 'There must be at least one active court.');
      if (previous) {
        const before = deriveBusiness(previous).recursosTodos;
        const kept = new Set(clean.map((r) => r.nombre));
        const renamedFrom = new Set();
        for (const { from, to } of renames) {
          if (!before.includes(from)) err('recursosLista', `The court "${from}" you want to rename does not exist.`);
          else if (renamedFrom.has(from)) err('recursosLista', `The court "${from}" appears renamed twice.`);
          else if (before.includes(to) && !renames.some((x) => x.from === to)) err('recursosLista', `A court named "${to}" already exists.`);
          renamedFrom.add(from);
        }
        for (const old of before) {
          if (!kept.has(old) && !renamedFrom.has(old)) err('recursosLista', `"${old}" cannot be deleted: it has or may have bookings. Deactivate it so it cannot be booked.`);
        }
      }
      out.recursosLista = clean;
    }
  }
  const resourceNames = (out.recursosLista ?? []).map((r) => r.nombre);

  // Horarios
  const duration = out.duracionMinutos;
  const timeList = (raw, campo, label, { allowEmpty }) => {
    if (!Array.isArray(raw)) { err(campo, `${label} must be a list of times.`); return null; }
    if (raw.length > 48) { err(campo, `${label}: there are too many times.`); return null; }
    if (raw.length === 0 && !allowEmpty) { err(campo, `${label}: add at least one time.`); return null; }
    const list = [];
    for (const t of raw) {
      const s = String(t).trim();
      if (!TIME_RE.test(s)) { err(campo, `${label}: "${s}" is not a valid time (use HH:MM, for example 20:30).`); return null; }
      if (list.includes(s)) { err(campo, `${label}: the time ${s} is repeated.`); return null; }
      list.push(s);
    }
    list.sort();
    if (duration) {
      for (let i = 1; i < list.length; i++) {
        if (toMin(list[i]) - toMin(list[i - 1]) < duration) {
          err(campo, `${label}: the slots at ${list[i - 1]} and ${list[i]} overlap (each slot lasts ${duration} minutes).`);
          return null;
        }
      }
    }
    return list;
  };
  const base = timeList(input.horarios, 'horarios', 'The base times', { allowEmpty: false });
  if (base) out.horarios = base;

  if (input.horariosSemana !== undefined && input.horariosSemana !== null) {
    if (!isObj(input.horariosSemana)) err('horariosSemana', 'The times per day must be an object.');
    else {
      const semana = {};
      for (const [day, list] of Object.entries(input.horariosSemana)) {
        if (!WEEKDAY_KEYS.includes(day)) { err('horariosSemana', `"${day}" is not a day of the week (0 = Sunday ... 6 = Saturday).`); continue; }
        const l = timeList(list, `horariosSemana.${day}`, `The ${WEEKDAY_NAMES[day]} times`, { allowEmpty: true });
        if (l) semana[day] = l;
      }
      if (Object.keys(semana).length) out.horariosSemana = semana;
    }
  }
  if (input.horariosRecurso !== undefined && input.horariosRecurso !== null) {
    if (!isObj(input.horariosRecurso)) err('horariosRecurso', 'The times per court must be an object.');
    else {
      const porRecurso = {};
      for (const [name, days] of Object.entries(input.horariosRecurso)) {
        if (!resourceNames.includes(name)) { err('horariosRecurso', `There are times for "${name}", which is not a court.`); continue; }
        if (!isObj(days)) { err('horariosRecurso', `The times for "${name}" must be an object per day.`); continue; }
        const byDay = {};
        for (const [day, list] of Object.entries(days)) {
          if (!WEEKDAY_KEYS.includes(day)) { err('horariosRecurso', `"${day}" is not a day of the week (0 = Sunday ... 6 = Saturday).`); continue; }
          const l = timeList(list, `horariosRecurso.${name}.${day}`, `The ${WEEKDAY_NAMES[day]} times for ${name}`, { allowEmpty: true });
          if (l) byDay[day] = l;
        }
        if (Object.keys(byDay).length) porRecurso[name] = byDay;
      }
      if (Object.keys(porRecurso).length) out.horariosRecurso = porRecurso;
    }
  }

  // Política
  const p = isObj(input.politica) ? input.politica : null;
  if (!p) err('politica', '"politica" is missing from the business settings.');
  else {
    const total = integer('politica.devolucionTotalHorasAntes', p.devolucionTotalHorasAntes);
    const parcial = integer('politica.devolucionParcialHorasAntes', p.devolucionParcialHorasAntes);
    const pct = integer('politica.devolucionParcialPorcentaje', p.devolucionParcialPorcentaje);
    const espera = integer('politica.ofertaListaEsperaMinutos', p.ofertaListaEsperaMinutos);
    if (total !== undefined && parcial !== undefined && parcial >= total) {
      err('politica.devolucionParcialHorasAntes', `The hours for a partial refund (${parcial}) must be fewer than those for a full refund (${total}).`);
    }
    if (typeof p.devolverSiSeRevende !== 'boolean') err('politica.devolverSiSeRevende', 'Say whether a refund is given when the slot is resold (yes or no).');
    out.politica = {
      devolucionTotalHorasAntes: total, devolucionParcialHorasAntes: parcial, devolucionParcialPorcentaje: pct,
      devolverSiSeRevende: p.devolverSiSeRevende === true, ofertaListaEsperaMinutos: espera,
    };
  }

  // Límites
  const l = isObj(input.limites) ? input.limites : null;
  if (!l) err('limites', '"limites" is missing from the business settings.');
  else {
    const auto = integer('limites.devolucionMaxAutomaticaArs', l.devolucionMaxAutomaticaArs);
    const diario = integer('limites.devolucionesMaxDiariasArs', l.devolucionesMaxDiariasArs);
    const maxT = integer('limites.transferenciaMaxArs', l.transferenciaMaxArs);
    if (auto !== undefined && diario !== undefined && auto > diario) {
      err('limites.devolucionMaxAutomaticaArs', `The automatic refund limit (${money(auto)}) cannot exceed the daily limit (${money(diario)}).`);
    }
    out.limites = { devolucionMaxAutomaticaArs: auto, devolucionesMaxDiariasArs: diario, transferenciaMaxArs: maxT };
  }

  // Cierre
  const c = isObj(input.cierre) ? input.cierre : {};
  const hora = c.hora === undefined || c.hora === '' ? DEFAULT_CLOSE_TIME : String(c.hora).trim();
  if (!TIME_RE.test(hora)) err('cierre.hora', `The close time "${hora}" is not valid (use HH:MM, for example 23:30).`);
  const reserva = integer('cierre.reservaMinimaArs', c.reservaMinimaArs ?? 0, { required: false });
  out.cierre = { reservaMinimaArs: reserva ?? 0, hora };

  if (errors.length) return { ok: false, errors, business: null, renames };
  return { ok: true, errors: [], business: deriveBusiness(out), renames };
}

/** Mezcla un cambio parcial sobre la configuración vigente: política, límites y cierre se mezclan; el resto se reemplaza. */
export function applyPatch(previous, patch) {
  const next = clone(toStored(previous));
  for (const [k, v] of Object.entries(patch)) {
    if (['politica', 'limites', 'cierre'].includes(k) && isObj(v)) next[k] = { ...next[k], ...v };
    else next[k] = v;
  }
  // Si se renombró una cancha y no se mandaron los horarios por cancha, se acomodan las claves.
  if (Array.isArray(patch.recursosLista) && !('horariosRecurso' in patch) && next.horariosRecurso) {
    for (const r of patch.recursosLista) {
      if (r?.anterior && r.anterior !== r.nombre && next.horariosRecurso[r.anterior]) {
        next.horariosRecurso[r.nombre] = next.horariosRecurso[r.anterior];
        delete next.horariosRecurso[r.anterior];
      }
    }
  }
  return next;
}

/** Campos que el panel puede cambiar. Dirección de retiro, claves, PAY_TO y modo no están acá a propósito: solo van por .env. */
const EDITABLE_TOP = ['nombre', 'descripcion', 'recursosLista', 'horarios', 'horariosSemana', 'horariosRecurso', 'duracionMinutos',
  'diasAdelante', 'anticipacionMinimaMinutos', 'precioTurnoArs', 'senaPorcentaje', 'reservaSinPagarMinutos'];
const EDITABLE_NESTED = {
  politica: ['devolucionTotalHorasAntes', 'devolucionParcialHorasAntes', 'devolucionParcialPorcentaje', 'devolverSiSeRevende', 'ofertaListaEsperaMinutos'],
  limites: ['devolucionMaxAutomaticaArs', 'devolucionesMaxDiariasArs', 'transferenciaMaxArs'],
  cierre: ['hora'],
};

/** Deja solo lo editable desde el panel y lista lo que se rechaza. */
export function pickEditable(patch) {
  const picked = {}; const errors = [];
  if (!isObj(patch)) return { picked, errors: [{ campo: '', mensaje: 'Send an object with the changes.' }] };
  for (const [k, v] of Object.entries(patch)) {
    if (EDITABLE_TOP.includes(k)) picked[k] = v;
    else if (EDITABLE_NESTED[k] && isObj(v)) {
      picked[k] = {};
      for (const [sub, sv] of Object.entries(v)) {
        if (EDITABLE_NESTED[k].includes(sub)) picked[k][sub] = sv;
        else errors.push({ campo: `${k}.${sub}`, mensaje: `"${k}.${sub}" cannot be changed from the dashboard.` });
      }
    } else errors.push({ campo: k, mensaje: `"${k}" cannot be changed from the dashboard.` });
  }
  return { picked, errors };
}

/** Diferencias entre dos configuraciones, por campo. */
export function diffBusiness(a, b) {
  const sa = toStored(a); const sb = toStored(b);
  const changes = [];
  const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
  for (const k of new Set([...Object.keys(sa), ...Object.keys(sb)])) {
    if (['politica', 'limites', 'cierre'].includes(k)) {
      for (const sub of new Set([...Object.keys(sa[k] ?? {}), ...Object.keys(sb[k] ?? {})])) {
        if (!same(sa[k]?.[sub], sb[k]?.[sub])) changes.push({ field: `${k}.${sub}`, oldValue: sa[k]?.[sub], newValue: sb[k]?.[sub] });
      }
    } else if (!same(sa[k], sb[k])) changes.push({ field: k, oldValue: sa[k], newValue: sb[k] });
  }
  return changes;
}

export class BusinessSettings {
  constructor(store, { now = Date.now } = {}) {
    this.store = store;
    this.now = now;
  }

  /** La configuración guardada; si la tabla está vacía importa la inicial (una sola vez) y la devuelve. */
  loadOrSeed(seed) {
    const stored = this.store.getSetting('business');
    if (stored) {
      const v = validateBusiness(stored);
      if (!v.ok) throw new Error(`The settings saved in the database are not valid: ${v.errors.map((e) => e.mensaje).join(' ')}`);
      return v.business;
    }
    const v = validateBusiness(typeof seed === 'function' ? seed() : seed);
    if (!v.ok) throw new Error(`The initial settings are not valid: ${v.errors.map((e) => e.mensaje).join(' ')}`);
    this.store.tx(() => {
      this.store.setSetting('business', toStored(v.business), this.now());
      this.store.logSettingChange({ at: this.now(), actor: 'sistema', field: '(initial import)', oldValue: null, newValue: v.business.nombre });
    });
    return v.business;
  }

  /**
   * Valida y guarda una configuración completa. Registra cada campo que cambió.
   * @returns {{ ok: true, business, changes } | { ok: false, errors }}
   */
  save(candidate, { previous, actor = 'sistema' }) {
    const v = validateBusiness(candidate, { previous });
    if (!v.ok) return { ok: false, errors: v.errors };
    const changes = diffBusiness(previous, v.business);
    if (changes.length === 0) return { ok: true, business: v.business, changes };
    this.store.tx(() => {
      for (const { from, to } of v.renames) this.store.renameResource(from, to);
      const at = this.now();
      this.store.setSetting('business', toStored(v.business), at);
      for (const c of changes) this.store.logSettingChange({ at, actor, field: c.field, oldValue: c.oldValue, newValue: c.newValue });
    });
    return { ok: true, business: v.business, changes };
  }

  /** Lee un archivo JSON de configuración (para los valores iniciales). */
  static readSeedFile(path) {
    return JSON.parse(readFileSync(path, 'utf8'));
  }
}
