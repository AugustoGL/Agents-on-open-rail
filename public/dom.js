// Ayudas compartidas por las páginas. Regla de oro: todo texto que viene de la base o de personas
// entra al documento como texto (textContent / createTextNode), nunca como HTML.

/** Crea un elemento. props: class, text, onclick..., value, checked, disabled, hidden, o cualquier atributo. */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (['value', 'checked', 'disabled', 'hidden', 'selected'].includes(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const $ = (selector, root = document) => root.querySelector(selector);

export function setChildren(el, ...children) {
  el.replaceChildren(...children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false).map((c) => (c instanceof Node ? c : document.createTextNode(String(c)))));
  return el;
}

/** Solo links propios o a Celoscan: nada de javascript: ni de dominios que vengan de datos. */
export function safeHref(href) {
  const s = String(href);
  if (/^\/[A-Za-z0-9/_\-.?=&]*$/.test(s)) return s;
  if (/^https:\/\/celoscan\.io\/tx\/0x[a-fA-F0-9]{64}$/.test(s)) return s;
  return '#';
}

export const isTxHash = (tx) => typeof tx === 'string' && /^0x[a-fA-F0-9]{64}$/.test(tx);

const DIAS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MESES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-10-22" -> "jue 22/10" */
export function fmtDay(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return `${DIAS[dt.getUTCDay()]} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
}
export function fmtDayLong(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return `${DIAS[dt.getUTCDay()]} ${d} ${MESES[m - 1]}`;
}

/** Fecha y hora en la zona del negocio (Argentina), a partir de un instante ISO. */
export function fmtInstant(iso) {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Argentina/Cordoba', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
  } catch {
    return String(iso);
  }
}

export const storage = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* sin almacenamiento: sigue funcionando */ } },
};

/** Pedido JSON; si la respuesta no es ok, tira un Error con el mensaje del servidor (y .data con el cuerpo). */
let desfaseServidor = 0;
/** La hora del servidor (para las cuentas regresivas: no dependen del reloj del celular). */
export const ahoraServidor = () => Date.now() + desfaseServidor;

export async function request(method, url, body, headers = {}) {
  const res = await fetch(url, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const fechaServidor = Date.parse(res.headers.get('date') ?? '');
  if (!Number.isNaN(fechaServidor)) desfaseServidor = fechaServidor - Date.now();
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error ?? `Error ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// --- Piezas del sistema de diseño (public/css/sena.css) ---------------------------------------------------

const DIAS_LARGOS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MESES_LARGOS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** "2026-10-29" -> "Thursday 29 October" */
export function fmtFecha(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return `${DIAS_LARGOS[dt.getUTCDay()]} ${d} ${MESES_LARGOS[m - 1]}`;
}
/** "2026-10-29" -> { semana: "jue", numero: 29, mes: "oct" } */
export function partesDia(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return { semana: DIAS[dt.getUTCDay()], numero: d, mes: MESES[m - 1] };
}
export const abreviar = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');

/** Ícono decorativo (siempre va con texto al lado). */
export const icono = (nombre) => h('span', { class: `i i-${nombre}`, 'aria-hidden': 'true' });

/** Aviso: kind = info | ok | atencion | error. */
export function aviso(kind, ...content) {
  return h('div', { class: `aviso aviso-${kind}`, role: kind === 'error' ? 'alert' : 'status' }, h('div', {}, ...content));
}

/** Carteles de "comercio de demostración" y "MODO PRUEBA". */
export function carteles(negocio, { modoPrueba } = {}) {
  const prueba = modoPrueba ?? negocio.modoPrueba;
  return [
    negocio.esDemostracion ? h('div', { class: 'cartel cartel--demo', role: 'note' }, icono('alert'), h('div', {}, h('strong', {}, 'Demo venue.'), ' The slots and prices are examples.')) : null,
    prueba ? h('div', { class: 'cartel cartel--prueba', role: 'note' }, icono('info'), h('div', {}, h('strong', {}, 'TEST MODE.'), ' No real money moves.')) : null,
  ];
}

const ETIQUETAS = {
  held: ['es-esperando', 'Awaiting payment'], confirmed: ['es-confirmada', 'Confirmed'], cancelled: ['es-cancelada', 'Cancelled'],
  expired: ['es-vencida', 'Expired'], completed: ['es-jugada', 'Played'],
};
/** Etiqueta de estado de una reserva: mismo color e ícono en todas las pantallas. */
export function estadoEtiqueta(estado) {
  const [clase, texto] = ETIQUETAS[estado] ?? ['es-vencida', estado];
  return h('span', { class: `estado ${clase}` }, texto);
}

export const cargando = (texto = 'Loading…') => h('div', { class: 'cargando', role: 'status' }, h('div', { class: 'girando', 'aria-hidden': 'true' }), h('p', {}, texto));
export const esqueletos = () => h('div', { class: 'pila--chica', 'aria-hidden': 'true' }, h('div', { class: 'esqueleto esqueleto--titulo' }), h('div', { class: 'esqueleto esqueleto--bloque' }), h('div', { class: 'esqueleto esqueleto--bloque' }));
export function vacio({ icon = 'calendar', titulo, texto, accion }) {
  return h('div', { class: 'vacio' }, h('div', { class: 'vacio-icono' }, icono(icon)), h('h3', {}, titulo), texto ? h('p', {}, texto) : null, accion ?? null);
}

/** Barra superior de las páginas del cliente. */
export function barraCliente({ activa } = {}) {
  return h('header', { class: 'barra' }, h('div', { class: 'barra-interior' },
    h('a', { class: 'marca', href: '/' }, h('span', { class: 'marca-logo' }, icono('check')), 'Seña'),
    h('a', { class: 'nav-link solo-movil al-final', href: '/#mis-reservas' }, icono('list'), 'My bookings'),
    h('nav', { class: 'nav-superior', 'aria-label': 'Main' },
      h('a', { class: 'nav-link', href: '/', ...(activa === 'reservar' ? { 'aria-current': 'page' } : {}) }, icono('calendar'), 'Book'),
      h('a', { class: 'nav-link', href: '/#mis-reservas' }, icono('list'), 'My bookings'),
      h('a', { class: 'nav-link', href: '/decisiones' }, icono('doc'), 'What the agent decides'))));
}
