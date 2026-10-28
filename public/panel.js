// Panel del comercio. Móvil primero: menú inferior en celular y barra superior en pantallas grandes.
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

const PRINCIPALES = [['hoy', 'Hoy', 'home'], ['calendario', 'Calendario', 'calendar'], ['reservas', 'Reservas', 'list'], ['pendientes', 'Pendientes', 'bell']];
const MAS = [['bloqueos', 'Bloqueos', 'lock'], ['decisiones', 'Decisiones del agente', 'doc'], ['config', 'Configuración', 'sliders'], ['cierre', 'Cierre del día', 'wallet']];
const TITULOS = {
  hoy: 'Hoy', calendario: 'Calendario', reservas: 'Reservas', pendientes: 'Pendientes', bloqueos: 'Bloqueos', decisiones: 'Decisiones del agente', config: 'Configuración', cierre: 'Cierre del día',
};
const ESTADOS_FILTRO = [['', 'Todos los estados'], ['held', 'Esperando pago'], ['confirmed', 'Confirmadas'], ['cancelled', 'Canceladas'], ['expired', 'Vencidas'], ['completed', 'Jugadas']];
const CAL_CLASES = { libre: 'es-libre', esperando_pago: 'es-esperando', confirmado: 'es-confirmada', bloqueado: 'es-bloqueada' };
const CAL_TEXTOS = { libre: 'Libre', esperando_pago: 'Esperando pago', confirmado: 'Confirmada', bloqueado: 'Bloqueado' };
const TIPO_BLOQUEO = { turno: 'Un turno', recurso: 'Una cancha', dia: 'Todo el día' };

// --- Pedidos ------------------------------------------------------------------------------------------------

async function api(method, path, body) {
  try {
    return await request(method, `/panel/api${path}`, body, method !== 'GET' && csrf ? { 'x-csrf-token': csrf } : {});
  } catch (err) {
    if (err.status === 401 && err.data?.codigo === 'sin_sesion') { csrf = null; hayCambiosSinGuardar = false; mostrarIngreso('Tu sesión terminó. Ingresá de nuevo.'); }
    throw err;
  }
}
const mensajeDe = (err) => (err.status ? err.message : 'No pudimos conectarnos. Revisá tu conexión y probá de nuevo.');
const errorAviso = (err, reintentar) => aviso('error', h('strong', {}, err.data?.errores?.length ? err.message : 'Algo salió mal'), err.data?.errores?.length ? '' : mensajeDe(err),
  err.data?.errores?.length ? h('ul', {}, err.data.errores.map((e) => h('li', {}, e.mensaje))) : null,
  reintentar ? h('div', { class: 'acciones' }, h('button', { class: 'btn btn-secundario', type: 'button', onclick: reintentar }, 'Probar de nuevo')) : null);
const money = (m) => String(m).replace('$ ', '$ ');
const txLink = (tx) => (isTxHash(tx) && sessionInfo?.modo !== 'mock'
  ? h('a', { href: safeHref(`https://celoscan.io/tx/${tx}`), target: '_blank', rel: 'noopener noreferrer' }, 'Ver en Celoscan')
  : (tx ? h('span', { class: 'apagado' }, 'Transacción simulada') : null));
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
function confirmar({ titulo, texto, ok = 'Confirmar', peligro = false, cancelar = 'Volver' }) {
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
  const boton = h('button', { type: 'submit', class: 'btn btn-primario btn-grande btn-bloque' }, 'Ingresar');
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
  }, h('div', { class: 'campo' }, h('label', { for: 'clave' }, 'Clave del panel'), input), h('label', { class: 'marca-check' }, ver, 'Mostrar la clave'), error, boton,
  h('p', { class: 'ayuda' }, 'La clave es la que pusiste en OWNER_DASHBOARD_PASSWORD, en el archivo .env.'));
  setChildren(app, h('main', { class: 'pantalla-ingreso', id: 'contenido' }, h('div', { class: 'insignia-grande' }, icono('lock')),
    h('div', { class: 'centrado pila--chica' }, h('h1', {}, 'Panel del comercio'), h('p', { class: 'apagado' }, sessionInfo?.negocio ?? 'Seña')), form,
    h('a', { href: '/', class: 'btn btn-fantasma' }, 'Volver a la web de reservas')));
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
    setChildren(app, h('main', { class: 'pantalla-ingreso', id: 'contenido' }, h('div', { class: 'insignia-grande' }, icono('lock')), h('h1', {}, 'Panel deshabilitado'),
      h('div', { class: 'tarjeta pila' }, aviso('atencion', sessionInfo.mensaje), h('p', { class: 'apagado' }, 'Poné una clave de al menos 8 caracteres en OWNER_DASHBOARD_PASSWORD y reiniciá el servidor.'))));
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
      h('a', { class: 'marca', href: '#hoy' }, h('span', { class: 'marca-logo' }, icono('check')), 'Seña', h('span', { class: 'apagado', style: undefined }, ' · Panel')),
      h('span', { class: 'nombre-comercio apagado solo-escritorio' }, sessionInfo.negocio),
      h('button', { class: 'btn btn-secundario btn-chico al-final', type: 'button', onclick: salir }, 'Salir'))),
    h('div', { class: 'panel-layout' },
      h('nav', { class: 'lateral', 'aria-label': 'Secciones del panel' }, h('h2', {}, 'Día a día'), PRINCIPALES.map(enlace), h('h2', {}, 'Administrar'), MAS.map(enlace),
        h('a', { class: 'nav-link', href: '/', target: '_blank', rel: 'noopener' }, icono('external'), 'Ver la web de reservas')),
      h('main', { id: 'contenido', class: 'panel-contenido con-nav-inferior', tabindex: '-1' }, h('div', { id: 'vista', class: 'vista-panel pila--grande' }))),
    h('nav', { class: 'nav-inferior', 'aria-label': 'Menú del panel' }, PRINCIPALES.map(inferior),
      h('button', { type: 'button', id: 'boton-mas', onclick: abrirMas }, icono('dots'), 'Más')),
    h('div', { id: 'barra-guardar-caja' }));
  route();
}

async function salir() {
  if (hayCambiosSinGuardar && !(await confirmar({ titulo: 'Tenés cambios sin guardar', texto: 'Si salís ahora se pierden.', ok: 'Salir igual', peligro: true }))) return;
  await api('POST', '/logout', {}).catch(() => {});
  csrf = null; hayCambiosSinGuardar = false; location.hash = '';
  await iniciar();
}

function abrirMas() {
  const v = abrirVentana(h('h2', {}, 'Más opciones'),
    h('ul', { class: 'menu-lista' },
      MAS.map(([id, label, ic]) => h('li', {}, h('a', { href: `#${id}`, onclick: () => v.cerrar() }, icono(ic), label, icono('chevron')))),
      h('li', {}, h('a', { href: '/', target: '_blank', rel: 'noopener' }, icono('external'), 'Ver la web de reservas')),
      h('li', {}, h('a', { href: '/decisiones', target: '_blank', rel: 'noopener' }, icono('shield'), 'Registro público del agente')),
      h('li', {}, h('button', { type: 'button', onclick: () => { v.cerrar(); salir(); } }, icono('x'), 'Salir'))),
    h('div', { class: 'acciones' }, h('button', { class: 'btn btn-secundario', type: 'button', onclick: () => v.cerrar() }, 'Cerrar')));
}

window.addEventListener('hashchange', () => { if (csrf) route(); });

let volviendo = false;
async function route() {
  const id = Object.keys(TITULOS).includes(location.hash.slice(1)) ? location.hash.slice(1) : 'hoy';
  if (volviendo) { volviendo = false; return; }
  if (hayCambiosSinGuardar && rutaActual === 'config' && id !== 'config') {
    const salirSeguro = await confirmar({ titulo: 'Tenés cambios sin guardar', texto: 'Si cambiás de pantalla se pierden.', ok: 'Descartar cambios', peligro: true, cancelar: 'Seguir editando' });
    if (!salirSeguro) { volviendo = true; location.hash = 'config'; return; }
    hayCambiosSinGuardar = false; setChildren($('#barra-guardar-caja'));
  }
  rutaActual = id;
  document.title = `${TITULOS[id]} · Panel · Seña`;
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
    if (el) { el.textContent = String(n); el.hidden = n === 0; el.setAttribute('aria-label', `${n} pendientes`); }
  } catch { /* la insignia es un extra */ }
}

// --- Detalle de una reserva -----------------------------------------------------------------------------------------------

async function abrirReserva(id, alCambiar) {
  let d;
  try { d = await api('GET', `/reservas/${id}`); } catch (err) { abrirVentana(h('h2', {}, 'No se pudo abrir la reserva'), errorAviso(err)); return; }
  const b = d.reserva;
  const activa = b.estado === 'held' || b.estado === 'confirmed';
  const mensaje = h('div', { 'aria-live': 'polite' });
  const motivo = h('input', { type: 'text', class: 'input', maxlength: '120', placeholder: 'Ej.: lluvia, cancha en mantenimiento', 'aria-label': 'Motivo de la cancelación' });
  const cancelarCon = (devolucion, texto) => async () => {
    if (!(await confirmar({ titulo: '¿Cancelar esta reserva?', texto, ok: 'Sí, cancelar', peligro: true }))) return;
    try {
      const r = await api('POST', `/reservas/${b.id}/cancelar`, { devolucion, motivo: motivo.value });
      v.cerrar();
      if (alCambiar) await alCambiar();
      abrirVentana(h('h2', {}, 'Reserva cancelada'), aviso('ok', h('strong', {}, r.motivo), `Devolución: ${money(r.devolucion)}.`));
    } catch (err) { setChildren(mensaje, errorAviso(err)); }
  };
  const opcion = (titulo, p, boton, devolucion, peligro) => (p.ok
    ? h('div', { class: 'tarjeta tarjeta--plana pila--chica' }, h('strong', {}, titulo), h('p', {}, p.motivo), h('p', { class: 'dato-valor num' }, money(p.devolucion)),
      h('button', { class: `btn ${peligro ? 'btn-peligro' : 'btn-peligro-suave'} btn-bloque`, type: 'button', onclick: cancelarCon(devolucion, `Se devuelve ${money(p.devolucion)}. ${p.motivo}`) }, boton))
    : null);
  const v = abrirVentana(
    h('div', { class: 'fila fila--separada' }, h('h2', {}, `Reserva ${b.id}`), estadoEtiqueta(b.estado)),
    h('dl', { class: 'resumen' },
      fila('Turno', `${b.recurso} · ${b.inicioLocal}`), fila('Cliente', b.cliente ?? '—'), fila('Contacto', b.contacto ?? '—'), fila('Canal', b.canal), fila('Seña', money(b.sena.texto)),
      b.devuelto.wei !== '0' ? fila('Devuelto', money(b.devuelto.texto)) : null, b.pagador ? fila('Pagó desde', abreviar(b.pagador)) : null, b.pagoTx ? fila('Comprobante', txLink(b.pagoTx)) : null,
      b.venceEl ? fila('Vence', fmtInstant(b.venceEl)) : null, b.reglaCancelacion ? fila('Regla de cancelación', b.reglaCancelacion) : null,
      b.nft ? fila('Ticket NFT', h('span', {}, b.nft.estado === 'error' ? 'No salió todavía' : b.nft.estado === 'enviando' ? 'Enviándose…' : b.nft.estado === 'jugado' ? 'Jugado' : 'Enviado', b.nft.simulado ? ' (simulado)' : '', ' · ', abreviar(b.nft.billetera), b.nft.simulado ? null : [' · ', h('a', { href: safeHref(b.nft.urlToken), target: '_blank', rel: 'noopener noreferrer' }, 'Ver')])) : null,
      b.nft?.estado === 'error' ? fila('Error del ticket', b.nft.error ?? '—') : null),
    sessionInfo.nft && (b.nft?.estado === 'error' || (b.estado === 'confirmed' && !b.nft)) ? h('div', { class: 'pila--chica' }, h('button', { class: 'btn btn-secundario', type: 'button', onclick: async () => {
      try { await api('POST', `/reservas/${b.id}/nft/reintentar`, {}); v.cerrar(); if (alCambiar) await alCambiar(); } catch (err) { setChildren(mensaje, errorAviso(err)); }
    } }, 'Reintentar el ticket NFT')) : null,
    activa ? h('div', { class: 'pila' }, h('h3', {}, 'Cancelar esta reserva'), h('div', { class: 'campo' }, h('label', {}, 'Motivo (se le avisa al cliente)'), motivo),
      opcion('Según la política', d.cancelarSegunPolitica, b.estado === 'held' ? 'Cancelar (todavía no pagó)' : 'Cancelar según la política', 'politica', false),
      b.estado === 'confirmed' ? opcion('Cancela el comercio: devuelve todo', d.cancelarDevolviendoTodo, 'Cancelar y devolver toda la seña', 'total', true) : null, mensaje) : null,
    d.decisiones.length ? h('div', { class: 'pila--chica' }, h('h3', {}, 'Qué decidió el agente con esta reserva'), h('ul', { class: 'lista-filas' }, d.decisiones.map((x) => h('li', { class: 'fila-lista', style: undefined }, h('span', { class: 'fila-hora', 'aria-hidden': 'true' }, ''), h('span', {}, h('span', { class: 'fila-titulo' }, tituloDe({ ...x, datos: {} })), h('br'), h('span', { class: 'fila-sub' }, x.motivo)), h('span', { class: 'fila-sub' }, fmtInstant(x.fecha)))))) : null,
    h('div', { class: 'acciones' }, h('button', { class: 'btn btn-secundario', type: 'button', onclick: () => v.cerrar() }, 'Cerrar')));
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
      d.pendientes ? h('div', { class: 'aviso aviso-atencion', role: 'status' }, h('div', {}, h('strong', {}, `Hay ${d.pendientes} ${d.pendientes === 1 ? 'transferencia esperando' : 'transferencias esperando'} tu decisión`), h('a', { href: '#pendientes' }, 'Revisarlas'))) : null,
      conflictos.length ? h('div', { class: 'aviso aviso-atencion', role: 'status' }, h('div', {}, h('strong', {}, 'Hay reservas pagadas dentro de bloqueos'), 'Resolvelas para devolver las señas. ', h('a', { href: '#bloqueos' }, 'Ir a Bloqueos'))) : null,
      h('div', { class: 'grilla' },
        dato('Señas cobradas hoy', d.cobradas.total.texto, `${d.cobradas.cantidad} ${d.cobradas.cantidad === 1 ? 'cobro' : 'cobros'}`),
        dato('Devoluciones de hoy', d.devoluciones.total.texto, `${d.devoluciones.cantidad} ${d.devoluciones.cantidad === 1 ? 'devolución' : 'devoluciones'}`),
        dato('Saldo del agente', d.saldo.texto, 'En wARS, en su billetera'),
        dato('Comprometido', c.total.texto, `Señas de turnos futuros ${c.senasFuturas.texto} · retenido ${c.retenido.texto} · por salir ${c.transferenciasPorSalir.texto}. No se retira.`)),
      h('section', { class: 'pila' }, h('h2', {}, 'Turnos de hoy'),
        d.turnos.length === 0 ? vacio({ icon: 'calendar', titulo: 'Hoy no hay turnos reservados', texto: 'Cuando alguien reserve para hoy, lo vas a ver acá.', accion: h('a', { class: 'btn btn-secundario', href: '#calendario' }, 'Ver el calendario') })
          : h('ul', { class: 'lista-filas' }, d.turnos.map((b) => h('li', {}, filaReserva(b, () => abrirReserva(b.id, route)))))),
      h('section', { class: 'pila' }, h('div', { class: 'fila fila--separada' }, h('h2', {}, 'Lo último que hizo el agente'), h('a', { href: '#decisiones' }, 'Ver todo')),
        dec.decisiones.length === 0 ? vacio({ icon: 'doc', titulo: 'Todavía no hay decisiones' }) : h('div', { class: 'pila--chica' }, dec.decisiones.map((x) => tarjetaDecision(x, { modoPrueba: sessionInfo.modo === 'mock', onReserva: (id) => abrirReserva(id, route) })))),
      h('p', { class: 'pie-seccion' }, h('span', {}, `Lista de espera: ${d.listaDeEspera} ${d.listaDeEspera === 1 ? 'persona' : 'personas'}`), h('span', {}, `Billetera del agente: ${abreviar(d.wallet)}`)),
    ],
  };
}

function filaReserva(b, alTocar) {
  const partes = b.inicioLocal.split(' ');
  const hora = partes.at(-1); const dia = partes.slice(0, -1).join(' ');
  return h('button', { class: 'fila-lista', type: 'button', onclick: alTocar, 'aria-label': `Reserva ${b.id}, ${b.recurso}, ${b.inicioLocal}, ${b.cliente ?? 'cliente'}` },
    h('span', { class: 'fila-hora' }, hora),
    h('span', {}, h('span', { class: 'fila-titulo' }, `${b.recurso} · ${b.cliente ?? 'Cliente'}`), h('br'), h('span', { class: 'fila-sub' }, `${dia} · ${money(b.sena.texto)} · ${b.canal}`)),
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
    h('div', { class: 'segmentado', role: 'group', 'aria-label': 'Vista' },
      h('button', { type: 'button', 'aria-pressed': String(cal.vista === 'dia'), onclick: () => { cal.vista = 'dia'; route(); } }, 'Día'),
      h('button', { type: 'button', 'aria-pressed': String(cal.vista === 'semana'), onclick: () => { cal.vista = 'semana'; route(); } }, 'Semana')),
    h('div', { class: 'grupo' },
      h('button', { class: 'btn btn-secundario btn-icono', type: 'button', 'aria-label': cal.vista === 'dia' ? 'Día anterior' : 'Semana anterior', onclick: () => ir(data.anterior) }, icono('arrow-left')),
      h('button', { class: 'btn btn-secundario', type: 'button', onclick: () => ir(data.hoy) }, 'Hoy'),
      h('button', { class: 'btn btn-secundario btn-icono', type: 'button', 'aria-label': cal.vista === 'dia' ? 'Día siguiente' : 'Semana siguiente', onclick: () => ir(data.siguiente) }, icono('chevron'))),
    h('input', { class: 'input', type: 'date', value: data.fecha, 'aria-label': 'Ir a la fecha', onchange: (e) => { if (e.target.value) ir(e.target.value); } }));
  const leyenda = h('div', { class: 'fila', role: 'list', 'aria-label': 'Referencias' }, Object.entries(CAL_TEXTOS).map(([k, t]) => h('span', { class: `estado ${CAL_CLASES[k]}`, role: 'listitem' }, t)));
  const cualquiera = (t) => (t.reserva ? (t.reserva.cliente ?? 'Cliente') : t.bloqueo ? t.bloqueo.motivo : '');
  const celda = (t, recurso, fecha, conHora) => h('button', {
    type: 'button', class: `cal-celda ${CAL_CLASES[t.estado]}`, title: `${recurso} · ${t.hora} · ${CAL_TEXTOS[t.estado]}`,
    'aria-label': `${recurso}, ${t.hora}, ${CAL_TEXTOS[t.estado]}${cualquiera(t) ? `, ${cualquiera(t)}` : ''}`, onclick: () => abrirCelda(t, recurso, fecha),
  }, conHora ? t.hora : CAL_TEXTOS[t.estado], h('small', {}, conHora ? `${CAL_TEXTOS[t.estado]}${cualquiera(t) ? ` · ${cualquiera(t)}` : ''}` : cualquiera(t)));

  let cuerpo;
  if (cal.vista === 'dia') {
    const dia = data.dias[0];
    cuerpo = dia.recursos.map((r) => h('section', { class: 'tarjeta pila' }, h('h2', {}, `${r.nombre}${r.activa ? '' : ' (desactivada)'}`),
      r.turnos.length === 0 ? h('p', { class: 'apagado' }, 'No hay turnos este día en esta cancha.') : h('div', { class: 'cal-grilla' }, r.turnos.map((t) => celda(t, r.nombre, dia.fecha, true)))));
  } else {
    const nombres = [...new Set(data.dias.flatMap((d) => d.recursos.map((r) => r.nombre)))];
    cuerpo = nombres.map((nombre) => {
      const horas = [...new Set(data.dias.flatMap((d) => d.recursos.find((r) => r.nombre === nombre)?.turnos.map((t) => t.hora) ?? []))].sort();
      return h('section', { class: 'pila' }, h('h2', {}, nombre), h('div', { class: 'tabla-caja' }, h('table', { class: 'cal-semana' },
        h('thead', {}, h('tr', {}, h('th', { class: 'hora', scope: 'col' }, h('span', { class: 'solo-lectores' }, 'Hora')), data.dias.map((d) => {
          const p = partesDia(d.fecha);
          return h('th', { scope: 'col', class: d.fecha === data.hoy ? 'cal-hoy' : '' }, `${p.semana} ${p.numero}`);
        }))),
        h('tbody', {}, horas.length === 0 ? h('tr', {}, h('td', { colspan: '8' }, 'No hay turnos esta semana.'))
          : horas.map((hora) => h('tr', {}, h('th', { class: 'hora', scope: 'row' }, hora), data.dias.map((d) => {
            const t = d.recursos.find((r) => r.nombre === nombre)?.turnos.find((x) => x.hora === hora);
            return h('td', {}, t ? celda(t, nombre, d.fecha, false) : null);
          })))))));
    });
  }
  return {
    descripcion: cal.vista === 'dia' ? data.dias[0].etiqueta : `Semana del ${fmtFecha(data.desde)}`,
    nodos: [herramientas, leyenda, ...cuerpo],
  };
}

function abrirCelda(t, recurso, fecha) {
  if (t.reserva) { abrirReserva(t.reserva.id, route); return; }
  const mensaje = h('div', { 'aria-live': 'polite' });
  if (t.bloqueo) {
    const v = abrirVentana(h('h2', {}, `${recurso} · ${t.hora}`), aviso('atencion', h('strong', {}, 'Turno bloqueado'), t.bloqueo.motivo), mensaje,
      h('div', { class: 'acciones' }, h('button', { class: 'btn btn-secundario', type: 'button', onclick: () => v.cerrar() }, 'Cerrar'),
        h('button', { class: 'btn btn-primario', type: 'button', onclick: async () => {
          try { await api('DELETE', `/bloqueos/${t.bloqueo.id}`); v.cerrar(); route(); } catch (err) { setChildren(mensaje, errorAviso(err)); }
        } }, 'Quitar el bloqueo')));
    return;
  }
  const motivo = h('input', { type: 'text', class: 'input', maxlength: '120', placeholder: 'Ej.: clase, mantenimiento', id: 'motivo-turno' });
  const v = abrirVentana(h('h2', {}, `${recurso} · ${t.hora}`), h('p', { class: 'apagado' }, `${fmtFecha(fecha)}. Este turno está libre.`),
    h('div', { class: 'campo' }, h('label', { for: 'motivo-turno' }, 'Bloquear este turno'), motivo, h('span', { class: 'ayuda' }, 'El motivo lo ven los clientes.')), mensaje,
    h('div', { class: 'acciones' }, h('button', { class: 'btn btn-secundario', type: 'button', onclick: () => v.cerrar() }, 'Cerrar'),
      h('button', { class: 'btn btn-primario', type: 'button', onclick: async () => {
        try { await api('POST', '/bloqueos', { tipo: 'turno', recurso, fecha, hora: t.hora, motivo: motivo.value }); v.cerrar(); route(); } catch (err) { setChildren(mensaje, errorAviso(err)); }
      } }, 'Bloquear turno')));
}

// --- Reservas --------------------------------------------------------------------------------------------------------------

const filtrosReservas = { estado: '', fecha: '', q: '' };

async function vistaReservas() {
  const lista = h('div', { 'aria-live': 'polite' });
  const estado = h('select', { class: 'seleccion', 'aria-label': 'Estado' }, ESTADOS_FILTRO.map(([k, v]) => h('option', { value: k, selected: filtrosReservas.estado === k }, v)));
  const fecha = h('input', { class: 'input', type: 'date', value: filtrosReservas.fecha, 'aria-label': 'Día del turno' });
  const q = h('input', { class: 'input', type: 'search', value: filtrosReservas.q, placeholder: 'Buscar por nombre, contacto o código', 'aria-label': 'Buscar' });
  const cargar = async () => {
    Object.assign(filtrosReservas, { estado: estado.value, fecha: fecha.value, q: q.value });
    setChildren(lista, esqueletos());
    try {
      const { reservas } = await api('GET', `/reservas?${new URLSearchParams(Object.entries(filtrosReservas).filter(([, v]) => v))}`);
      setChildren(lista, reservas.length === 0
        ? vacio({ icon: 'search', titulo: 'No hay reservas con esos filtros', texto: 'Probá con otro estado o quitá la fecha.', accion: h('button', { class: 'btn btn-secundario', type: 'button', onclick: () => { Object.assign(filtrosReservas, { estado: '', fecha: '', q: '' }); route(); } }, 'Quitar filtros') })
        : [h('p', { class: 'apagado', role: 'status' }, `${reservas.length} ${reservas.length === 1 ? 'reserva' : 'reservas'}`), h('ul', { class: 'lista-filas' }, reservas.map((b) => h('li', {}, filaReserva(b, () => abrirReserva(b.id, cargar)))))]);
    } catch (err) { setChildren(lista, errorAviso(err, cargar)); }
  };
  estado.addEventListener('change', cargar); fecha.addEventListener('change', cargar);
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') cargar(); });
  return {
    descripcion: 'Todas las reservas, con su estado. Tocá una para ver el detalle o cancelarla.',
    nodos: [h('div', { class: 'barra-herramientas' }, estado, fecha, q, h('button', { class: 'btn btn-primario', type: 'button', onclick: cargar }, icono('search'), 'Buscar')), lista],
    despues: cargar,
  };
}

// --- Pendientes -------------------------------------------------------------------------------------------------------------

async function vistaPendientes() {
  const { transferencias } = await api('GET', '/pendientes');
  if (transferencias.length === 0) {
    return { descripcion: 'Devoluciones y retiros que esperan tu decisión.', nodos: [vacio({ icon: 'ok', titulo: 'Todo al día', texto: 'No hay devoluciones ni retiros esperando tu aprobación. Cuando una supere un tope del agente, aparece acá.' })] };
  }
  return {
    descripcion: 'Estas transferencias superaron un tope del agente o fallaron. No salen hasta que las apruebes.',
    nodos: transferencias.map((t) => {
      const mensaje = h('div', { 'aria-live': 'polite' });
      const accion = (cual) => async () => {
        const aprobar = cual === 'aprobar';
        if (!(await confirmar({ titulo: aprobar ? `¿Aprobar ${money(t.monto.texto)}?` : '¿Rechazar esta transferencia?', texto: aprobar ? `Se manda ${money(t.monto.texto)} en wARS a ${abreviar(t.destino)}. No se puede deshacer.` : 'No se manda nada.', ok: aprobar ? 'Sí, aprobar' : 'Sí, rechazar', peligro: !aprobar }))) return;
        try { await api('POST', `/transferencias/${t.id}/${cual}`, {}); recargarCon(aviso('ok', aprobar ? 'Transferencia aprobada: el agente la manda ahora.' : 'Transferencia rechazada: no se manda nada.')); } catch (err) { setChildren(mensaje, errorAviso(err)); }
      };
      return h('section', { class: 'tarjeta pila' },
        h('div', { class: 'fila fila--separada' }, h('h2', {}, `#${t.id} · ${t.tipo}`), h('span', { class: `estado ${t.puedeAprobar ? 'es-esperando' : 'es-cancelada'}` }, t.puedeAprobar ? 'Espera tu OK' : 'En revisión')),
        h('p', { class: 'dato-valor num' }, money(t.monto.texto)),
        h('dl', { class: 'resumen' }, fila('Destino', h('span', { class: 'mono' }, t.destino)), t.reserva ? fila('Reserva', t.reserva) : null, t.nota ? fila('Motivo', t.nota) : null, t.error ? fila('Error', t.error) : null),
        mensaje,
        t.puedeAprobar ? h('div', { class: 'acciones' }, h('button', { class: 'btn btn-primario', type: 'button', onclick: accion('aprobar') }, 'Aprobar'), h('button', { class: 'btn btn-peligro-suave', type: 'button', onclick: accion('rechazar') }, 'Rechazar'))
          : aviso('atencion', 'Esta transferencia pudo haber salido. Revisala en el explorador antes de hacer nada: no se puede aprobar desde acá.'));
    }),
  };
}

// --- Bloqueos -----------------------------------------------------------------------------------------------------------------

async function vistaBloqueos() {
  const data = await api('GET', '/bloqueos');
  const tipo = h('select', { class: 'seleccion', id: 'b-tipo' }, h('option', { value: 'dia' }, 'Un día entero (todas las canchas)'), h('option', { value: 'recurso' }, 'Una cancha (uno o varios días)'), h('option', { value: 'turno' }, 'Un turno'));
  const recurso = h('select', { class: 'seleccion', id: 'b-recurso' }, data.recursos.map((r) => h('option', { value: r }, r)));
  const desde = h('input', { class: 'input', type: 'date', id: 'b-desde', value: data.hoy });
  const hasta = h('input', { class: 'input', type: 'date', id: 'b-hasta' });
  const hora = h('input', { class: 'input', type: 'time', id: 'b-hora' });
  const motivo = h('input', { class: 'input', type: 'text', id: 'b-motivo', maxlength: '120', placeholder: 'Ej.: feriado, mantenimiento' });
  const mensaje = h('div', { 'aria-live': 'polite' });
  const campo = (id, label, el, ayuda) => h('div', { class: 'campo' }, h('label', { for: id }, label), el, ayuda ? h('span', { class: 'ayuda' }, ayuda) : null);
  const cRecurso = campo('b-recurso', 'Cancha', recurso);
  const cHasta = campo('b-hasta', 'Hasta (opcional, si dura varios días)', hasta);
  const cHora = campo('b-hora', 'Horario del turno', hora);
  const sync = () => { cRecurso.hidden = tipo.value === 'dia'; cHasta.hidden = tipo.value === 'turno'; cHora.hidden = tipo.value !== 'turno'; };
  tipo.addEventListener('change', sync); sync();
  const crear = h('form', { class: 'tarjeta pila', novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    const body = { tipo: tipo.value, fecha: desde.value, motivo: motivo.value };
    if (tipo.value !== 'dia') body.recurso = recurso.value;
    if (tipo.value !== 'turno' && hasta.value) body.hasta = hasta.value;
    if (tipo.value === 'turno') body.hora = hora.value;
    try { await api('POST', '/bloqueos', body); recargarCon(aviso('ok', 'Bloqueo creado. Los clientes ya no ven esos turnos.')); } catch (err) { setChildren(mensaje, errorAviso(err)); }
  } }, h('h2', {}, 'Nuevo bloqueo'), campo('b-tipo', 'Qué bloquear', tipo), cRecurso, campo('b-desde', 'Desde', desde), cHasta, cHora,
  campo('b-motivo', 'Motivo', motivo, 'Lo ven los clientes cuando intentan reservar.'), mensaje, h('button', { class: 'btn btn-primario btn-grande', type: 'submit' }, 'Bloquear'));

  const tarjetas = data.bloqueos.map((k) => {
    const cardMsg = h('div', { 'aria-live': 'polite' });
    return h('section', { class: 'tarjeta pila' },
      h('div', { class: 'fila fila--separada' }, h('h3', {}, `${TIPO_BLOQUEO[k.tipo] ?? k.tipo}${k.recurso ? ` · ${k.recurso}` : ''}`), h('span', { class: 'estado es-bloqueada' }, 'Bloqueado')),
      h('dl', { class: 'resumen' }, fila('Cuándo', k.desdeLocal === k.hastaLocal ? k.desdeLocal : `${k.desdeLocal} → ${k.hastaLocal}`), fila('Motivo', k.motivo)),
      k.afectadas.length ? aviso('atencion', h('strong', {}, `Hay ${k.afectadas.length} ${k.afectadas.length === 1 ? 'reserva' : 'reservas'} dentro de este bloqueo`),
        h('ul', {}, k.afectadas.map((b) => h('li', {}, `${b.inicioLocal} · ${b.recurso} · ${b.cliente ?? 'Cliente'} · ${money(b.sena.texto)}`))),
        h('p', {}, 'Podés cancelarlas y devolver toda la seña. Pasa por el agente (con sus topes) y queda en Decisiones.')) : null,
      cardMsg,
      h('div', { class: 'acciones' },
        k.afectadas.length ? h('button', { class: 'btn btn-peligro', type: 'button', onclick: async () => {
          if (!(await confirmar({ titulo: `¿Cancelar ${k.afectadas.length} ${k.afectadas.length === 1 ? 'reserva' : 'reservas'}?`, texto: 'Se devuelve toda la seña a cada cliente. Si superan un tope del agente, quedan en Pendientes para tu aprobación.', ok: 'Sí, cancelar y devolver', peligro: true }))) return;
          try {
            const r = await api('POST', `/bloqueos/${k.id}/cancelar-reservas`, {});
            recargarCon(aviso('ok', h('strong', {}, 'Listo.'), h('ul', {}, r.resultados.map((x) => h('li', {}, `${x.id}: ${x.ok ? `cancelada, devolución ${money(x.devolucion)}` : x.motivo}`)))));
          } catch (err) { setChildren(cardMsg, errorAviso(err)); }
        } }, 'Cancelar esas reservas y devolver todo') : null,
        h('button', { class: 'btn btn-secundario', type: 'button', onclick: async () => {
          try { await api('DELETE', `/bloqueos/${k.id}`); recargarCon(aviso('ok', 'Bloqueo quitado: esos turnos vuelven a estar disponibles.')); } catch (err) { setChildren(cardMsg, errorAviso(err)); }
        } }, 'Quitar el bloqueo')));
  });
  return {
    descripcion: 'Feriados, mantenimiento o un turno puntual. Los clientes ven el motivo y no pueden reservar esos turnos.',
    nodos: [tarjetas.length ? h('section', { class: 'pila' }, h('h2', {}, 'Bloqueos vigentes'), tarjetas) : vacio({ icon: 'lock', titulo: 'No hay bloqueos', texto: 'Todos los turnos están disponibles para reservar.' }), crear],
  };
}

// --- Decisiones ----------------------------------------------------------------------------------------------------------------

async function vistaDecisiones() {
  const { decisiones } = await api('GET', '/decisiones?limite=200');
  let grupo = '';
  const filtro = h('input', { class: 'input', type: 'search', placeholder: 'Buscar por regla, código o texto', 'aria-label': 'Buscar en las decisiones' });
  const chips = h('div', { class: 'pestanas', role: 'group', 'aria-label': 'Filtrar por tipo' });
  const lista = h('div', { 'aria-live': 'polite' });
  const dibujar = () => {
    const t = filtro.value.trim().toLowerCase();
    const filas = decisiones.filter((d) => (!grupo || grupoDe(d) === grupo) && (!t || `${d.regla} ${d.motivo} ${d.reserva ?? ''} ${tituloDe(d)}`.toLowerCase().includes(t)));
    setChildren(chips, GRUPOS.map(([id, label]) => h('button', { class: 'pestana', type: 'button', 'aria-pressed': String(grupo === id), onclick: () => { grupo = id; dibujar(); } }, label)));
    setChildren(lista, filas.length === 0 ? vacio({ icon: 'search', titulo: 'No hay decisiones con ese filtro' })
      : agruparPorDia(filas).map((g) => h('section', {}, h('h2', { class: 'dia-grupo' }, g.etiqueta), h('div', { class: 'pila--chica' }, g.items.map((d) => tarjetaDecision(d, { modoPrueba: sessionInfo.modo === 'mock', onReserva: (id) => abrirReserva(id, route) }))))));
  };
  filtro.addEventListener('input', dibujar);
  dibujar();
  return { descripcion: 'Todo lo que hizo el agente, con la regla que aplicó. El mismo registro, sin datos personales, es público en /decisiones.', nodos: [filtro, chips, lista] };
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
    setChildren($('#barra-guardar-caja'), h('div', { class: 'barra-guardar', role: 'region', 'aria-label': 'Guardar cambios' }, h('div', { class: 'barra-guardar-in' },
      h('p', {}, 'Tenés cambios sin guardar'), h('button', { class: 'btn btn-secundario', type: 'button', onclick: descartar }, 'Descartar'), h('button', { class: 'btn btn-primario', type: 'button', id: 'guardar', onclick: guardar }, 'Guardar cambios'))));
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
    const rango = r ? `Entre ${r.min.toLocaleString('es-AR')} y ${r.max.toLocaleString('es-AR')} ${r.unit}.` : null;
    return h('div', { class: 'campo' }, h('label', { for: id }, label), input, error, (ayuda || rango) ? h('span', { class: 'ayuda' }, [ayuda, rango].filter(Boolean).join(' ')) : null);
  };
  const tilde = (label, path) => h('label', { class: 'marca-check' }, h('input', { type: 'checkbox', checked: Boolean(getPath(draft, path)), onchange: (e) => { setPath(draft, path, e.target.checked); marcar(); previewPolitica(); } }), label);

  // Canchas
  const cajaCanchas = h('div', { class: 'pila--chica' });
  const selector = h('select', { class: 'seleccion', id: 'h-alcance', onchange: (e) => { alcance = e.target.value; dibujarDias(); } });
  const dibujarCanchas = () => {
    setChildren(cajaCanchas, items.map((r, i) => h('div', { class: 'fila fila--nowrap' },
      h('input', { class: 'input', type: 'text', value: r.nombre, maxlength: '40', 'aria-label': `Nombre de la cancha ${i + 1}`, oninput: (e) => { r.nombre = e.target.value; marcar(); dibujarAlcances(); } }),
      h('label', { class: 'marca-check' }, h('input', { type: 'checkbox', checked: r.activo, onchange: (e) => { r.activo = e.target.checked; marcar(); } }), 'Activa'))),
    h('div', { class: 'acciones' }, h('button', { class: 'btn btn-secundario', type: 'button', onclick: () => { items.push({ nombre: `Cancha ${items.length + 1}`, activo: true, anterior: null, dias: diasDe({}) }); marcar(); dibujarCanchas(); dibujarAlcances(); } }, icono('plus'), 'Agregar cancha')),
    h('p', { class: 'ayuda' }, 'Las canchas no se borran: se desactivan. Si cambiás un nombre, las reservas existentes lo siguen.'));
  };
  const dibujarAlcances = () => setChildren(selector, h('option', { value: '' }, 'Todas las canchas'), items.map((r, i) => h('option', { value: String(i), selected: alcance === String(i) }, r.nombre || `Cancha ${i + 1}`)));
  const cajaDias = h('div', { class: 'pila--chica' });
  const dibujarDias = () => {
    const dias = alcance === '' ? semana : items[Number(alcance)].dias;
    setChildren(cajaDias, data.dias.map((nombre, i) => h('div', { class: 'fila fila--nowrap' },
      h('span', { style: undefined, class: 'etiqueta', 'aria-hidden': 'true' }, nombre.slice(0, 3)),
      h('label', { class: 'marca-check' }, h('input', { type: 'checkbox', checked: dias[i].cerrado, onchange: (e) => { dias[i].cerrado = e.target.checked; marcar(); dibujarDias(); } }), 'Cerrado'),
      h('input', { class: 'input', type: 'text', value: dias[i].texto, disabled: dias[i].cerrado, placeholder: alcance === '' ? 'Horarios base' : 'Los de todas las canchas', 'aria-label': `Horarios del ${nombre}`, oninput: (e) => { dias[i].texto = e.target.value; marcar(); } }))));
  };

  // Seña y política: se explican en palabras mientras se editan
  const cartelSena = h('div', { class: 'texto-politica', 'aria-live': 'polite' });
  const cartelPolitica = h('div', { class: 'texto-politica', 'aria-live': 'polite' });
  const previewSena = () => {
    const p = Number(draft.precioTurnoArs); const s = Number(draft.senaPorcentaje);
    setChildren(cartelSena, Number.isFinite(p) && Number.isFinite(s) ? [h('strong', {}, `Seña de cada turno nuevo: $ ${Math.floor((p * s) / 100).toLocaleString('es-AR')}`), `El cliente paga el ${s}% de $ ${p.toLocaleString('es-AR')}.`] : '');
  };
  const previewPolitica = () => {
    const pol = draft.politica;
    setChildren(cartelPolitica, [h('strong', {}, 'Así se aplica hoy'),
      `Cancelando con ${pol.devolucionTotalHorasAntes} h o más: se devuelve toda la seña. Entre ${pol.devolucionParcialHorasAntes} y ${pol.devolucionTotalHorasAntes} h: se devuelve el ${pol.devolucionParcialPorcentaje}%. Con menos de ${pol.devolucionParcialHorasAntes} h: la seña queda${pol.devolverSiSeRevende ? ', y si el turno se revende se devuelve' : ''}.`]);
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
      recargarCon(aviso('ok', h('strong', {}, 'Guardado.'), r.cambios.length ? `Cambió: ${r.cambios.join(', ')}. ` : 'No había cambios. ', 'Vale para reservas nuevas: las que ya se pagaron conservan su seña y su política.'));
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
    descripcion: 'Todo lo que se cambia acá vale para reservas nuevas: las que ya se pagaron conservan su seña y su política.',
    nodos: [
      resumenErrores,
      seccion('El negocio', campo('Nombre', 'nombre', { tipo: 'text' }), campo('Descripción', 'descripcion', { tipo: 'textarea' })),
      seccion('Canchas', cajaCanchas),
      seccion('Horarios',
        h('div', { class: 'campo' }, h('label', { for: 'h-base' }, 'Horarios de todos los días'), h('input', { class: 'input', id: 'h-base', type: 'text', value: base, placeholder: '09:00, 10:30, 12:00', oninput: (e) => { base = e.target.value; marcar(); } }), h('span', { class: 'ayuda' }, 'Formato HH:MM, separados por coma. Cada turno dura lo que diga la duración: los horarios no se pueden pisar.')),
        h('h3', {}, 'Cambiar un día de la semana o una cancha'), h('p', { class: 'ayuda' }, 'Dejá vacío para usar los horarios de todos los días. Marcá "Cerrado" si ese día no se abre.'),
        h('div', { class: 'campo' }, h('label', { for: 'h-alcance' }, 'Horarios de'), selector), cajaDias),
      seccion('Turnos y precio', campo('Duración del turno (minutos)', 'duracionMinutos'), campo('Hasta cuántos días antes se puede reservar', 'diasAdelante'), campo('Anticipación mínima (minutos)', 'anticipacionMinimaMinutos'),
        campo('Precio del turno (pesos)', 'precioTurnoArs', { extra: previewSena }), campo('Porcentaje de seña', 'senaPorcentaje', { extra: previewSena }), cartelSena, campo('Minutos para pagar la seña', 'reservaSinPagarMinutos')),
      seccion('Política de cancelación',
        campo('Horas de anticipación para devolver todo', 'politica.devolucionTotalHorasAntes', { extra: previewPolitica }), campo('Horas de anticipación para devolver una parte', 'politica.devolucionParcialHorasAntes', { extra: previewPolitica }),
        campo('Porcentaje que se devuelve en ese caso', 'politica.devolucionParcialPorcentaje', { extra: previewPolitica }), tilde('Si el turno se revende, devolver lo retenido', 'politica.devolverSiSeRevende'),
        campo('Minutos que se le guarda el turno a quien está en lista de espera', 'politica.ofertaListaEsperaMinutos'), cartelPolitica),
      seccion('Límites del agente', h('p', { class: 'ayuda' }, 'Son la red de seguridad: por encima de estos topes el agente no manda plata solo, te pide aprobación.'),
        campo('Devolución automática máxima (pesos)', 'limites.devolucionMaxAutomaticaArs', { ayuda: 'Por encima de esto, te pide aprobación.' }), campo('Devoluciones por día (pesos)', 'limites.devolucionesMaxDiariasArs'),
        campo('Máximo por transferencia (pesos)', 'limites.transferenciaMaxArs'), campo('Hora del cierre del día', 'cierre.hora', { tipo: 'time' })),
      seccion('Solo se cambia en el archivo .env', h('p', { class: 'ayuda' }, 'Por seguridad, esto no se edita desde el panel.'),
        h('dl', { class: 'resumen' }, fila('Modo', data.soloLectura.modo === 'mock' ? 'Prueba (no mueve plata)' : 'Real'), fila('Dirección de retiro', data.soloLectura.direccionDeRetiro ?? 'Sin configurar'), fila('Billetera del agente', h('span', { class: 'mono' }, data.soloLectura.billeteraDelAgente)))),
      h('section', { class: 'pila' }, h('h2', {}, 'Historial de cambios'),
        hist.length === 0 ? h('p', { class: 'apagado' }, 'Todavía no hubo cambios.') : h('div', { class: 'tabla-caja' }, h('table', { class: 'tabla tabla--apilada' },
          h('caption', { class: 'solo-lectores' }, 'Historial de cambios de configuración'),
          h('thead', {}, h('tr', {}, ['Cuándo', 'Quién', 'Campo', 'Antes', 'Después'].map((t) => h('th', { scope: 'col' }, t)))),
          h('tbody', {}, hist.map((r) => h('tr', { class: 'item-historial' }, h('td', { 'data-label': 'Cuándo' }, fmtInstant(r.fecha)), h('td', { 'data-label': 'Quién' }, r.quien), h('td', { 'data-label': 'Campo' }, r.campo), h('td', { 'data-label': 'Antes' }, corto(r.antes)), h('td', { 'data-label': 'Después' }, corto(r.despues)))))))),
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
    descripcion: 'El cierre resume el día y le pasa al dueño lo que ya no está comprometido en turnos futuros. Se hace solo a la hora que configures.',
    nodos: [
      ultimo ? h('section', { class: 'pila' }, h('h2', {}, `Último cierre: ${fmtFecha(ultimo.dia)}`), h('p', { class: 'apagado' }, `Hecho el ${fmtInstant(ultimo.fecha)}`), h('pre', { class: 'reporte' }, ultimo.reporte))
        : vacio({ icon: 'wallet', titulo: 'Todavía no se hizo ningún cierre', texto: 'El primero se hace solo a la hora configurada, o podés pedirlo ahora.' }),
      mensaje,
      h('div', { class: 'tarjeta pila' }, h('h2', {}, 'Pedir un cierre ahora'), h('p', { class: 'apagado' }, 'Si hay plata libre, se prepara el retiro a la dirección del dueño (la que está en el .env). El retiro no toca señas de turnos futuros.'),
        h('button', { class: 'btn btn-primario', type: 'button', onclick: async () => {
          if (!(await confirmar({ titulo: '¿Hacer el cierre ahora?', texto: 'Se resume el día y, si hay plata libre, se prepara el retiro al dueño.', ok: 'Sí, hacer el cierre' }))) return;
          try { await api('POST', '/cierre', {}); recargarCon(aviso('ok', 'Cierre hecho. Abajo está el reporte.')); } catch (err) { setChildren(mensaje, errorAviso(err)); }
        } }, 'Pedir un cierre ahora')),
    ],
  };
}

const VISTAS = { hoy: vistaHoy, calendario: vistaCalendario, reservas: vistaReservas, pendientes: vistaPendientes, bloqueos: vistaBloqueos, decisiones: vistaDecisiones, config: vistaConfig, cierre: vistaCierre };

iniciar().catch((err) => setChildren(app, h('main', { class: 'contenedor', id: 'contenido' }, errorAviso(err, iniciar))));
