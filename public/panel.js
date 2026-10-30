// Venue dashboard. Móvil primero: menú inferior en celular y barra superior en pantallas grandes.
// Todo lo que viene del servidor entra como texto (nunca como HTML).
import {
  h, $, setChildren, request, safeHref, isTxHash, fmtFecha, partesDia, fmtInstant, abreviar, carteles, icono, aviso, esqueletos, vacio, estadoEtiqueta,
} from '/static/dom.js';
import { GRUPOS, grupoDe, agruparPorDia, tarjetaDecision, tituloDe } from '/static/decisiones-vista.js';

const app = $('#app');
let csrf = null;
let sessionInfo = null;
let rutaActual = null;
let hayCambiosSinGuardar = false;

const PRINCIPALES = [['hoy', 'Today', 'home'], ['calendario', 'Calendar', 'calendar'], ['reservas', 'Bookings', 'list'], ['pendientes', 'Pending', 'bell']];
const MAS = [['bloqueos', 'Blocks', 'lock'], ['decisiones', 'Agent decisions', 'doc'], ['config', 'Settings', 'sliders'], ['cierre', 'Daily close', 'wallet']];
const TITULOS = {
  hoy: 'Today', calendario: 'Calendar', reservas: 'Bookings', pendientes: 'Pending', bloqueos: 'Blocks', decisiones: 'Agent decisions', config: 'Settings', cierre: 'Daily close',
};
const ESTADOS_FILTRO = [['', 'All statuses'], ['held', 'Awaiting payment'], ['confirmed', 'Confirmed'], ['cancelled', 'Cancelled'], ['expired', 'Expired'], ['completed', 'Played']];
const CAL_CLASES = { libre: 'es-libre', esperando_pago: 'es-esperando', confirmado: 'es-confirmada', bloqueado: 'es-bloqueada' };
const CAL_TEXTOS = { libre: 'Free', esperando_pago: 'Awaiting payment', confirmado: 'Confirmed', bloqueado: 'Blocked' };
const TIPO_BLOQUEO = { turno: 'One slot', recurso: 'One court', dia: 'The whole day' };

// --- Pedidos ------------------------------------------------------------------------------------------------

async function api(method, path, body) {
  try {
    return await request(method, `/panel/api${path}`, body, method !== 'GET' && csrf ? { 'x-csrf-token': csrf } : {});
  } catch (err) {
    if (err.status === 401 && err.data?.codigo === 'sin_sesion') { csrf = null; hayCambiosSinGuardar = false; mostrarIngreso('Your session ended. Please sign in again.'); }
    throw err;
  }
}
const mensajeDe = (err) => (err.status ? err.message : 'We could not connect. Check your connection and try again.');
const errorAviso = (err, reintentar) => aviso('error', h('strong', {}, err.data?.errores?.length ? err.message : 'Something went wrong'), err.data?.errores?.length ? '' : mensajeDe(err),
  err.data?.errores?.length ? h('ul', {}, err.data.errores.map((e) => h('li', {}, e.mensaje))) : null,
  reintentar ? h('div', { class: 'acciones' }, h('button', { class: 'btn btn-secundario', type: 'button', onclick: reintentar }, 'Try again')) : null);
const money = (m) => String(m).replace('$ ', '$ ');
const txLink = (tx) => (isTxHash(tx) && sessionInfo?.modo !== 'mock'
  ? h('a', { href: safeHref(`https://celoscan.io/tx/${tx}`), target: '_blank', rel: 'noopener noreferrer' }, 'View on Celoscan')
  : (tx ? h('span', { class: 'apagado' }, 'Simulated transaction') : null));
const fila = (label, value) => h('div', {}, h('dt', {}, label), h('dd', {}, value));

// --- Ventanas -----------------------------------------------------------------------------------------------

/** Ventana con foco controlado: Escape la cierra, Tab no se escapa de ella y el foco vuelve a donde estaba. */
function abrirVentana(...contenido) {
  const previo = document.activeElement;
  const cerrar = () => { fondo.remove(); document.removeEventListener('keydown', alTeclear); previo?.focus?.(); };
  const alTeclear = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); cerrar(); return; }
    if (e.key !== 'Tab') return;
    const foco = [...ventana.querySelectorAll('a[href], button:not([disabled]), input, select, textarea, summary, [tabindex="0"]')].filter((el) => !el.closest('[hidden]'));
    if (!foco.length) return;
    const primero = foco[0]; const ultimo = foco.at(-1);
    if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
    else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
  };
  const ventana = h('div', { class: 'modal pila', role: 'dialog', 'aria-modal': 'true' }, contenido);
  const fondo = h('div', { class: 'modal-fondo', onclick: (e) => { if (e.target === fondo) cerrar(); } }, ventana);
  document.addEventListener('keydown', alTeclear);
  document.body.append(fondo);
  const titulo = ventana.querySelector('h2');
  if (titulo) { titulo.setAttribute('tabindex', '-1'); ventana.setAttribute('aria-labelledby', titulo.id ||= 'titulo-ventana'); titulo.focus(); } else ventana.querySelector('button, a')?.focus();
  return { cerrar, ventana };
}

/** Pregunta de sí o no con botones claros. Devuelve true si confirmó. */
function confirmar({ titulo, texto, ok = 'Confirm', peligro = false, cancelar = 'Back' }) {
  return new Promise((resolve) => {
    let listo = false;
    const fin = (v) => { if (listo) return; listo = true; v2.cerrar(); resolve(v); };
    const v2 = abrirVentana(h('h2', {}, titulo), texto ? (typeof texto === 'string' ? h('p', {}, texto) : texto) : null,
      h('div', { class: 'acciones' },
        h('button', { class: 'btn btn-secundario', type: 'button', onclick: () => fin(false) }, cancelar),
        h('button', { class: `btn ${peligro ? 'btn-peligro' : 'btn-primario'}`, type: 'button', 'data-confirmar': '', onclick: () => fin(true) }, ok)));
    const observador = new MutationObserver(() => { if (!document.body.contains(v2.ventana)) { observador.disconnect(); fin(false); } });
    observador.observe(document.body, { childList: true });
  });
}

// --- Ingreso --------------------------------------------------------------------------------------------------

function mostrarIngreso(mensaje) {
  const error = h('div', { id: 'clave-error', 'aria-live': 'polite' });
  if (mensaje) setChildren(error, aviso('atencion', mensaje));
  const input = h('input', { type: 'password', id: 'clave', class: 'input', autocomplete: 'current-password', required: true, 'aria-describedby': 'clave-error' });
  const ver = h('input', { type: 'checkbox', onchange: (e) => { input.type = e.target.checked ? 'text' : 'password'; } });
  const boton = h('button', { type: 'submit', class: 'btn btn-primario btn-grande btn-bloque' }, 'Sign in');
  const ayuda = h('p', { class: 'ayuda' }, 'The password is the one you set in OWNER_DASHBOARD_PASSWORD, in the .env file.');
  // En la demo del hackathon la clave es pública a propósito (el servidor solo la manda si esDemostracion y DEMO_PANEL_PUBLICO).
  request('GET', '/api/negocio').then((n) => {
    if (!n.claveDemoPanel) return;
    setChildren(ayuda, 'Hackathon demo: anyone can try the dashboard. The password is ', h('strong', { class: 'mono' }, n.claveDemoPanel), '. ',
      h('button', { type: 'button', class: 'btn btn-secundario', onclick: () => { input.value = n.claveDemoPanel; input.focus(); } }, 'Fill it in'));
  }).catch(() => {});
  const form = h('form', {
    class: 'tarjeta tarjeta--realzada pila',
    onsubmit: async (e) => {
      e.preventDefault();
      boton.setAttribute('aria-busy', 'true');
      try {
        const r = await request('POST', '/panel/api/login', { clave: input.value });
        csrf = r.csrf; input.value = '';
        await iniciar();
      } catch (err) {
        input.value = ''; input.setAttribute('aria-invalid', 'true');
        setChildren(error, aviso('error', mensajeDe(err)));
        input.focus();
      } finally { boton.removeAttribute('aria-busy'); }
    },
  }, h('div', { class: 'campo' }, h('label', { for: 'clave' }, 'Dashboard password'), input), h('label', { class: 'marca-check' }, ver, 'Show password'), error, boton,
  ayuda);
  setChildren(app, h('main', { class: 'pantalla-ingreso', id: 'contenido' }, h('div', { class: 'insignia-grande' }, icono('lock')),
    h('div', { class: 'centrado pila--chica' }, h('h1', {}, 'Venue dashboard'), h('p', { class: 'apagado' }, sessionInfo?.negocio ?? 'Seña')), form,
    h('a', { href: '/', class: 'btn btn-fantasma' }, 'Back to the booking site')));
  input.focus();
}

async function iniciar() {
  try {
    sessionInfo = await request('GET', '/panel/api/session');
  } catch (err) {
    setChildren(app, h('main', { class: 'contenedor', id: 'contenido' }, errorAviso(err, iniciar)));
    return;
  }
  if (!sessionInfo.habilitado) {
    setChildren(app, h('main', { class: 'pantalla-ingreso', id: 'contenido' }, h('div', { class: 'insignia-grande' }, icono('lock')), h('h1', {}, 'Dashboard disabled'),
      h('div', { class: 'tarjeta pila' }, aviso('atencion', sessionInfo.mensaje), h('p', { class: 'apagado' }, 'Set a password of at least 8 characters in OWNER_DASHBOARD_PASSWORD and restart the server.'))));
    return;
  }
  if (!sessionInfo.autenticado) { mostrarIngreso(); return; }
  csrf = sessionInfo.csrf;
  armarEstructura();
}

// --- Estructura: barra, menú inferior y contenido ------------------------------------------------------------------

function armarEstructura() {
  const enlace = ([id, label, ic]) => h('a', { class: 'nav-link', href: `#${id}`, 'data-ruta': id }, icono(ic), label);
  const inferior = ([id, label, ic]) => h('a', { href: `#${id}`, 'data-ruta': id }, icono(ic), label, id === 'pendientes' ? h('span', { class: 'insignia', id: 'insignia-pendientes', hidden: true }, '0') : null);
  setChildren(app,
    h('div', { id: 'carteles' }, carteles({ esDemostracion: sessionInfo.esDemostracion }, { modoPrueba: sessionInfo.modo === 'mock' })),
    h('header', { class: 'barra' }, h('div', { class: 'barra-interior' },
      h('a', { class: 'marca', href: '#hoy' }, h('span', { class: 'marca-logo' }, icono('check')), 'Seña', h('span', { class: 'apagado', style: undefined }, ' · Dashboard')),
      h('span', { class: 'nombre-comercio apagado solo-escritorio' }, sessionInfo.negocio),
      h('button', { class: 'btn btn-secundario btn-chico al-final', type: 'button', onclick: salir }, 'Sign out'))),
    h('div', { class: 'panel-layout' },
      h('nav', { class: 'lateral', 'aria-label': 'Dashboard sections' }, h('h2', {}, 'Day to day'), PRINCIPALES.map(enlace), h('h2', {}, 'Manage'), MAS.map(enlace),
        h('a', { class: 'nav-link', href: '/', target: '_blank', rel: 'noopener' }, icono('external'), 'Open the booking site')),
      h('main', { id: 'contenido', class: 'panel-contenido con-nav-inferior', tabindex: '-1' }, h('div', { id: 'vista', class: 'vista-panel pila--grande' }))),
    h('nav', { class: 'nav-inferior', 'aria-label': 'Dashboard menu' }, PRINCIPALES.map(inferior),
      h('button', { type: 'button', id: 'boton-mas', onclick: abrirMas }, icono('dots'), 'More')),
    h('div', { id: 'barra-guardar-caja' }));
  route();
}

async function salir() {
  if (hayCambiosSinGuardar && !(await confirmar({ titulo: 'You have unsaved changes', texto: 'They will be lost if you sign out now.', ok: 'Sign out anyway', peligro: true }))) return;
  await api('POST', '/logout', {}).catch(() => {});
  csrf = null; hayCambiosSinGuardar = false; location.hash = '';
  await iniciar();
}

function abrirMas() {
  const v = abrirVentana(h('h2', {}, 'More options'),
    h('ul', { class: 'menu-lista' },
      MAS.map(([id, label, ic]) => h('li', {}, h('a', { href: `#${id}`, onclick: () => v.cerrar() }, icono(ic), label, icono('chevron')))),
      h('li', {}, h('a', { href: '/', target: '_blank', rel: 'noopener' }, icono('external'), 'Open the booking site')),
      h('li', {}, h('a', { href: '/decisiones', target: '_blank', rel: 'noopener' }, icono('shield'), 'Agent public log')),
      h('li', {}, h('button', { type: 'button', onclick: () => { v.cerrar(); salir(); } }, icono('x'), 'Sign out'))),
    h('div', { class: 'acciones' }, h('button', { class: 'btn btn-secundario', type: 'button', onclick: () => v.cerrar() }, 'Close')));
}

window.addEventListener('hashchange', () => { if (csrf) route(); });

let volviendo = false;
async function route() {
  const id = Object.keys(TITULOS).includes(location.hash.slice(1)) ? location.hash.slice(1) : 'hoy';
  if (volviendo) { volviendo = false; return; }
  if (hayCambiosSinGuardar && rutaActual === 'config' && id !== 'config') {
    const salirSeguro = await confirmar({ titulo: 'You have unsaved changes', texto: 'They will be lost if you leave this screen.', ok: 'Discard changes', peligro: true, cancelar: 'Keep editing' });
    if (!salirSeguro) { volviendo = true; location.hash = 'config'; return; }
    hayCambiosSinGuardar = false; setChildren($('#barra-guardar-caja'));
  }
  rutaActual = id;
  document.title = `${TITULOS[id]} · Dashboard · Seña`;
  for (const a of document.querySelectorAll('[data-ruta]')) { if (a.dataset.ruta === id) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); }
  $('#boton-mas')?.[MAS.some(([m]) => m === id) ? 'setAttribute' : 'removeAttribute']('aria-current', 'page');
  const raiz = h('div', { class: 'pila--grande' }, h('div', { class: 'pagina-titulo' }, h('h1', { id: 'titulo-vista', tabindex: '-1' }, TITULOS[id])), esqueletos());
  setChildren($('#vista'), raiz);
  const flash = flashPendiente; flashPendiente = null;
  try {
    const contenido = await VISTAS[id]();
    if (!raiz.isConnected) return; // cambió de pantalla mientras cargaba
    setChildren(raiz, h('div', { class: 'pagina-titulo' }, h('h1', { id: 'titulo-vista', tabindex: '-1' }, TITULOS[id]), contenido.descripcion ? h('p', {}, contenido.descripcion) : null), flash, contenido.nodos);
    contenido.despues?.();
  } catch (err) {
    if (raiz.isConnected && err.status !== 401) setChildren(raiz, h('div', { class: 'pagina-titulo' }, h('h1', {}, TITULOS[id])), errorAviso(err, route));
  }
  actualizarInsignia();
}
let flashPendiente = null;
const recargarCon = (mensaje) => { flashPendiente = mensaje; route(); };

async function actualizarInsignia() {
  try {
    const { transferencias } = await api('GET', '/pendientes');
    const n = transferencias.length; const el = $('#insignia-pendientes');
    if (el) { el.textContent = String(n); el.hidden = n === 0; el.setAttribute('aria-label', `${n} pending`); }
  } catch { /* la insignia es un extra */ }
}

// --- Detalle de una reserva -----------------------------------------------------------------------------------------------

async function abrirReserva(id, alCambiar) {
  let d;
  try { d = await api('GET', `/reservas/${id}`); } catch (err) { abrirVentana(h('h2', {}, 'Could not open the booking'), errorAviso(err)); return; }
  const b = d.reserva;
  const activa = b.estado === 'held' || b.estado === 'confirmed';
  const mensaje = h('div', { 'aria-live': 'polite' });
  const motivo = h('input', { type: 'text', class: 'input', maxlength: '120', placeholder: 'E.g.: rain, court under maintenance', 'aria-label': 'Cancellation reason' });
  const cancelarCon = (devolucion, texto) => async () => {
    if (!(await confirmar({ titulo: 'Cancel this booking?', texto, ok: 'Yes, cancel', peligro: true }))) return;
    try {
      const r = await api('POST', `/reservas/${b.id}/cancelar`, { devolucion, motivo: motivo.value });
      v.cerrar();
      if (alCambiar) await alCambiar();
      abrirVentana(h('h2', {}, 'Booking cancelled'), aviso('ok', h('strong', {}, r.motivo), `Refund: ${money(r.devolucion)}.`));
    } catch (err) { setChildren(mensaje, errorAviso(err)); }
  };
  const opcion = (titulo, p, boton, devolucion, peligro) => (p.ok
    ? h('div', { class: 'tarjeta tarjeta--plana pila--chica' }, h('strong', {}, titulo), h('p', {}, p.motivo), h('p', { class: 'dato-valor num' }, money(p.devolucion)),
      h('button', { class: `btn ${peligro ? 'btn-peligro' : 'btn-peligro-suave'} btn-bloque`, type: 'button', onclick: cancelarCon(devolucion, `${money(p.devolucion)} will be refunded. ${p.motivo}`) }, boton))
    : null);
  const v = abrirVentana(
    h('div', { class: 'fila fila--separada' }, h('h2', {}, `Booking ${b.id}`), estadoEtiqueta(b.estado)),
    h('dl', { class: 'resumen' },
      fila('Slot', `${b.recurso} · ${b.inicioLocal}`), fila('Customer', b.cliente ?? '—'), fila('Contact', b.contacto ?? '—'), fila('Channel', b.canal), fila('Deposit', money(b.sena.texto)),
      b.devuelto.wei !== '0' ? fila('Refunded', money(b.devuelto.texto)) : null, b.pagador ? fila('Paid from', abreviar(b.pagador)) : null, b.pagoTx ? fila('Receipt', txLink(b.pagoTx)) : null,
      b.venceEl ? fila('Expires', fmtInstant(b.venceEl)) : null, b.reglaCancelacion ? fila('Cancellation rule', b.reglaCancelacion) : null,
      b.nft ? fila('NFT ticket', h('span', {}, b.nft.estado === 'error' ? 'Not sent yet' : b.nft.estado === 'enviando' ? 'Sending…' : b.nft.estado === 'jugado' ? 'Played' : 'Sent', b.nft.simulado ? ' (simulated)' : '', ' · ', abreviar(b.nft.billetera), b.nft.simulado ? null : [' · ', h('a', { href: safeHref(b.nft.urlToken), target: '_blank', rel: 'noopener noreferrer' }, 'View')])) : null,
      b.nft?.estado === 'error' ? fila('Ticket error', b.nft.error ?? '—') : null),
    sessionInfo.nft && (b.nft?.estado === 'error' || (b.estado === 'confirmed' && !b.nft)) ? h('div', { class: 'pila--chica' }, h('button', { class: 'btn btn-secundario', type: 'button', onclick: async () => {
      try { await api('POST', `/reservas/${b.id}/nft/reintentar`, {}); v.cerrar(); if (alCambiar) await alCambiar(); } catch (err) { setChildren(mensaje, errorAviso(err)); }
    } }, 'Retry the NFT ticket')) : null,
    activa ? h('div', { class: 'pila' }, h('h3', {}, 'Cancel this booking'), h('div', { class: 'campo' }, h('label', {}, 'Reason (the customer is told)'), motivo),
      opcion('Following the policy', d.cancelarSegunPolitica, b.estado === 'held' ? 'Cancel (not paid yet)' : 'Cancel following the policy', 'politica', false),
      b.estado === 'confirmed' ? opcion('The venue cancels: full refund', d.cancelarDevolviendoTodo, 'Cancel and refund the whole deposit', 'total', true) : null, mensaje) : null,
    d.decisiones.length ? h('div', { class: 'pila--chica' }, h('h3', {}, 'What the agent decided about this booking'), h('ul', { class: 'lista-filas' }, d.decisiones.map((x) => h('li', { class: 'fila-lista', style: undefined }, h('span', { class: 'fila-hora', 'aria-hidden': 'true' }, ''), h('span', {}, h('span', { class: 'fila-titulo' }, tituloDe({ ...x, datos: {} })), h('br'), h('span', { class: 'fila-sub' }, x.motivo)), h('span', { class: 'fila-sub' }, fmtInstant(x.fecha)))))) : null,
    h('div', { class: 'acciones' }, h('button', { class: 'btn btn-secundario', type: 'button', onclick: () => v.cerrar() }, 'Close')));
}

// --- Hoy ------------------------------------------------------------------------------------------------------------------

async function vistaHoy() {
  const [d, bl, dec] = await Promise.all([api('GET', '/hoy'), api('GET', '/bloqueos'), api('GET', '/decisiones?limite=5')]);
  const conflictos = bl.bloqueos.filter((k) => k.afectadas.length > 0);
  const dato = (etiqueta, valor, nota) => h('div', { class: 'tarjeta dato' }, h('span', { class: 'dato-etiqueta' }, etiqueta), h('span', { class: 'dato-valor' }, money(valor)), nota ? h('span', { class: 'dato-nota' }, nota) : null);
  const c = d.comprometido;
  return {
    descripcion: fmtFecha(d.fecha),
    nodos: [
      d.pendientes ? h('div', { class: 'aviso aviso-atencion', role: 'status' }, h('div', {}, h('strong', {}, `${d.pendientes} ${d.pendientes === 1 ? 'transfer is' : 'transfers are'} waiting for your decision`), h('a', { href: '#pendientes' }, 'Review'))) : null,
      conflictos.length ? h('div', { class: 'aviso aviso-atencion', role: 'status' }, h('div', {}, h('strong', {}, 'There are paid bookings inside blocks'), 'Resolve them to refund the deposits. ', h('a', { href: '#bloqueos' }, 'Go to Blocks'))) : null,
      h('div', { class: 'grilla' },
        dato('Deposits collected today', d.cobradas.total.texto, `${d.cobradas.cantidad} ${d.cobradas.cantidad === 1 ? 'payment' : 'payments'}`),
        dato('Refunds today', d.devoluciones.total.texto, `${d.devoluciones.cantidad} ${d.devoluciones.cantidad === 1 ? 'refund' : 'refunds'}`),
        dato('Agent balance', d.saldo.texto, 'In wARS, in its wallet'),
        dato('Committed', c.total.texto, `Deposits for future slots ${c.senasFuturas.texto} · retained ${c.retenido.texto} · about to go out ${c.transferenciasPorSalir.texto}. Not withdrawn.`)),
      h('section', { class: 'pila' }, h('h2', {}, 'Today\'s slots'),
        d.turnos.length === 0 ? vacio({ icon: 'calendar', titulo: 'No slots booked today', texto: 'When someone books for today, you will see it here.', accion: h('a', { class: 'btn btn-secundario', href: '#calendario' }, 'Open the calendar') })
          : h('ul', { class: 'lista-filas' }, d.turnos.map((b) => h('li', {}, filaReserva(b, () => abrirReserva(b.id, route)))))),
      h('section', { class: 'pila' }, h('div', { class: 'fila fila--separada' }, h('h2', {}, 'What the agent did last'), h('a', { href: '#decisiones' }, 'See all')),
        dec.decisiones.length === 0 ? vacio({ icon: 'doc', titulo: 'No decisions yet' }) : h('div', { class: 'pila--chica' }, dec.decisiones.map((x) => tarjetaDecision(x, { modoPrueba: sessionInfo.modo === 'mock', onReserva: (id) => abrirReserva(id, route) })))),
      h('p', { class: 'pie-seccion' }, h('span', {}, `Waitlist: ${d.listaDeEspera} ${d.listaDeEspera === 1 ? 'person' : 'people'}`), h('span', {}, `Agent wallet: ${abreviar(d.wallet)}`)),
    ],
  };
}

function filaReserva(b, alTocar) {
  const partes = b.inicioLocal.split(' ');
  const hora = partes.at(-1); const dia = partes.slice(0, -1).join(' ');
  return h('button', { class: 'fila-lista', type: 'button', onclick: alTocar, 'aria-label': `Booking ${b.id}, ${b.recurso}, ${b.inicioLocal}, ${b.cliente ?? 'customer'}` },
    h('span', { class: 'fila-hora' }, hora),
    h('span', {}, h('span', { class: 'fila-titulo' }, `${b.recurso} · ${b.cliente ?? 'Customer'}`), h('br'), h('span', { class: 'fila-sub' }, `${dia} · ${money(b.sena.texto)} · ${b.canal}`)),
    estadoEtiqueta(b.estado));
}

// --- Calendario -------------------------------------------------------------------------------------------------------------

const cal = { vista: 'dia', fecha: null };

async function vistaCalendario() {
  const q = new URLSearchParams({ vista: cal.vista, ...(cal.fecha ? { fecha: cal.fecha } : {}) });
  const data = await api('GET', `/calendario?${q}`);
  cal.fecha = data.fecha;
  const ir = (f) => { cal.fecha = f; route(); };
  const herramientas = h('div', { class: 'barra-herramientas' },
    h('div', { class: 'segmentado', role: 'group', 'aria-label': 'View' },
      h('button', { type: 'button', 'aria-pressed': String(cal.vista === 'dia'), onclick: () => { cal.vista = 'dia'; route(); } }, 'Day'),
      h('button', { type: 'button', 'aria-pressed': String(cal.vista === 'semana'), onclick: () => { cal.vista = 'semana'; route(); } }, 'Week')),
    h('div', { class: 'grupo' },
      h('button', { class: 'btn btn-secundario btn-icono', type: 'button', 'aria-label': cal.vista === 'dia' ? 'Previous day' : 'Previous week', onclick: () => ir(data.anterior) }, icono('arrow-left')),
      h('button', { class: 'btn btn-secundario', type: 'button', onclick: () => ir(data.hoy) }, 'Today'),
      h('button', { class: 'btn btn-secundario btn-icono', type: 'button', 'aria-label': cal.vista === 'dia' ? 'Next day' : 'Next week', onclick: () => ir(data.siguiente) }, icono('chevron'))),
    h('input', { class: 'input', type: 'date', value: data.fecha, 'aria-label': 'Go to date', onchange: (e) => { if (e.target.value) ir(e.target.value); } }));
  const leyenda = h('div', { class: 'fila', role: 'list', 'aria-label': 'Legend' }, Object.entries(CAL_TEXTOS).map(([k, t]) => h('span', { class: `estado ${CAL_CLASES[k]}`, role: 'listitem' }, t)));
  const cualquiera = (t) => (t.reserva ? (t.reserva.cliente ?? 'Customer') : t.bloqueo ? t.bloqueo.motivo : '');
  const celda = (t, recurso, fecha, conHora) => h('button', {
    type: 'button', class: `cal-celda ${CAL_CLASES[t.estado]}`, title: `${recurso} · ${t.hora} · ${CAL_TEXTOS[t.estado]}`,
    'aria-label': `${recurso}, ${t.hora}, ${CAL_TEXTOS[t.estado]}${cualquiera(t) ? `, ${cualquiera(t)}` : ''}`, onclick: () => abrirCelda(t, recurso, fecha),
  }, conHora ? t.hora : CAL_TEXTOS[t.estado], h('small', {}, conHora ? `${CAL_TEXTOS[t.estado]}${cualquiera(t) ? ` · ${cualquiera(t)}` : ''}` : cualquiera(t)));

  let cuerpo;
  if (cal.vista === 'dia') {
    const dia = data.dias[0];
    cuerpo = dia.recursos.map((r) => h('section', { class: 'tarjeta pila' }, h('h2', {}, `${r.nombre}${r.activa ? '' : ' (inactive)'}`),
      r.turnos.length === 0 ? h('p', { class: 'apagado' }, 'No slots this day on this court.') : h('div', { class: 'cal-grilla' }, r.turnos.map((t) => celda(t, r.nombre, dia.fecha, true)))));
  } else {
    const nombres = [...new Set(data.dias.flatMap((d) => d.recursos.map((r) => r.nombre)))];
    cuerpo = nombres.map((nombre) => {
      const horas = [...new Set(data.dias.flatMap((d) => d.recursos.find((r) => r.nombre === nombre)?.turnos.map((t) => t.hora) ?? []))].sort();
      return h('section', { class: 'pila' }, h('h2', {}, nombre), h('div', { class: 'tabla-caja' }, h('table', { class: 'cal-semana' },
        h('thead', {}, h('tr', {}, h('th', { class: 'hora', scope: 'col' }, h('span', { class: 'solo-lectores' }, 'Time')), data.dias.map((d) => {
          const p = partesDia(d.fecha);
          return h('th', { scope: 'col', class: d.fecha === data.hoy ? 'cal-hoy' : '' }, `${p.semana} ${p.numero}`);
        }))),
        h('tbody', {}, horas.length === 0 ? h('tr', {}, h('td', { colspan: '8' }, 'No slots this week.'))
          : horas.map((hora) => h('tr', {}, h('th', { class: 'hora', scope: 'row' }, hora), data.dias.map((d) => {
            const t = d.recursos.find((r) => r.nombre === nombre)?.turnos.find((x) => x.hora === hora);
            return h('td', {}, t ? celda(t, nombre, d.fecha, false) : null);
          })))))));
    });
  }
  return {
    descripcion: cal.vista === 'dia' ? data.dias[0].etiqueta : `Week of ${fmtFecha(data.desde)}`,
    nodos: [herramientas, leyenda, ...cuerpo],
  };
}

function abrirCelda(t, recurso, fecha) {
  if (t.reserva) { abrirReserva(t.reserva.id, route); return; }
  const mensaje = h('div', { 'aria-live': 'polite' });
  if (t.bloqueo) {
    const v = abrirVentana(h('h2', {}, `${recurso} · ${t.hora}`), aviso('atencion', h('strong', {}, 'Slot blocked'), t.bloqueo.motivo), mensaje,
      h('div', { class: 'acciones' }, h('button', { class: 'btn btn-secundario', type: 'button', onclick: () => v.cerrar() }, 'Close'),
        h('button', { class: 'btn btn-primario', type: 'button', onclick: async () => {
          try { await api('DELETE', `/bloqueos/${t.bloqueo.id}`); v.cerrar(); route(); } catch (err) { setChildren(mensaje, errorAviso(err)); }
        } }, 'Remove the block')));
    return;
  }
  const motivo = h('input', { type: 'text', class: 'input', maxlength: '120', placeholder: 'E.g.: class, maintenance', id: 'motivo-turno' });
  const v = abrirVentana(h('h2', {}, `${recurso} · ${t.hora}`), h('p', { class: 'apagado' }, `${fmtFecha(fecha)}. This slot is free.`),
    h('div', { class: 'campo' }, h('label', { for: 'motivo-turno' }, 'Block this slot'), motivo, h('span', { class: 'ayuda' }, 'Customers can see the reason.')), mensaje,
    h('div', { class: 'acciones' }, h('button', { class: 'btn btn-secundario', type: 'button', onclick: () => v.cerrar() }, 'Close'),
      h('button', { class: 'btn btn-primario', type: 'button', onclick: async () => {
        try { await api('POST', '/bloqueos', { tipo: 'turno', recurso, fecha, hora: t.hora, motivo: motivo.value }); v.cerrar(); route(); } catch (err) { setChildren(mensaje, errorAviso(err)); }
      } }, 'Block slot')));
}

// --- Reservas --------------------------------------------------------------------------------------------------------------

const filtrosReservas = { estado: '', fecha: '', q: '' };

async function vistaReservas() {
  const lista = h('div', { 'aria-live': 'polite' });
  const estado = h('select', { class: 'seleccion', 'aria-label': 'Status' }, ESTADOS_FILTRO.map(([k, v]) => h('option', { value: k, selected: filtrosReservas.estado === k }, v)));
  const fecha = h('input', { class: 'input', type: 'date', value: filtrosReservas.fecha, 'aria-label': 'Slot day' });
  const q = h('input', { class: 'input', type: 'search', value: filtrosReservas.q, placeholder: 'Search by name, contact or code', 'aria-label': 'Search' });
  const cargar = async () => {
    Object.assign(filtrosReservas, { estado: estado.value, fecha: fecha.value, q: q.value });
    setChildren(lista, esqueletos());
    try {
      const { reservas } = await api('GET', `/reservas?${new URLSearchParams(Object.entries(filtrosReservas).filter(([, v]) => v))}`);
      setChildren(lista, reservas.length === 0
        ? vacio({ icon: 'search', titulo: 'No bookings match those filters', texto: 'Try another status or clear the date.', accion: h('button', { class: 'btn btn-secundario', type: 'button', onclick: () => { Object.assign(filtrosReservas, { estado: '', fecha: '', q: '' }); route(); } }, 'Clear filters') })
        : [h('p', { class: 'apagado', role: 'status' }, `${reservas.length} ${reservas.length === 1 ? 'booking' : 'bookings'}`), h('ul', { class: 'lista-filas' }, reservas.map((b) => h('li', {}, filaReserva(b, () => abrirReserva(b.id, cargar)))))]);
    } catch (err) { setChildren(lista, errorAviso(err, cargar)); }
  };
  estado.addEventListener('change', cargar); fecha.addEventListener('change', cargar);
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') cargar(); });
  return {
    descripcion: 'All bookings with their status. Tap one to see the details or cancel it.',
    nodos: [h('div', { class: 'barra-herramientas' }, estado, fecha, q, h('button', { class: 'btn btn-primario', type: 'button', onclick: cargar }, icono('search'), 'Search')), lista],
    despues: cargar,
  };
}

// --- Pendientes -------------------------------------------------------------------------------------------------------------

async function vistaPendientes() {
  const { transferencias } = await api('GET', '/pendientes');
  if (transferencias.length === 0) {
    return { descripcion: 'Refunds and withdrawals waiting for your decision.', nodos: [vacio({ icon: 'ok', titulo: 'All caught up', texto: 'No refunds or withdrawals are waiting for your approval. When one goes over an agent limit, it shows up here.' })] };
  }
  return {
    descripcion: 'These transfers went over an agent limit or failed. They are not sent until you approve them.',
    nodos: transferencias.map((t) => {
      const mensaje = h('div', { 'aria-live': 'polite' });
      const accion = (cual) => async () => {
        const aprobar = cual === 'aprobar';
        if (!(await confirmar({ titulo: aprobar ? `Approve ${money(t.monto.texto)}?` : 'Reject this transfer?', texto: aprobar ? `${money(t.monto.texto)} in wARS will be sent to ${abreviar(t.destino)}. This cannot be undone.` : 'Nothing will be sent.', ok: aprobar ? 'Yes, approve' : 'Yes, reject', peligro: !aprobar }))) return;
        try { await api('POST', `/transferencias/${t.id}/${cual}`, {}); recargarCon(aviso('ok', aprobar ? 'Transfer approved: the agent is sending it now.' : 'Transfer rejected: nothing is sent.')); } catch (err) { setChildren(mensaje, errorAviso(err)); }
      };
      return h('section', { class: 'tarjeta pila' },
        h('div', { class: 'fila fila--separada' }, h('h2', {}, `#${t.id} · ${t.tipo}`), h('span', { class: `estado ${t.puedeAprobar ? 'es-esperando' : 'es-cancelada'}` }, t.puedeAprobar ? 'Needs your OK' : 'Under review')),
        h('p', { class: 'dato-valor num' }, money(t.monto.texto)),
        h('dl', { class: 'resumen' }, fila('Destination', h('span', { class: 'mono' }, t.destino)), t.reserva ? fila('Booking', t.reserva) : null, t.nota ? fila('Reason', t.nota) : null, t.error ? fila('Error', t.error) : null),
        mensaje,
        t.puedeAprobar ? h('div', { class: 'acciones' }, h('button', { class: 'btn btn-primario', type: 'button', onclick: accion('aprobar') }, 'Approve'), h('button', { class: 'btn btn-peligro-suave', type: 'button', onclick: accion('rechazar') }, 'Reject'))
          : aviso('atencion', 'This transfer may already have gone out. Check it in the explorer before doing anything: it cannot be approved from here.'));
    }),
  };
}

// --- Bloqueos -----------------------------------------------------------------------------------------------------------------

async function vistaBloqueos() {
  const data = await api('GET', '/bloqueos');
  const tipo = h('select', { class: 'seleccion', id: 'b-tipo' }, h('option', { value: 'dia' }, 'A whole day (all courts)'), h('option', { value: 'recurso' }, 'One court (one or more days)'), h('option', { value: 'turno' }, 'One slot'));
  const recurso = h('select', { class: 'seleccion', id: 'b-recurso' }, data.recursos.map((r) => h('option', { value: r }, r)));
  const desde = h('input', { class: 'input', type: 'date', id: 'b-desde', value: data.hoy });
  const hasta = h('input', { class: 'input', type: 'date', id: 'b-hasta' });
  const hora = h('input', { class: 'input', type: 'time', id: 'b-hora' });
  const motivo = h('input', { class: 'input', type: 'text', id: 'b-motivo', maxlength: '120', placeholder: 'E.g.: public holiday, maintenance' });
  const mensaje = h('div', { 'aria-live': 'polite' });
  const campo = (id, label, el, ayuda) => h('div', { class: 'campo' }, h('label', { for: id }, label), el, ayuda ? h('span', { class: 'ayuda' }, ayuda) : null);
  const cRecurso = campo('b-recurso', 'Court', recurso);
  const cHasta = campo('b-hasta', 'Until (optional, if it lasts several days)', hasta);
  const cHora = campo('b-hora', 'Slot time', hora);
  const sync = () => { cRecurso.hidden = tipo.value === 'dia'; cHasta.hidden = tipo.value === 'turno'; cHora.hidden = tipo.value !== 'turno'; };
  tipo.addEventListener('change', sync); sync();
  const crear = h('form', { class: 'tarjeta pila', novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    const body = { tipo: tipo.value, fecha: desde.value, motivo: motivo.value };
    if (tipo.value !== 'dia') body.recurso = recurso.value;
    if (tipo.value !== 'turno' && hasta.value) body.hasta = hasta.value;
    if (tipo.value === 'turno') body.hora = hora.value;
    try { await api('POST', '/bloqueos', body); recargarCon(aviso('ok', 'Block created. Customers no longer see those slots.')); } catch (err) { setChildren(mensaje, errorAviso(err)); }
  } }, h('h2', {}, 'New block'), campo('b-tipo', 'What to block', tipo), cRecurso, campo('b-desde', 'From', desde), cHasta, cHora,
  campo('b-motivo', 'Reason', motivo, 'Customers see it when they try to book.'), mensaje, h('button', { class: 'btn btn-primario btn-grande', type: 'submit' }, 'Block'));

  const tarjetas = data.bloqueos.map((k) => {
    const cardMsg = h('div', { 'aria-live': 'polite' });
    return h('section', { class: 'tarjeta pila' },
      h('div', { class: 'fila fila--separada' }, h('h3', {}, `${TIPO_BLOQUEO[k.tipo] ?? k.tipo}${k.recurso ? ` · ${k.recurso}` : ''}`), h('span', { class: 'estado es-bloqueada' }, 'Blocked')),
      h('dl', { class: 'resumen' }, fila('When', k.desdeLocal === k.hastaLocal ? k.desdeLocal : `${k.desdeLocal} → ${k.hastaLocal}`), fila('Reason', k.motivo)),
      k.afectadas.length ? aviso('atencion', h('strong', {}, `${k.afectadas.length} ${k.afectadas.length === 1 ? 'booking is' : 'bookings are'} inside this block`),
        h('ul', {}, k.afectadas.map((b) => h('li', {}, `${b.inicioLocal} · ${b.recurso} · ${b.cliente ?? 'Customer'} · ${money(b.sena.texto)}`))),
        h('p', {}, 'You can cancel them and refund the whole deposit. It goes through the agent (with its limits) and is logged in Decisions.')) : null,
      cardMsg,
      h('div', { class: 'acciones' },
        k.afectadas.length ? h('button', { class: 'btn btn-peligro', type: 'button', onclick: async () => {
          if (!(await confirmar({ titulo: `Cancel ${k.afectadas.length} ${k.afectadas.length === 1 ? 'booking' : 'bookings'}?`, texto: 'Each customer gets the whole deposit back. If any goes over an agent limit, it waits in Pending for your approval.', ok: 'Yes, cancel and refund', peligro: true }))) return;
          try {
            const r = await api('POST', `/bloqueos/${k.id}/cancelar-reservas`, {});
            recargarCon(aviso('ok', h('strong', {}, 'Done.'), h('ul', {}, r.resultados.map((x) => h('li', {}, `${x.id}: ${x.ok ? `cancelled, refund ${money(x.devolucion)}` : x.motivo}`)))));
          } catch (err) { setChildren(cardMsg, errorAviso(err)); }
        } }, 'Cancel those bookings and refund everything') : null,
        h('button', { class: 'btn btn-secundario', type: 'button', onclick: async () => {
          try { await api('DELETE', `/bloqueos/${k.id}`); recargarCon(aviso('ok', 'Block removed: those slots are available again.')); } catch (err) { setChildren(cardMsg, errorAviso(err)); }
        } }, 'Remove the block')));
  });
  return {
    descripcion: 'Public holidays, maintenance or a single slot. Customers see the reason and cannot book those slots.',
    nodos: [tarjetas.length ? h('section', { class: 'pila' }, h('h2', {}, 'Active blocks'), tarjetas) : vacio({ icon: 'lock', titulo: 'No blocks', texto: 'All slots are available to book.' }), crear],
  };
}

// --- Decisiones ----------------------------------------------------------------------------------------------------------------

async function vistaDecisiones() {
  const { decisiones } = await api('GET', '/decisiones?limite=200');
  let grupo = '';
  const filtro = h('input', { class: 'input', type: 'search', placeholder: 'Search by rule, code or text', 'aria-label': 'Search decisions' });
  const chips = h('div', { class: 'pestanas', role: 'group', 'aria-label': 'Filter by type' });
  const lista = h('div', { 'aria-live': 'polite' });
  const dibujar = () => {
    const t = filtro.value.trim().toLowerCase();
    const filas = decisiones.filter((d) => (!grupo || grupoDe(d) === grupo) && (!t || `${d.regla} ${d.motivo} ${d.reserva ?? ''} ${tituloDe(d)}`.toLowerCase().includes(t)));
    setChildren(chips, GRUPOS.map(([id, label]) => h('button', { class: 'pestana', type: 'button', 'aria-pressed': String(grupo === id), onclick: () => { grupo = id; dibujar(); } }, label)));
    setChildren(lista, filas.length === 0 ? vacio({ icon: 'search', titulo: 'No decisions match that filter' })
      : agruparPorDia(filas).map((g) => h('section', {}, h('h2', { class: 'dia-grupo' }, g.etiqueta), h('div', { class: 'pila--chica' }, g.items.map((d) => tarjetaDecision(d, { modoPrueba: sessionInfo.modo === 'mock', onReserva: (id) => abrirReserva(id, route) }))))));
  };
  filtro.addEventListener('input', dibujar);
  dibujar();
  return { descripcion: 'Everything the agent did, with the rule it applied. The same log, without personal data, is public at /decisiones.', nodos: [filtro, chips, lista] };
}

// --- Configuración ---------------------------------------------------------------------------------------------------------------

const getPath = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);
const setPath = (obj, path, value) => { const k = path.split('.'); const last = k.pop(); k.reduce((o, x) => (o[x] ??= {}), obj)[last] = value; };
const parseHoras = (t) => t.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);

async function vistaConfig() {
  const data = await api('GET', '/config');
  const cfg = data.config;
  const draft = structuredClone(cfg);
  const cajas = new Map(); // campo -> { input, error }
  const items = cfg.recursosLista.map((r) => ({ ...r, anterior: r.nombre, dias: diasDe(cfg.horariosRecurso[r.nombre]) }));
  const semana = diasDe(cfg.horariosSemana);
  let base = cfg.horarios.join(', ');
  let alcance = '';
  const resumenErrores = h('div', { 'aria-live': 'assertive' });

  function diasDe(mapa) {
    const out = {};
    for (let i = 0; i < 7; i++) { const l = mapa?.[String(i)]; out[i] = { cerrado: Array.isArray(l) && l.length === 0, texto: Array.isArray(l) && l.length ? l.join(', ') : '' }; }
    return out;
  }
  const compilar = (dias) => {
    const out = {};
    for (let i = 0; i < 7; i++) { if (dias[i].cerrado) out[String(i)] = []; else if (dias[i].texto.trim()) out[String(i)] = parseHoras(dias[i].texto); }
    return out;
  };
  const marcar = () => {
    if (hayCambiosSinGuardar) return;
    hayCambiosSinGuardar = true;
    setChildren($('#barra-guardar-caja'), h('div', { class: 'barra-guardar', role: 'region', 'aria-label': 'Save changes' }, h('div', { class: 'barra-guardar-in' },
      h('p', {}, 'You have unsaved changes'), h('button', { class: 'btn btn-secundario', type: 'button', onclick: descartar }, 'Discard'), h('button', { class: 'btn btn-primario', type: 'button', id: 'guardar', onclick: guardar }, 'Save changes'))));
  };
  const descartar = () => { hayCambiosSinGuardar = false; setChildren($('#barra-guardar-caja')); route(); };

  const campo = (label, path, { tipo = 'number', ayuda, extra } = {}) => {
    const r = data.rangos[path];
    const id = `c-${path.replace(/\./g, '-')}`;
    const input = h(tipo === 'textarea' ? 'textarea' : 'input', {
      class: tipo === 'textarea' ? 'area' : 'input', ...(tipo === 'textarea' ? { rows: '3', maxlength: '500' } : { type: tipo }), id, value: String(getPath(draft, path) ?? ''),
      ...(tipo === 'number' ? { min: r?.min, max: r?.max, step: '1', inputmode: 'numeric' } : {}),
      oninput: (e) => { setPath(draft, path, e.target.value); input.removeAttribute('aria-invalid'); marcar(); extra?.(); },
    });
    const error = h('div', { id: `${id}-error` });
    input.setAttribute('aria-describedby', `${id}-error`);
    cajas.set(path, { input, error });
    const rango = r ? `Between ${r.min.toLocaleString('en-US')} and ${r.max.toLocaleString('en-US')} ${r.unit}.` : null;
    return h('div', { class: 'campo' }, h('label', { for: id }, label), input, error, (ayuda || rango) ? h('span', { class: 'ayuda' }, [ayuda, rango].filter(Boolean).join(' ')) : null);
  };
  const tilde = (label, path) => h('label', { class: 'marca-check' }, h('input', { type: 'checkbox', checked: Boolean(getPath(draft, path)), onchange: (e) => { setPath(draft, path, e.target.checked); marcar(); previewPolitica(); } }), label);

  // Canchas
  const cajaCanchas = h('div', { class: 'pila--chica' });
  const selector = h('select', { class: 'seleccion', id: 'h-alcance', onchange: (e) => { alcance = e.target.value; dibujarDias(); } });
  const dibujarCanchas = () => {
    setChildren(cajaCanchas, items.map((r, i) => h('div', { class: 'fila fila--nowrap' },
      h('input', { class: 'input', type: 'text', value: r.nombre, maxlength: '40', 'aria-label': `Name of court ${i + 1}`, oninput: (e) => { r.nombre = e.target.value; marcar(); dibujarAlcances(); } }),
      h('label', { class: 'marca-check' }, h('input', { type: 'checkbox', checked: r.activo, onchange: (e) => { r.activo = e.target.checked; marcar(); } }), 'Active'))),
    h('div', { class: 'acciones' }, h('button', { class: 'btn btn-secundario', type: 'button', onclick: () => { items.push({ nombre: `Court ${items.length + 1}`, activo: true, anterior: null, dias: diasDe({}) }); marcar(); dibujarCanchas(); dibujarAlcances(); } }, icono('plus'), 'Add court')),
    h('p', { class: 'ayuda' }, 'Courts are not deleted: they are deactivated. If you rename one, existing bookings follow the new name.'));
  };
  const dibujarAlcances = () => setChildren(selector, h('option', { value: '' }, 'All courts'), items.map((r, i) => h('option', { value: String(i), selected: alcance === String(i) }, r.nombre || `Court ${i + 1}`)));
  const cajaDias = h('div', { class: 'pila--chica' });
  const dibujarDias = () => {
    const dias = alcance === '' ? semana : items[Number(alcance)].dias;
    setChildren(cajaDias, data.dias.map((nombre, i) => h('div', { class: 'fila fila--nowrap' },
      h('span', { style: undefined, class: 'etiqueta', 'aria-hidden': 'true' }, nombre.slice(0, 3)),
      h('label', { class: 'marca-check' }, h('input', { type: 'checkbox', checked: dias[i].cerrado, onchange: (e) => { dias[i].cerrado = e.target.checked; marcar(); dibujarDias(); } }), 'Closed'),
      h('input', { class: 'input', type: 'text', value: dias[i].texto, disabled: dias[i].cerrado, placeholder: alcance === '' ? 'Base times' : 'Same as all courts', 'aria-label': `Times for ${nombre}`, oninput: (e) => { dias[i].texto = e.target.value; marcar(); } }))));
  };

  // Seña y política: se explican en palabras mientras se editan
  const cartelSena = h('div', { class: 'texto-politica', 'aria-live': 'polite' });
  const cartelPolitica = h('div', { class: 'texto-politica', 'aria-live': 'polite' });
  const previewSena = () => {
    const p = Number(draft.precioTurnoArs); const s = Number(draft.senaPorcentaje);
    setChildren(cartelSena, Number.isFinite(p) && Number.isFinite(s) ? [h('strong', {}, `Deposit for each new slot: $ ${Math.floor((p * s) / 100).toLocaleString('en-US')}`), `The customer pays ${s}% of $ ${p.toLocaleString('en-US')}.`] : '');
  };
  const previewPolitica = () => {
    const pol = draft.politica;
    setChildren(cartelPolitica, [h('strong', {}, 'How it applies today'),
      `Cancelling ${pol.devolucionTotalHorasAntes} h or more ahead: the whole deposit is refunded. Between ${pol.devolucionParcialHorasAntes} and ${pol.devolucionTotalHorasAntes} h: ${pol.devolucionParcialPorcentaje}% is refunded. Under ${pol.devolucionParcialHorasAntes} h: the deposit is kept${pol.devolverSiSeRevende ? ', and if the slot is resold it is refunded' : ''}.`]);
  };

  function armarCambios() {
    return {
      nombre: draft.nombre, descripcion: draft.descripcion,
      recursosLista: items.map((r) => ({ nombre: r.nombre, activo: r.activo, ...(r.anterior ? { anterior: r.anterior } : {}) })),
      horarios: parseHoras(base), horariosSemana: compilar(semana),
      horariosRecurso: Object.fromEntries(items.map((r) => [r.nombre, compilar(r.dias)]).filter(([, v]) => Object.keys(v).length)),
      duracionMinutos: draft.duracionMinutos, diasAdelante: draft.diasAdelante, anticipacionMinimaMinutos: draft.anticipacionMinimaMinutos,
      precioTurnoArs: draft.precioTurnoArs, senaPorcentaje: draft.senaPorcentaje, reservaSinPagarMinutos: draft.reservaSinPagarMinutos,
      politica: draft.politica, limites: draft.limites, cierre: { hora: draft.cierre.hora },
    };
  }

  async function guardar() {
    for (const { input, error } of cajas.values()) { input.removeAttribute('aria-invalid'); setChildren(error); }
    setChildren(resumenErrores);
    const boton = $('#guardar'); boton?.setAttribute('aria-busy', 'true');
    try {
      const r = await api('PUT', '/config', { cambios: armarCambios() });
      hayCambiosSinGuardar = false; setChildren($('#barra-guardar-caja'));
      recargarCon(aviso('ok', h('strong', {}, 'Saved.'), r.cambios.length ? `Changed: ${r.cambios.join(', ')}. ` : 'There were no changes. ', 'Applies to new bookings: those already paid keep their deposit and policy.'));
    } catch (err) {
      boton?.removeAttribute('aria-busy');
      setChildren(resumenErrores, errorAviso(err));
      for (const e of err.data?.errores ?? []) {
        const c = cajas.get(e.campo);
        if (c) { c.input.setAttribute('aria-invalid', 'true'); setChildren(c.error, h('div', { class: 'error-campo' }, e.mensaje)); }
      }
      resumenErrores.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  dibujarCanchas(); dibujarAlcances(); dibujarDias(); previewSena(); previewPolitica();
  const hist = data.historial;
  const seccion = (titulo, ...hijos) => h('section', { class: 'tarjeta pila' }, h('h2', {}, titulo), hijos);
  return {
    descripcion: 'Everything changed here applies to new bookings: those already paid keep their deposit and policy.',
    nodos: [
      resumenErrores,
      seccion('The business', campo('Name', 'nombre', { tipo: 'text' }), campo('Description', 'descripcion', { tipo: 'textarea' })),
      seccion('Courts', cajaCanchas),
      seccion('Hours',
        h('div', { class: 'campo' }, h('label', { for: 'h-base' }, 'Times for every day'), h('input', { class: 'input', id: 'h-base', type: 'text', value: base, placeholder: '09:00, 10:30, 12:00', oninput: (e) => { base = e.target.value; marcar(); } }), h('span', { class: 'ayuda' }, 'HH:MM format, separated by commas. Each slot lasts as long as the duration says: times cannot overlap.')),
        h('h3', {}, 'Change a weekday or a court'), h('p', { class: 'ayuda' }, 'Leave it empty to use the times for every day. Tick "Closed" if that day is not open.'),
        h('div', { class: 'campo' }, h('label', { for: 'h-alcance' }, 'Times for'), selector), cajaDias),
      seccion('Slots and price', campo('Slot length (minutes)', 'duracionMinutos'), campo('How many days ahead can be booked', 'diasAdelante'), campo('Minimum notice (minutes)', 'anticipacionMinimaMinutos'),
        campo('Slot price (pesos)', 'precioTurnoArs', { extra: previewSena }), campo('Deposit percentage', 'senaPorcentaje', { extra: previewSena }), cartelSena, campo('Minutes to pay the deposit', 'reservaSinPagarMinutos')),
      seccion('Cancellation policy',
        campo('Hours of notice for a full refund', 'politica.devolucionTotalHorasAntes', { extra: previewPolitica }), campo('Hours of notice for a partial refund', 'politica.devolucionParcialHorasAntes', { extra: previewPolitica }),
        campo('Percentage refunded in that case', 'politica.devolucionParcialPorcentaje', { extra: previewPolitica }), tilde('If the slot is resold, refund what was kept', 'politica.devolverSiSeRevende'),
        campo('Minutes a slot is held for someone on the waitlist', 'politica.ofertaListaEsperaMinutos'), cartelPolitica),
      seccion('Agent limits', h('p', { class: 'ayuda' }, 'This is the safety net: above these limits the agent does not send money on its own, it asks for your approval.'),
        campo('Maximum automatic refund (pesos)', 'limites.devolucionMaxAutomaticaArs', { ayuda: 'Above this, it asks for your approval.' }), campo('Refunds per day (pesos)', 'limites.devolucionesMaxDiariasArs'),
        campo('Maximum per transfer (pesos)', 'limites.transferenciaMaxArs'), campo('Daily close time', 'cierre.hora', { tipo: 'time' })),
      seccion('Only changed in the .env file', h('p', { class: 'ayuda' }, 'For safety, this cannot be edited from the dashboard.'),
        h('dl', { class: 'resumen' }, fila('Mode', data.soloLectura.modo === 'mock' ? 'Test (no real money)' : 'Live'), fila('Withdrawal address', data.soloLectura.direccionDeRetiro ?? 'Not set'), fila('Agent wallet', h('span', { class: 'mono' }, data.soloLectura.billeteraDelAgente)))),
      h('section', { class: 'pila' }, h('h2', {}, 'Change history'),
        hist.length === 0 ? h('p', { class: 'apagado' }, 'No changes yet.') : h('div', { class: 'tabla-caja' }, h('table', { class: 'tabla tabla--apilada' },
          h('caption', { class: 'solo-lectores' }, 'Settings change history'),
          h('thead', {}, h('tr', {}, ['When', 'Who', 'Field', 'Before', 'After'].map((t) => h('th', { scope: 'col' }, t)))),
          h('tbody', {}, hist.map((r) => h('tr', { class: 'item-historial' }, h('td', { 'data-label': 'When' }, fmtInstant(r.fecha)), h('td', { 'data-label': 'Who' }, r.quien), h('td', { 'data-label': 'Field' }, r.campo), h('td', { 'data-label': 'Before' }, corto(r.antes)), h('td', { 'data-label': 'After' }, corto(r.despues)))))))),
    ],
  };
}

function corto(v) {
  if (v === null || v === undefined) return '—';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 90 ? `${s.slice(0, 90)}…` : s;
}

// --- Cierre del día ------------------------------------------------------------------------------------------------------------

async function vistaCierre() {
  const { ultimo } = await api('GET', '/cierre');
  const mensaje = h('div', { 'aria-live': 'polite' });
  return {
    descripcion: 'The close summarises the day and passes the owner whatever is no longer committed to future slots. It runs by itself at the time you set.',
    nodos: [
      ultimo ? h('section', { class: 'pila' }, h('h2', {}, `Last close: ${fmtFecha(ultimo.dia)}`), h('p', { class: 'apagado' }, `Done on ${fmtInstant(ultimo.fecha)}`), h('pre', { class: 'reporte' }, ultimo.reporte))
        : vacio({ icon: 'wallet', titulo: 'No close has run yet', texto: 'The first one runs by itself at the set time, or you can request it now.' }),
      mensaje,
      h('div', { class: 'tarjeta pila' }, h('h2', {}, 'Request a close now'), h('p', { class: 'apagado' }, 'If there is free money, a withdrawal is prepared to the owner\'s address (the one in the .env). The withdrawal never touches deposits for future slots.'),
        h('button', { class: 'btn btn-primario', type: 'button', onclick: async () => {
          if (!(await confirmar({ titulo: 'Run the close now?', texto: 'The day is summarised and, if there is free money, a withdrawal to the owner is prepared.', ok: 'Yes, run the close' }))) return;
          try { await api('POST', '/cierre', {}); recargarCon(aviso('ok', 'Close done. The report is below.')); } catch (err) { setChildren(mensaje, errorAviso(err)); }
        } }, 'Request a close now')),
    ],
  };
}

const VISTAS = { hoy: vistaHoy, calendario: vistaCalendario, reservas: vistaReservas, pendientes: vistaPendientes, bloqueos: vistaBloqueos, decisiones: vistaDecisiones, config: vistaConfig, cierre: vistaCierre };

iniciar().catch((err) => setChildren(app, h('main', { class: 'contenedor', id: 'contenido' }, errorAviso(err, iniciar))));
