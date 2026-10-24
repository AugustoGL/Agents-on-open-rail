// Entender mensajes en castellano ("¿hay cancha mañana a las 21?", "cancelá S-ABC123").
// El modelo de lenguaje (opcional) solo INTERPRETA el pedido y devuelve una intención.
// Lo que se hace con esa intención (reservar, cobrar, devolver) lo decide el código del agente.
import { localDateStr, addDays } from './time.js';

export const ACTIONS = ['reservar', 'ver_turnos', 'mis_reservas', 'cancelar', 'lista_espera', 'politica', 'ayuda', 'otro'];

const DIAS = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6 };

const strip = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function parseDate(t, { now, offset }) {
  const today = localDateStr(now, offset);
  if (/pasado manana/.test(t)) return addDays(today, 2);
  if (/\bmanana\b/.test(t)) return addDays(today, 1);
  if (/\bhoy\b|esta noche|esta tarde/.test(t)) return today;
  const dm = /\b(\d{1,2})\/(\d{1,2})\b/.exec(t);
  if (dm) {
    const [y] = today.split('-');
    const d = `${y}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}`;
    return d < today ? `${Number(y) + 1}${d.slice(4)}` : d;
  }
  for (const [name, dow] of Object.entries(DIAS)) {
    if (new RegExp(`\\b${name}\\b`).test(t)) {
      const todayDow = new Date(`${today}T12:00:00Z`).getUTCDay();
      const diff = (dow - todayDow + 7) % 7;
      return addDays(today, diff);
    }
  }
  return null;
}

function parseTime(t) {
  // "21", "21:30", "21.30", "21hs", "a las 9", "9 de la noche"
  const m = /(?:a las |las |\b)(\d{1,2})(?:[:.h](\d{2}))?\s*(?:hs|h|horas)?\b(\s*de la (?:noche|tarde))?/.exec(t.replace(/s-[a-z0-9]{6}/g, ''));
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (m[3] && h < 12) h += 12;
  if (h > 23 || min > 59) return null;
  if (!m[2] && !/a las|las |hs|h\b|horas|de la/.test(m[0]) && (h < 7)) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** Interpretación sin modelo: reglas simples que cubren los pedidos más comunes. */
export function parseIntentHeuristic(text, { now, offset, business }) {
  const t = strip(text);
  const id = /\bs-[a-z0-9]{6}\b/.exec(t)?.[0]?.toUpperCase() ?? null;
  const recursoIdx = business.recursos.findIndex((r) => t.includes(strip(r)));
  const base = { fecha: parseDate(t, { now, offset }), hora: parseTime(t), recurso: recursoIdx >= 0 ? business.recursos[recursoIdx] : null, reservaId: id };

  if (/cancel|anul|dar de baja|no (voy|vamos|puedo ir)/.test(t)) return { accion: id ? 'cancelar' : 'mis_reservas', ...base };
  if (/mis (reservas|turnos)|que reserv|tengo (reserva|turno)/.test(t)) return { accion: 'mis_reservas', ...base };
  if (/lista de espera|anotame|avisame si se libera/.test(t)) return { accion: 'lista_espera', ...base };
  if (/politica|devolu|reembols|como funciona|cuanto (sale|cuesta)|precio|sena/.test(t)) return { accion: 'politica', ...base };
  if (/reserv|turno|cancha|jugar|lugar|libre|disponib|hay (algo|para)/.test(t) || base.fecha || base.hora) {
    return { accion: base.fecha && base.hora ? 'reservar' : 'ver_turnos', ...base };
  }
  if (/^(hola|buenas|buen dia|buenas tardes|buenas noches|ayuda|help|menu)\b/.test(t)) return { accion: 'ayuda', ...base };
  return { accion: 'otro', ...base };
}

const TOOL = {
  name: 'interpretar_pedido',
  description: 'Clasifica el pedido del cliente de un complejo deportivo y extrae los datos. No decide nada sobre plata.',
  input_schema: {
    type: 'object',
    properties: {
      accion: { type: 'string', enum: ACTIONS },
      fecha: { type: ['string', 'null'], description: 'Fecha local YYYY-MM-DD o null' },
      hora: { type: ['string', 'null'], description: 'Hora local HH:MM o null' },
      recurso: { type: ['string', 'null'] },
      reservaId: { type: ['string', 'null'], description: 'Id de reserva tipo S-ABC123 o null' },
      respuesta: { type: ['string', 'null'], description: 'Respuesta corta y amable en castellano rioplatense si accion es "otro" o "ayuda"' },
    },
    required: ['accion'],
  },
};

/**
 * Intérprete con Claude (opcional). Fuerza una herramienta para obtener JSON estructurado.
 * Docs: https://platform.claude.com/docs/en/api/messages
 */
export function createClaudeInterpreter({ apiKey, model = 'claude-haiku-5-5', fetchImpl = globalThis.fetch, timeoutMs = 15_000 }) {
  return async function interpretWithClaude(text, { now, offset, business }) {
    const today = localDateStr(now, offset);
    const system = [
      `Sos el asistente de reservas de "${business.nombre}". Hoy es ${today} (hora de Argentina).`,
      `Recursos: ${business.recursos.join(', ')}. Horarios de inicio: ${business.horarios.join(', ')}.`,
      'Solo interpretás el pedido con la herramienta. Nunca prometés devoluciones ni montos: eso lo decide el sistema.',
    ].join(' ');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model, max_tokens: 300, system,
          messages: [{ role: 'user', content: String(text).slice(0, 1000) }],
          tools: [TOOL],
          tool_choice: { type: 'tool', name: TOOL.name },
        }),
      });
      if (!res.ok) throw new Error(`Claude respondió ${res.status}`);
      const data = await res.json();
      const block = data.content?.find((c) => c.type === 'tool_use' && c.name === TOOL.name);
      if (!block) return null;
      const i = block.input ?? {};
      return {
        accion: ACTIONS.includes(i.accion) ? i.accion : 'otro',
        fecha: typeof i.fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(i.fecha) ? i.fecha : null,
        hora: typeof i.hora === 'string' && /^\d{2}:\d{2}$/.test(i.hora) ? i.hora : null,
        recurso: business.recursos.includes(i.recurso) ? i.recurso : null,
        reservaId: typeof i.reservaId === 'string' && /^S-[A-Z0-9]{6}$/.test(i.reservaId) ? i.reservaId : null,
        respuesta: typeof i.respuesta === 'string' ? i.respuesta.slice(0, 600) : null,
        fuente: 'claude',
      };
    } finally {
      clearTimeout(timer);
    }
  };
}

/** Reglas primero; si no alcanzan y hay Claude configurado, se le pregunta al modelo. */
export function createInterpreter({ claude, logger = console } = {}) {
  return async function interpret(text, ctx) {
    const h = parseIntentHeuristic(text, ctx);
    if (h.accion !== 'otro' || !claude) return { ...h, fuente: 'reglas' };
    try {
      return (await claude(text, ctx)) ?? { ...h, fuente: 'reglas' };
    } catch (err) {
      logger.warn?.(`[nl] Claude no respondió: ${err.message}`);
      return { ...h, fuente: 'reglas' };
    }
  };
}
