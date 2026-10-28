// Configuración del negocio guardada en la base de datos: validación, cambios y registro.
// config/negocio.json solo aporta los valores iniciales (se importa una sola vez, con la tabla vacía).
//
// Forma guardada (además de lo de negocio.json):
//   recursosLista: [{ nombre, activo }]       canchas (se pueden renombrar y desactivar, no borrar)
//   horarios: ["09:00", ...]                  horarios base de todos los días
//   horariosSemana: { "0": [...], ... }       por día de la semana (0 = domingo); [] = cerrado
//   horariosRecurso: { "Cancha 1": { "6": [...] } }   por cancha y día; pisa a lo anterior
// Al cargarla se agregan dos campos derivados: recursos (canchas activas) y recursosTodos.
import { readFileSync } from 'node:fs';

export const DEFAULT_CLOSE_TIME = '23:30';
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} .,'°º#()+-]*$/u;
const WEEKDAY_KEYS = ['0', '1', '2', '3', '4', '5', '6'];
export const WEEKDAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/** Rangos sensatos de cada número editable (también los usa el panel para mostrar ayudas). */
export const RANGES = {
  duracionMinutos: { min: 15, max: 480, label: 'La duración del turno', unit: 'minutos' },
  diasAdelante: { min: 1, max: 90, label: 'Los días de anticipación máxima', unit: 'días' },
  anticipacionMinimaMinutos: { min: 0, max: 10080, label: 'La anticipación mínima', unit: 'minutos' },
  precioTurnoArs: { min: 100, max: 10_000_000, label: 'El precio del turno', unit: 'pesos' },
  senaPorcentaje: { min: 1, max: 100, label: 'El porcentaje de seña', unit: '%' },
  reservaSinPagarMinutos: { min: 5, max: 120, label: 'El tiempo para pagar', unit: 'minutos' },
  'politica.devolucionTotalHorasAntes': { min: 0, max: 720, label: 'Las horas para devolver todo', unit: 'horas' },
  'politica.devolucionParcialHorasAntes': { min: 0, max: 720, label: 'Las horas para devolver una parte', unit: 'horas' },
  'politica.devolucionParcialPorcentaje': { min: 0, max: 100, label: 'El porcentaje de devolución parcial', unit: '%' },
  'politica.ofertaListaEsperaMinutos': { min: 5, max: 240, label: 'El tiempo de la oferta de lista de espera', unit: 'minutos' },
  'limites.devolucionMaxAutomaticaArs': { min: 0, max: 100_000_000, label: 'El tope de devolución automática', unit: 'pesos' },
  'limites.devolucionesMaxDiariasArs': { min: 0, max: 100_000_000, label: 'El tope diario de devoluciones', unit: 'pesos' },
  'limites.transferenciaMaxArs': { min: 0, max: 100_000_000, label: 'El máximo por transferencia', unit: 'pesos' },
  utcOffsetMinutos: { min: -720, max: 840, label: 'El desfase horario', unit: 'minutos' },
  'cierre.reservaMinimaArs': { min: 0, max: 100_000_000, label: 'La reserva mínima del cierre', unit: 'pesos' },
};

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const toMin = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
const clone = (v) => JSON.parse(JSON.stringify(v));
const money = (n) => `$ ${n.toLocaleString('es-AR')}`;

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
  if (!isObj(input)) return { ok: false, errors: [{ campo: '', mensaje: 'La configuración tiene que ser un objeto.' }], business: null, renames: [] };
  const out = {};

  const text = (key, { max, required = true, label }) => {
    const v = input[key];
    if (v === undefined || v === null || v === '') {
      if (required) err(key, `Falta "${key}" en la configuración del negocio.`);
      else out[key] = '';
      return;
    }
    if (typeof v !== 'string') return err(key, `${label} tiene que ser un texto.`);
    const t = v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (t.length > max) return err(key, `${label} puede tener hasta ${max} caracteres.`);
    if (required && t === '') return err(key, `${label} no puede estar vacío.`);
    out[key] = t;
  };
  const integer = (path, raw, { required = true } = {}) => {
    const r = RANGES[path];
    if (raw === undefined || raw === null || raw === '') {
      if (required) err(path, `Falta "${path}" en la configuración del negocio.`);
      return undefined;
    }
    const n = typeof raw === 'number' ? raw : (typeof raw === 'string' ? Number(raw.trim()) : NaN);
    if (!Number.isInteger(n)) { err(path, `${r.label} tiene que ser un número entero.`); return undefined; }
    if (n < r.min || n > r.max) {
      const f = r.unit === 'pesos' ? money : (x) => `${x}`;
      err(path, `${r.label} tiene que estar entre ${f(r.min)} y ${f(r.max)}${r.unit === 'pesos' ? '' : ` ${r.unit}`}.`);
      return undefined;
    }
    return n;
  };

  text('nombre', { max: 80, label: 'El nombre' });
  text('descripcion', { max: 500, required: false, label: 'La descripción' });
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
    err('recursosLista', 'Tiene que haber al menos una cancha.');
  } else if (lista.length > 20) {
    err('recursosLista', 'No puede haber más de 20 canchas.');
  } else {
    const seen = new Set(); const clean = [];
    lista.forEach((r, i) => {
      const item = typeof r === 'string' ? { nombre: r, activo: true } : r;
      const nombre = String(item?.nombre ?? '').replace(/\s+/g, ' ').trim();
      const campo = `recursosLista.${i}`;
      if (!nombre) return err(campo, `La cancha ${i + 1} no tiene nombre.`);
      if (nombre.length > 40) return err(campo, `El nombre de la cancha "${nombre.slice(0, 20)}…" es muy largo (máximo 40 caracteres).`);
      if (!NAME_RE.test(nombre)) return err(campo, `El nombre "${nombre}" tiene caracteres que no se pueden usar. Usá letras, números, espacios y . , ' ° # ( ) + -`);
      if (seen.has(nombre.toLowerCase())) return err(campo, `Hay dos canchas con el nombre "${nombre}".`);
      seen.add(nombre.toLowerCase());
      clean.push({ nombre, activo: item.activo === undefined ? true : Boolean(item.activo) });
      const anterior = typeof item?.anterior === 'string' ? item.anterior : null;
      if (anterior && anterior !== nombre) renames.push({ from: anterior, to: nombre });
      return undefined;
    });
    if (clean.length === lista.length) {
      if (!clean.some((r) => r.activo)) err('recursosLista', 'Tiene que haber al menos una cancha activa.');
      if (previous) {
        const before = deriveBusiness(previous).recursosTodos;
        const kept = new Set(clean.map((r) => r.nombre));
        const renamedFrom = new Set();
        for (const { from, to } of renames) {
          if (!before.includes(from)) err('recursosLista', `No existe la cancha "${from}" que querés renombrar.`);
          else if (renamedFrom.has(from)) err('recursosLista', `La cancha "${from}" aparece renombrada dos veces.`);
          else if (before.includes(to) && !renames.some((x) => x.from === to)) err('recursosLista', `Ya existe una cancha llamada "${to}".`);
          renamedFrom.add(from);
        }
        for (const old of before) {
          if (!kept.has(old) && !renamedFrom.has(old)) err('recursosLista', `No se puede borrar "${old}": tiene o puede tener reservas. Desactivala para que no se pueda reservar.`);
        }
      }
      out.recursosLista = clean;
    }
  }
  const resourceNames = (out.recursosLista ?? []).map((r) => r.nombre);

  // Horarios
  const duration = out.duracionMinutos;
  const timeList = (raw, campo, label, { allowEmpty }) => {
    if (!Array.isArray(raw)) { err(campo, `${label} tiene que ser una lista de horarios.`); return null; }
    if (raw.length > 48) { err(campo, `${label}: hay demasiados horarios.`); return null; }
    if (raw.length === 0 && !allowEmpty) { err(campo, `${label}: cargá al menos un horario.`); return null; }
    const list = [];
    for (const t of raw) {
      const s = String(t).trim();
      if (!TIME_RE.test(s)) { err(campo, `${label}: "${s}" no es un horario válido (usá HH:MM, por ejemplo 20:30).`); return null; }
      if (list.includes(s)) { err(campo, `${label}: el horario ${s} está repetido.`); return null; }
      list.push(s);
    }
    list.sort();
    if (duration) {
      for (let i = 1; i < list.length; i++) {
        if (toMin(list[i]) - toMin(list[i - 1]) < duration) {
          err(campo, `${label}: los turnos de ${list[i - 1]} y ${list[i]} se pisan (cada turno dura ${duration} minutos).`);
          return null;
        }
      }
    }
    return list;
  };
  const base = timeList(input.horarios, 'horarios', 'Los horarios base', { allowEmpty: false });
  if (base) out.horarios = base;

  if (input.horariosSemana !== undefined && input.horariosSemana !== null) {
    if (!isObj(input.horariosSemana)) err('horariosSemana', 'Los horarios por día tienen que ser un objeto.');
    else {
      const semana = {};
      for (const [day, list] of Object.entries(input.horariosSemana)) {
        if (!WEEKDAY_KEYS.includes(day)) { err('horariosSemana', `"${day}" no es un día de la semana (0 = domingo ... 6 = sábado).`); continue; }
        const l = timeList(list, `horariosSemana.${day}`, `Los horarios del ${WEEKDAY_NAMES[day]}`, { allowEmpty: true });
        if (l) semana[day] = l;
      }
      if (Object.keys(semana).length) out.horariosSemana = semana;
    }
  }
  if (input.horariosRecurso !== undefined && input.horariosRecurso !== null) {
    if (!isObj(input.horariosRecurso)) err('horariosRecurso', 'Los horarios por cancha tienen que ser un objeto.');
    else {
      const porRecurso = {};
      for (const [name, days] of Object.entries(input.horariosRecurso)) {
        if (!resourceNames.includes(name)) { err('horariosRecurso', `Hay horarios para "${name}", que no es una cancha.`); continue; }
        if (!isObj(days)) { err('horariosRecurso', `Los horarios de "${name}" tienen que ser un objeto por día.`); continue; }
        const byDay = {};
        for (const [day, list] of Object.entries(days)) {
          if (!WEEKDAY_KEYS.includes(day)) { err('horariosRecurso', `"${day}" no es un día de la semana (0 = domingo ... 6 = sábado).`); continue; }
          const l = timeList(list, `horariosRecurso.${name}.${day}`, `Los horarios de ${name} del ${WEEKDAY_NAMES[day]}`, { allowEmpty: true });
          if (l) byDay[day] = l;
        }
        if (Object.keys(byDay).length) porRecurso[name] = byDay;
      }
      if (Object.keys(porRecurso).length) out.horariosRecurso = porRecurso;
    }
  }

  // Política
  const p = isObj(input.politica) ? input.politica : null;
  if (!p) err('politica', 'Falta "politica" en la configuración del negocio.');
  else {
    const total = integer('politica.devolucionTotalHorasAntes', p.devolucionTotalHorasAntes);
    const parcial = integer('politica.devolucionParcialHorasAntes', p.devolucionParcialHorasAntes);
    const pct = integer('politica.devolucionParcialPorcentaje', p.devolucionParcialPorcentaje);
    const espera = integer('politica.ofertaListaEsperaMinutos', p.ofertaListaEsperaMinutos);
    if (total !== undefined && parcial !== undefined && parcial >= total) {
      err('politica.devolucionParcialHorasAntes', `Las horas para devolver una parte (${parcial}) tienen que ser menos que las de devolver todo (${total}).`);
    }
    if (typeof p.devolverSiSeRevende !== 'boolean') err('politica.devolverSiSeRevende', 'Indicá si se devuelve cuando el turno se revende (sí o no).');
    out.politica = {
      devolucionTotalHorasAntes: total, devolucionParcialHorasAntes: parcial, devolucionParcialPorcentaje: pct,
      devolverSiSeRevende: p.devolverSiSeRevende === true, ofertaListaEsperaMinutos: espera,
    };
  }

  // Límites
  const l = isObj(input.limites) ? input.limites : null;
  if (!l) err('limites', 'Falta "limites" en la configuración del negocio.');
  else {
    const auto = integer('limites.devolucionMaxAutomaticaArs', l.devolucionMaxAutomaticaArs);
    const diario = integer('limites.devolucionesMaxDiariasArs', l.devolucionesMaxDiariasArs);
    const maxT = integer('limites.transferenciaMaxArs', l.transferenciaMaxArs);
    if (auto !== undefined && diario !== undefined && auto > diario) {
      err('limites.devolucionMaxAutomaticaArs', `El tope de devolución automática (${money(auto)}) no puede superar el tope diario (${money(diario)}).`);
    }
    out.limites = { devolucionMaxAutomaticaArs: auto, devolucionesMaxDiariasArs: diario, transferenciaMaxArs: maxT };
  }

  // Cierre
  const c = isObj(input.cierre) ? input.cierre : {};
  const hora = c.hora === undefined || c.hora === '' ? DEFAULT_CLOSE_TIME : String(c.hora).trim();
  if (!TIME_RE.test(hora)) err('cierre.hora', `La hora del cierre "${hora}" no es válida (usá HH:MM, por ejemplo 23:30).`);
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
  if (!isObj(patch)) return { picked, errors: [{ campo: '', mensaje: 'Mandá un objeto con los cambios.' }] };
  for (const [k, v] of Object.entries(patch)) {
    if (EDITABLE_TOP.includes(k)) picked[k] = v;
    else if (EDITABLE_NESTED[k] && isObj(v)) {
      picked[k] = {};
      for (const [sub, sv] of Object.entries(v)) {
        if (EDITABLE_NESTED[k].includes(sub)) picked[k][sub] = sv;
        else errors.push({ campo: `${k}.${sub}`, mensaje: `"${k}.${sub}" no se puede cambiar desde el panel.` });
      }
    } else errors.push({ campo: k, mensaje: `"${k}" no se puede cambiar desde el panel.` });
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
      if (!v.ok) throw new Error(`La configuración guardada en la base no es válida: ${v.errors.map((e) => e.mensaje).join(' ')}`);
      return v.business;
    }
    const v = validateBusiness(typeof seed === 'function' ? seed() : seed);
    if (!v.ok) throw new Error(`La configuración inicial no es válida: ${v.errors.map((e) => e.mensaje).join(' ')}`);
    this.store.tx(() => {
      this.store.setSetting('business', toStored(v.business), this.now());
      this.store.logSettingChange({ at: this.now(), actor: 'sistema', field: '(importación inicial)', oldValue: null, newValue: v.business.nombre });
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
