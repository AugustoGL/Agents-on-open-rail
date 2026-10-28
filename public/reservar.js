// Reserva web para clientes. El cliente se identifica con un token guardado en este navegador
// (el mismo clienteToken que usa la API): sirve para ver y cancelar sus reservas, y viaja siempre en el cuerpo.
// Todo lo que viene del servidor entra como texto (nunca como HTML).
import {
  h, $, setChildren, request, storage, safeHref, ahoraServidor, fmtFecha, partesDia, carteles, barraCliente,
  aviso, esqueletos, vacio, estadoEtiqueta, icono, abreviar,
} from '/static/dom.js';

const TOKEN_KEY = 'sena_token';
const NAME_KEY = 'sena_nombre';
const CONTACT_KEY = 'sena_contacto';
const TOKEN_RE = /^api:[a-f0-9]{32}$/;
const BOOKING_RE = /^S-[A-Z0-9]{6}$/;

const S = {
  negocio: null, dias: [], dia: null, turnos: [], seleccion: null, enviando: false, mias: { reservas: [], esperas: [] }, confirmando: null, mensaje: null,
  // Con la billetera: la firma de un mensaje demuestra que es tuya y muestra las reservas que pagaste desde ella.
  bill: { sesion: null, direccion: null, reservas: [], ids: new Set(), conectando: false, mensaje: null },
};
const BILL_KEY = 'sena_billetera';
const token = () => { const t = storage.get(TOKEN_KEY); return t && TOKEN_RE.test(t) ? t : null; };
const errorDeRed = (err) => (err.status ? err.message : 'No pudimos conectarnos. Revisá tu conexión y probá de nuevo.');

// --- Arranque ------------------------------------------------------------------------------------------

async function init() {
  setChildren($('#barra'), barraCliente({ activa: 'reservar' }));
  setChildren($('#turnos'), esqueletos());
  S.negocio = await request('GET', '/api/negocio');
  const n = S.negocio;
  document.title = `Reservá tu turno · ${n.nombre}`;
  setChildren($('#carteles'), carteles(n));
  // En el comercio de demostración el cartel de arriba ya lo explica: no se repite la descripción.
  $('#negocio').textContent = n.descripcion && !n.esDemostracion ? `${n.nombre} · ${n.descripcion}` : n.nombre;
  $('#f-sena').replaceChildren(h('span', { class: 'num' }, n.sena), ' ', h('span', { class: 'monto-token' }, 'en wARS'));
  $('#f-tiempo').textContent = `${n.reservaSinPagarMinutos} minutos`;
  $('#como-token').textContent = `en wARS, el peso argentino digital · seña de ${n.sena.replace('$ ', '$\u00a0')}`;
  setChildren($('#politica'), n.politica.map((p) => h('li', {}, p)));
  $('#f-nombre').value = storage.get(NAME_KEY) ?? '';
  $('#f-contacto').value = storage.get(CONTACT_KEY) ?? '';
  $('#f').addEventListener('submit', enviar);
  $('#f-cancelar').addEventListener('click', () => { S.seleccion = null; renderFormulario(); renderTurnos(); });
  renderBilletera();
  restaurarBilletera();
  await Promise.all([cargarDias(), cargarMias().catch(() => renderMias())]);
  setInterval(() => { if (!document.hidden && !S.enviando && !S.confirmando) cargarMias().catch(() => {}); }, 30_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !S.confirmando) cargarMias().catch(() => {}); });
}

function setPaso(n) {
  [...$('#pasos').children].forEach((li, i) => {
    if (i + 1 === n) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    if (i + 1 < n) li.setAttribute('data-hecho', ''); else li.removeAttribute('data-hecho');
  });
}

// --- Días y turnos ----------------------------------------------------------------------------------------

const avisoErrorTurnos = (err, reintentar) => aviso('error', h('strong', {}, 'No pudimos cargar los turnos'), errorDeRed(err),
  h('div', { class: 'acciones' }, h('button', { class: 'btn btn-secundario', type: 'button', onclick: reintentar }, 'Probar de nuevo')));

async function cargarDias() {
  try {
    const first = await request('GET', '/api/turnos');
    S.dias = first.diasDisponibles ?? [];
    if (S.dias.length === 0) {
      setChildren($('#dias'));
      setChildren($('#turnos'), vacio({ titulo: 'Por ahora no hay turnos para reservar', texto: 'El comercio todavía no abrió turnos para los próximos días. Probá de nuevo más tarde.' }));
      $('#turnos').setAttribute('aria-busy', 'false');
      return;
    }
    S.dia = S.dias.includes(first.fecha) ? first.fecha : S.dias[0];
    renderDias();
    S.turnos = (await request('GET', `/api/turnos?fecha=${S.dia}&libres=no`)).turnos;
    renderTurnos();
  } catch (err) {
    setChildren($('#turnos'), avisoErrorTurnos(err, () => { setChildren($('#turnos'), esqueletos()); cargarDias(); }));
    $('#turnos').setAttribute('aria-busy', 'false');
  }
}

function renderDias() {
  setChildren($('#dias'), S.dias.map((d) => {
    const p = partesDia(d);
    return h('button', {
      class: 'dia', type: 'button', 'aria-pressed': String(d === S.dia), 'data-day': d, ...(d === S.negocio.hoy ? { 'data-hoy': '' } : {}), 'aria-label': fmtFecha(d),
      onclick: () => elegirDia(d),
    }, h('span', { class: 'dia-semana' }, p.semana), h('span', { class: 'dia-numero' }, p.numero), h('span', { class: 'dia-mes' }, p.mes));
  }));
}

async function elegirDia(d) {
  S.dia = d; S.seleccion = null; setChildren($('#aviso'));
  renderDias(); renderFormulario();
  $('#turnos').setAttribute('aria-busy', 'true');
  setChildren($('#turnos'), esqueletos());
  try {
    S.turnos = (await request('GET', `/api/turnos?fecha=${d}&libres=no`)).turnos;
    renderTurnos();
  } catch (err) {
    setChildren($('#turnos'), avisoErrorTurnos(err, () => elegirDia(d)));
    $('#turnos').setAttribute('aria-busy', 'false');
  }
}

async function refrescarTurnos() {
  try { S.turnos = (await request('GET', `/api/turnos?fecha=${S.dia}&libres=no`)).turnos; renderTurnos(); } catch { /* queda la lista vieja */ }
}

function renderTurnos() {
  $('#turnos').dataset.day = S.dia; // qué día muestra la lista (lo usa la prueba de navegador)
  $('#turnos').setAttribute('aria-busy', 'false');
  const hayTurnos = S.turnos.length > 0;
  $('#leyenda').hidden = !hayTurnos;
  if (!hayTurnos) {
    setChildren($('#turnos'), vacio({ titulo: 'Ese día no hay turnos', texto: 'Probá con otro día de la lista de arriba.' }));
    return;
  }
  const libres = S.turnos.filter((t) => t.estado === 'libre').length;
  const porHora = new Map();
  for (const t of S.turnos) { if (!porHora.has(t.hora)) porHora.set(t.hora, []); porHora.get(t.hora).push(t); }
  const botonTurno = (t) => {
    const nombre = `${t.recurso}, ${t.hora}`;
    if (t.estado === 'bloqueado') {
      return h('button', { class: 'turno turno--bloqueado', type: 'button', disabled: true, 'aria-label': `${nombre}: no disponible${t.motivo ? ` (${t.motivo})` : ''}` }, t.recurso, t.motivo ? h('small', {}, t.motivo) : null);
    }
    const ocupado = t.estado === 'ocupado';
    const elegido = S.seleccion && S.seleccion.recurso === t.recurso && S.seleccion.inicio === t.inicio;
    return h('button', {
      class: `turno${ocupado ? ' turno--ocupado' : ''}`, type: 'button', 'aria-pressed': String(Boolean(elegido)),
      'aria-label': `${nombre}: ${ocupado ? 'ocupado, anotarse en la lista de espera' : 'libre'}`,
      onclick: () => elegirTurno(t),
    }, t.recurso, ocupado ? h('small', {}, 'Lista de espera') : null);
  };
  setChildren($('#turnos'),
    h('p', { class: 'apagado', role: 'status' }, libres === 0 ? 'No quedan turnos libres este día: podés anotarte en la lista de espera.' : `${libres} ${libres === 1 ? 'turno libre' : 'turnos libres'} el ${fmtFecha(S.dia)}.`),
    h('div', { class: 'tarjeta' }, [...porHora].map(([hora, items]) => h('div', { class: 'franja' }, h('div', { class: 'franja-hora num' }, hora), h('div', { class: 'franja-canchas' }, items.map(botonTurno))))));
}

function elegirTurno(t) {
  S.seleccion = { recurso: t.recurso, inicio: t.inicio, hora: t.hora, ocupado: t.estado === 'ocupado' };
  setChildren($('#aviso'));
  renderTurnos(); renderFormulario(true);
}

// --- Formulario ---------------------------------------------------------------------------------------------

function renderFormulario(enfocar = false) {
  const sel = S.seleccion;
  $('#formulario').hidden = !sel;
  setPaso(sel ? 2 : 1);
  setChildren($('#f-error')); setChildren($('#f-nombre-error'));
  $('#f-nombre').removeAttribute('aria-invalid');
  if (!sel) return;
  const n = S.negocio;
  $('#f-turno').textContent = `${sel.recurso} · ${fmtFecha(S.dia)} · ${sel.hora}`;
  $('#t-form').textContent = sel.ocupado ? 'Anotate en la lista de espera' : 'Tus datos';
  $('#f-tiempo-t').textContent = sel.ocupado ? 'Si se libera' : 'Tiempo para pagar';
  $('#f-tiempo').textContent = sel.ocupado ? `Te lo guardamos ${n.listaEsperaMinutos} minutos` : `${n.reservaSinPagarMinutos} minutos`;
  $('#f-ok').textContent = sel.ocupado ? 'Anotarme en la lista de espera' : 'Reservar y pagar la seña';
  if (sel.ocupado) {
    setChildren($('#f-error'), aviso('info', 'Este turno está ocupado. Si alguien cancela, te lo guardamos y lo ves en "Mis reservas" con el link para pagar la seña.'));
  }
  if (enfocar) { $('#formulario').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); $('#t-form').focus({ preventScroll: true }); }
}

async function enviar(e) {
  e.preventDefault();
  if (S.enviando || !S.seleccion) return;
  const nombre = $('#f-nombre').value.trim();
  const contacto = $('#f-contacto').value.trim();
  setChildren($('#f-nombre-error'));
  if (!nombre) {
    $('#f-nombre').setAttribute('aria-invalid', 'true');
    setChildren($('#f-nombre-error'), h('div', { class: 'error-campo', role: 'alert' }, 'Escribí tu nombre para poder reservar.'));
    $('#f-nombre').focus();
    return;
  }
  $('#f-nombre').removeAttribute('aria-invalid');
  storage.set(NAME_KEY, nombre); storage.set(CONTACT_KEY, contacto);
  S.enviando = true;
  $('#f-ok').setAttribute('aria-busy', 'true');
  const sel = S.seleccion;
  try {
    const cliente = { nombre, canal: 'web', ...(contacto ? { contacto } : {}), ...(token() ? { token: token() } : {}) };
    if (sel.ocupado) {
      const r = await request('POST', '/api/lista-espera', { recurso: sel.recurso, inicio: sel.inicio, cliente });
      storage.set(TOKEN_KEY, r.clienteToken);
      S.seleccion = null; renderFormulario();
      setChildren($('#aviso'), aviso('ok', h('strong', {}, r.puesto === 1 ? 'Listo, quedaste primero en la lista de espera.' : `Listo, quedaste en el puesto ${r.puesto} de la lista de espera.`), 'Si se libera, te guardamos el turno y lo ves abajo, en "Mis reservas", con el link para pagar.'));
      await Promise.all([refrescarTurnos(), cargarMias()]);
      return;
    }
    const r = await request('POST', '/api/reservas', { recurso: sel.recurso, inicio: sel.inicio, cliente });
    storage.set(TOKEN_KEY, r.clienteToken);
    location.assign(`/pagar/${r.reserva.id}`); // el pago sigue en la página de siempre
  } catch (err) {
    setChildren($('#f-error'), aviso('error', h('strong', {}, err.status === 409 ? 'Ese turno se acaba de ocupar' : 'No se pudo reservar'), errorDeRed(err),
      err.status === 409 ? h('div', { class: 'acciones' }, h('button', { class: 'btn btn-secundario', type: 'button', onclick: () => { S.seleccion = null; renderFormulario(); refrescarTurnos(); } }, 'Ver otros turnos')) : null));
    if (err.status === 409) refrescarTurnos();
  } finally {
    S.enviando = false;
    $('#f-ok').removeAttribute('aria-busy');
  }
}

// --- Mis reservas ---------------------------------------------------------------------------------------------

async function cargarMias() {
  const t = token();
  if (!t) S.mias = { reservas: [], esperas: [] };
  else S.mias = await request('POST', '/api/mis-reservas', { clienteToken: t });
  if (S.bill.sesion) await refrescarBilletera();
  renderMias();
}

/** Las reservas del navegador y las de la billetera juntas, sin repetir. */
function todas() {
  const ids = new Set(S.mias.reservas.map((b) => b.id));
  return [...S.mias.reservas, ...S.bill.reservas.filter((b) => !ids.has(b.id))].sort((a, b) => Date.parse(b.inicio) - Date.parse(a.inicio));
}

const minutosRestantes = (iso) => Math.max(0, Math.ceil((Date.parse(iso) - ahoraServidor()) / 60000));

function renderMias() {
  const reservas = todas();
  const { esperas } = S.mias;
  const vigentes = reservas.filter((b) => b.estado === 'held' || b.estado === 'confirmed');
  const anteriores = reservas.filter((b) => !vigentes.includes(b));
  const nodes = [S.mensaje];
  if (reservas.length === 0 && esperas.length === 0) {
    nodes.push(vacio({ titulo: 'Todavía no tenés reservas', texto: 'Cuando reserves un turno lo vas a ver acá, con su estado. Se guardan en este navegador: si abrís la página desde otro celular, no van a aparecer.' }));
  }
  if (vigentes.length) nodes.push(h('div', { class: 'pila' }, h('h3', {}, 'Próximas'), vigentes.map(tarjeta)));
  if (esperas.length) {
    nodes.push(h('div', { class: 'pila' }, h('h3', {}, 'En lista de espera'), esperas.map((w) => h('div', { class: 'tarjeta pila--chica' },
      h('div', { class: 'fila fila--separada' }, h('strong', {}, `${w.recurso} · ${w.inicioLocal}`),
        w.estado === 'offered' ? h('span', { class: 'estado es-esperando' }, 'Te lo ofrecimos') : h('span', { class: 'estado es-vencida' }, `Puesto ${w.puesto}`)),
      h('p', { class: 'apagado' }, w.estado === 'offered' ? 'Mirá "Próximas": ahí está el turno con el link para pagar.' : 'Si se libera, lo ves acá.')))));
  }
  if (anteriores.length) nodes.push(h('div', { class: 'pila' }, h('h3', {}, 'Anteriores'), anteriores.map(tarjeta)));
  setChildren($('#mis'), h('div', { class: 'pila--grande' }, nodes));
}

/** Lo primero que se lee antes de cancelar: cuánto devuelve la política. */
function titularCancelacion(c) {
  if (c.regla === 'SIN_PAGO') return 'Todavía no pagaste: se cancela sin costo.';
  if (c.devolucion === '$ 0') return 'Si cancelás ahora, la seña no se devuelve.';
  return `Si cancelás ahora, te devolvemos ${c.devolucion}.`;
}

function tarjeta(b) {
  const activa = b.estado === 'held' || b.estado === 'confirmed';
  const valida = BOOKING_RE.test(b.id);
  const card = h('div', { class: 'tarjeta pila' },
    h('div', { class: 'fila fila--separada' }, h('strong', {}, `${b.recurso} · ${b.inicioLocal}`), estadoEtiqueta(b.estado)),
    h('dl', { class: 'resumen' },
      h('div', {}, h('dt', {}, 'Seña'), h('dd', { class: 'num' }, b.sena.texto, ' ', h('span', { class: 'monto-token' }, 'en wARS'))),
      b.devuelto.pesos !== '0' ? h('div', {}, h('dt', {}, 'Te devolvimos'), h('dd', { class: 'num' }, b.devuelto.texto)) : null,
      b.estado === 'held' && b.venceEl ? h('div', {}, h('dt', {}, 'Tenés para pagar'), h('dd', {}, `${minutosRestantes(b.venceEl)} min`)) : null),
    b.estado === 'expired' ? aviso('info', 'No se pagó la seña a tiempo y el turno se liberó. Podés reservar de nuevo.') : null,
    b.estado === 'confirmed' ? aviso('ok', 'Turno confirmado. Si necesitás cancelar, antes de confirmar te mostramos cuánto te devolvemos.') : null);
  const c = S.confirmando;
  if (c && c.id === b.id) {
    card.append(
      aviso(c.ok ? 'atencion' : 'error', c.ok ? [h('strong', {}, titularCancelacion(c)), c.motivo] : c.motivo),
      h('div', { class: 'acciones' },
        c.ok ? h('button', { class: 'btn btn-peligro', type: 'button', onclick: () => cancelar(b.id), ...(c.enviando ? { 'aria-busy': 'true' } : {}) }, 'Sí, cancelar mi reserva') : null,
        h('button', { class: 'btn btn-secundario', type: 'button', onclick: () => { S.confirmando = null; renderMias(); } }, 'Volver')));
    return card;
  }
  if (activa && valida) {
    card.append(h('div', { class: 'acciones' },
      b.estado === 'held' ? h('a', { class: 'btn btn-primario', href: safeHref(`/pagar/${b.id}`) }, 'Pagar la seña') : h('a', { class: 'btn btn-secundario', href: safeHref(`/pagar/${b.id}`) }, 'Ver comprobante'),
      h('button', { class: 'btn btn-peligro-suave', type: 'button', onclick: () => previsualizar(b.id) }, 'Cancelar')));
  }
  return card;
}

/** Cancela (o muestra qué devolvería) por la billetera si la reserva se pagó desde la conectada, y si no por el navegador. */
function pedirCancelacion(id, accion) {
  if (S.bill.ids.has(id)) return request('POST', `/api/billetera/reservas/${id}/${accion}`, { sesion: S.bill.sesion }).catch(sesionVencida);
  return request('POST', `/api/reservas/${id}/${accion}`, { clienteToken: token() });
}

async function previsualizar(id) {
  S.mensaje = null;
  try {
    const p = await pedirCancelacion(id, 'cancelar-vista');
    S.confirmando = { id, ok: true, devolucion: p.devolucion, regla: p.regla, motivo: p.motivo };
  } catch (err) {
    S.confirmando = { id, ok: false, motivo: errorDeRed(err) };
  }
  renderMias();
}

async function cancelar(id) {
  S.enviando = true;
  S.confirmando = { ...S.confirmando, enviando: true };
  renderMias();
  try {
    const r = await pedirCancelacion(id, 'cancelar');
    S.mensaje = aviso('ok', h('strong', {}, 'Reserva cancelada.'), r.motivo, r.devolucion && r.devolucion !== '$ 0' ? ` Te devolvemos ${r.devolucion}: llega a la misma billetera con la que pagaste.` : '');
  } catch (err) {
    S.mensaje = aviso('error', h('strong', {}, 'No se pudo cancelar'), errorDeRed(err));
  } finally {
    S.confirmando = null;
    S.enviando = false;
  }
  await Promise.all([cargarMias().catch(() => renderMias()), refrescarTurnos()]);
}

// --- Ver mis reservas con la billetera ----------------------------------------------------------------------------------

const aHex = (texto) => `0x${[...new TextEncoder().encode(texto)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;

function sesionVencida(err) {
  if (err.data?.codigo === 'sin_sesion') {
    desconectarBilletera();
    S.bill.mensaje = aviso('atencion', h('strong', {}, 'Pasó mucho tiempo'), 'Por seguridad, la conexión con tu billetera dura unos minutos. Volvé a conectarla para ver tus reservas.');
    renderBilletera(); renderMias();
  }
  throw err;
}

function guardarBilletera() {
  try { sessionStorage.setItem(BILL_KEY, JSON.stringify({ sesion: S.bill.sesion, direccion: S.bill.direccion })); } catch { /* sin almacenamiento: se pide de nuevo */ }
}

function aplicarBilletera(r) {
  S.bill.direccion = r.direccion;
  S.bill.reservas = r.reservas;
  S.bill.ids = new Set(r.reservas.map((b) => b.id));
  if (r.sesion) S.bill.sesion = r.sesion;
}

function desconectarBilletera() {
  S.bill = { sesion: null, direccion: null, reservas: [], ids: new Set(), conectando: false, mensaje: null };
  try { sessionStorage.removeItem(BILL_KEY); } catch { /* nada */ }
}

async function refrescarBilletera() {
  try {
    aplicarBilletera(await request('POST', '/api/billetera/mis-reservas', { sesion: S.bill.sesion }));
  } catch (err) {
    if (err.data?.codigo === 'sin_sesion') { try { sesionVencida(err); } catch { /* ya se avisó en pantalla */ } }
  }
}

async function restaurarBilletera() {
  try {
    const g = JSON.parse(sessionStorage.getItem(BILL_KEY) ?? 'null');
    if (!g?.sesion) return;
    S.bill.sesion = g.sesion; S.bill.direccion = g.direccion;
    await refrescarBilletera();
  } catch { desconectarBilletera(); }
  renderBilletera(); renderMias();
}

function mensajeDeFirma(err) {
  if (err?.code === 4001 || /user rejected|user denied|rejected the request/i.test(err?.message ?? '')) return aviso('info', h('strong', {}, 'No firmaste'), 'No pasó nada ni se cobró nada. Podés intentar de nuevo cuando quieras.');
  if (err?.code === -32002) return aviso('atencion', h('strong', {}, 'Tu billetera tiene un pedido abierto'), 'Abrila y respondé ese pedido primero.');
  return aviso('error', h('strong', {}, 'No pudimos verificar tu billetera'), err.status ? err.message : (err?.message ?? 'Probá de nuevo.'));
}

async function conectarBilletera() {
  S.bill.conectando = true; S.bill.mensaje = null; renderBilletera();
  try {
    const [cuenta] = await window.ethereum.request({ method: 'eth_requestAccounts' });
    const d = await request('POST', '/api/billetera/desafio', { direccion: cuenta });
    const firma = await window.ethereum.request({ method: 'personal_sign', params: [aHex(d.mensaje), cuenta] });
    aplicarBilletera(await request('POST', '/api/billetera/reservas', { direccion: cuenta, nonce: d.nonce, firma }));
    guardarBilletera();
    S.bill.mensaje = null;
  } catch (err) {
    S.bill.mensaje = mensajeDeFirma(err);
  }
  S.bill.conectando = false;
  renderBilletera(); renderMias();
}

function renderBilletera() {
  const b = S.bill;
  if (b.sesion) {
    setChildren($('#billetera'), h('div', { class: 'tarjeta tarjeta--suave pila--chica' },
      h('div', { class: 'fila fila--separada' },
        h('div', { class: 'fila' }, icono('wallet'), h('strong', {}, 'Billetera conectada'), h('span', { class: 'mono apagado' }, abreviar(b.direccion))),
        h('button', { class: 'btn btn-fantasma btn-chico', type: 'button', onclick: () => { desconectarBilletera(); renderBilletera(); renderMias(); } }, 'Desconectar')),
      h('p', { class: 'apagado', role: 'status' }, b.reservas.length === 0
        ? 'No encontramos reservas pagadas con esta billetera.'
        : `Encontramos ${b.reservas.length} ${b.reservas.length === 1 ? 'reserva pagada' : 'reservas pagadas'} con esta billetera. Las ves abajo, en cualquier dispositivo.`)));
    return;
  }
  if (!window.ethereum) {
    setChildren($('#billetera'), h('div', { class: 'tarjeta tarjeta--suave pila--chica' },
      h('div', { class: 'fila' }, icono('wallet'), h('strong', {}, '¿Pagaste con tu billetera?')),
      h('p', { class: 'apagado' }, 'Abrí esta página desde el navegador de tu billetera (MetaMask, MiniPay…) y vas a ver tus reservas desde cualquier celular o computadora.')));
    return;
  }
  setChildren($('#billetera'), h('div', { class: 'tarjeta pila--chica' },
    h('div', { class: 'fila' }, icono('wallet'), h('h3', {}, 'Ver mis reservas con mi billetera')),
    h('p', { class: 'apagado' }, 'Firmás un mensaje (no cuesta nada ni mueve plata) y te mostramos todas las reservas que pagaste con esa billetera, desde cualquier dispositivo.'),
    b.mensaje,
    h('button', { class: 'btn btn-secundario btn-bloque', type: 'button', id: 'conectar-billetera', onclick: conectarBilletera, ...(b.conectando ? { 'aria-busy': 'true' } : {}) }, b.conectando ? 'Esperando tu firma…' : 'Conectar billetera')));
}

init().catch((err) => {
  setChildren($('#turnos'), aviso('error', h('strong', {}, 'No pudimos cargar la página'), errorDeRed(err),
    h('div', { class: 'acciones' }, h('button', { class: 'btn btn-secundario', type: 'button', onclick: () => location.reload() }, 'Recargar'))));
  $('#turnos').setAttribute('aria-busy', 'false');
});
