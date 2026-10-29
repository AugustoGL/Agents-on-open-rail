// Web booking for customers. El cliente se identifica con un token guardado en este navegador
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
const errorDeRed = (err) => (err.status ? err.message : 'We could not connect. Check your connection and try again.');

// --- Arranque ------------------------------------------------------------------------------------------

async function init() {
  setChildren($('#barra'), barraCliente({ activa: 'reservar' }));
  setChildren($('#turnos'), esqueletos());
  S.negocio = await request('GET', '/api/negocio');
  const n = S.negocio;
  document.title = `Book your slot · ${n.nombre}`;
  setChildren($('#carteles'), carteles(n));
  // En el comercio de demostración el cartel de arriba ya lo explica: no se repite la descripción.
  $('#negocio').textContent = n.descripcion && !n.esDemostracion ? `${n.nombre} · ${n.descripcion}` : n.nombre;
  $('#f-sena').replaceChildren(h('span', { class: 'num' }, n.sena), ' ', h('span', { class: 'monto-token' }, 'in wARS'));
  $('#f-tiempo').textContent = `${n.reservaSinPagarMinutos} minutes`;
  $('#como-token').textContent = `in wARS, the digital Argentine peso · deposit of ${n.sena.replace('$ ', '$\u00a0')}`;
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

const avisoErrorTurnos = (err, reintentar) => aviso('error', h('strong', {}, 'We could not load the slots'), errorDeRed(err),
  h('div', { class: 'acciones' }, h('button', { class: 'btn btn-secundario', type: 'button', onclick: reintentar }, 'Try again')));

async function cargarDias() {
  try {
    const first = await request('GET', '/api/turnos');
    S.dias = first.diasDisponibles ?? [];
    if (S.dias.length === 0) {
      setChildren($('#dias'));
      setChildren($('#turnos'), vacio({ titulo: 'No slots to book right now', texto: 'The venue has not opened slots for the coming days yet. Please try again later.' }));
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
    setChildren($('#turnos'), vacio({ titulo: 'No slots that day', texto: 'Try another day from the list above.' }));
    return;
  }
  const libres = S.turnos.filter((t) => t.estado === 'libre').length;
  const porHora = new Map();
  for (const t of S.turnos) { if (!porHora.has(t.hora)) porHora.set(t.hora, []); porHora.get(t.hora).push(t); }
  const botonTurno = (t) => {
    const nombre = `${t.recurso}, ${t.hora}`;
    if (t.estado === 'bloqueado') {
      return h('button', { class: 'turno turno--bloqueado', type: 'button', disabled: true, 'aria-label': `${nombre}: unavailable${t.motivo ? ` (${t.motivo})` : ''}` }, t.recurso, t.motivo ? h('small', {}, t.motivo) : null);
    }
    const ocupado = t.estado === 'ocupado';
    const elegido = S.seleccion && S.seleccion.recurso === t.recurso && S.seleccion.inicio === t.inicio;
    return h('button', {
      class: `turno${ocupado ? ' turno--ocupado' : ''}`, type: 'button', 'aria-pressed': String(Boolean(elegido)),
      'aria-label': `${nombre}: ${ocupado ? 'taken, join the waitlist' : 'free'}`,
      onclick: () => elegirTurno(t),
    }, t.recurso, ocupado ? h('small', {}, 'Waitlist') : null);
  };
  setChildren($('#turnos'),
    h('p', { class: 'apagado', role: 'status' }, libres === 0 ? 'No free slots this day: you can join the waitlist.' : `${libres} free ${libres === 1 ? 'slot' : 'slots'} on ${fmtFecha(S.dia)}.`),
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
  $('#t-form').textContent = sel.ocupado ? 'Join the waitlist' : 'Your details';
  $('#f-tiempo-t').textContent = sel.ocupado ? 'If it frees up' : 'Time to pay';
  $('#f-tiempo').textContent = sel.ocupado ? `We hold it for ${n.listaEsperaMinutos} minutes` : `${n.reservaSinPagarMinutos} minutes`;
  $('#f-ok').textContent = sel.ocupado ? 'Join the waitlist' : 'Book and pay the deposit';
  if (sel.ocupado) {
    setChildren($('#f-error'), aviso('info', 'This slot is taken. If someone cancels, we hold it for you and you will see it in "My bookings" with the link to pay the deposit.'));
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
    setChildren($('#f-nombre-error'), h('div', { class: 'error-campo', role: 'alert' }, 'Enter your name to book.'));
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
      setChildren($('#aviso'), aviso('ok', h('strong', {}, r.puesto === 1 ? 'Done, you are first on the waitlist.' : `Done, you are number ${r.puesto} on the waitlist.`), 'If it frees up, we hold the slot for you and you will see it below, in "My bookings", with the link to pay.'));
      await Promise.all([refrescarTurnos(), cargarMias()]);
      return;
    }
    const r = await request('POST', '/api/reservas', { recurso: sel.recurso, inicio: sel.inicio, cliente });
    storage.set(TOKEN_KEY, r.clienteToken);
    location.assign(`/pagar/${r.reserva.id}`); // el pago sigue en la página de siempre
  } catch (err) {
    setChildren($('#f-error'), aviso('error', h('strong', {}, err.status === 409 ? 'That slot was just taken' : 'Could not book'), errorDeRed(err),
      err.status === 409 ? h('div', { class: 'acciones' }, h('button', { class: 'btn btn-secundario', type: 'button', onclick: () => { S.seleccion = null; renderFormulario(); refrescarTurnos(); } }, 'See other slots')) : null));
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
    nodes.push(vacio({ titulo: 'You have no bookings yet', texto: 'When you book a slot you will see it here, with its status. They are saved in this browser: if you open the page on another phone, they will not show up.' }));
  }
  if (vigentes.length) nodes.push(h('div', { class: 'pila' }, h('h3', {}, 'Upcoming'), vigentes.map(tarjeta)));
  if (esperas.length) {
    nodes.push(h('div', { class: 'pila' }, h('h3', {}, 'On the waitlist'), esperas.map((w) => h('div', { class: 'tarjeta pila--chica' },
      h('div', { class: 'fila fila--separada' }, h('strong', {}, `${w.recurso} · ${w.inicioLocal}`),
        w.estado === 'offered' ? h('span', { class: 'estado es-esperando' }, 'We offered it to you') : h('span', { class: 'estado es-vencida' }, `Position ${w.puesto}`)),
      h('p', { class: 'apagado' }, w.estado === 'offered' ? 'Look under "Upcoming": the slot is there with the link to pay.' : 'If it frees up, you will see it here.')))));
  }
  if (anteriores.length) nodes.push(h('div', { class: 'pila' }, h('h3', {}, 'Past'), anteriores.map(tarjeta)));
  setChildren($('#mis'), h('div', { class: 'pila--grande' }, nodes));
}

/** El ticket NFT de una reserva: qué pasó con él y, si ya está en la cadena, dónde verlo. */
function textoNft(n) {
  if (n.estado === 'enviando') return 'Being sent to your wallet…';
  if (n.estado === 'error') return 'Retrying';
  const texto = n.estado === 'jugado' ? 'Played' : 'In your wallet';
  return n.simulado ? `${texto} (simulated)` : h('a', { href: safeHref(n.urlToken), target: '_blank', rel: 'noopener noreferrer' }, texto);
}

/** Lo primero que se lee antes de cancelar: cuánto devuelve la política. */
function titularCancelacion(c) {
  if (c.regla === 'SIN_PAGO') return 'You have not paid yet: it is cancelled at no cost.';
  if (c.devolucion === '$ 0') return 'If you cancel now, the deposit is not refunded.';
  return `If you cancel now, we refund ${c.devolucion}.`;
}

function tarjeta(b) {
  const activa = b.estado === 'held' || b.estado === 'confirmed';
  const valida = BOOKING_RE.test(b.id);
  const card = h('div', { class: 'tarjeta pila' },
    h('div', { class: 'fila fila--separada' }, h('strong', {}, `${b.recurso} · ${b.inicioLocal}`), estadoEtiqueta(b.estado)),
    h('dl', { class: 'resumen' },
      h('div', {}, h('dt', {}, 'Deposit'), h('dd', { class: 'num' }, b.sena.texto, ' ', h('span', { class: 'monto-token' }, 'in wARS'))),
      b.devuelto.pesos !== '0' ? h('div', {}, h('dt', {}, 'Refunded to you'), h('dd', { class: 'num' }, b.devuelto.texto)) : null,
      b.estado === 'held' && b.venceEl ? h('div', {}, h('dt', {}, 'Time left to pay'), h('dd', {}, `${minutosRestantes(b.venceEl)} min`)) : null,
      b.nft ? h('div', {}, h('dt', {}, 'NFT ticket'), h('dd', {}, textoNft(b.nft))) : null),
    b.estado === 'expired' ? aviso('info', 'The deposit was not paid in time and the slot was released. You can book again.') : null,
    b.estado === 'confirmed' ? aviso('ok', 'Slot confirmed. If you need to cancel, we show you how much you get back before you confirm.') : null);
  const c = S.confirmando;
  if (c && c.id === b.id) {
    card.append(
      aviso(c.ok ? 'atencion' : 'error', c.ok ? [h('strong', {}, titularCancelacion(c)), c.motivo] : c.motivo),
      h('div', { class: 'acciones' },
        c.ok ? h('button', { class: 'btn btn-peligro', type: 'button', onclick: () => cancelar(b.id), ...(c.enviando ? { 'aria-busy': 'true' } : {}) }, 'Yes, cancel my booking') : null,
        h('button', { class: 'btn btn-secundario', type: 'button', onclick: () => { S.confirmando = null; renderMias(); } }, 'Back')));
    return card;
  }
  if (activa && valida) {
    card.append(h('div', { class: 'acciones' },
      b.estado === 'held' ? h('a', { class: 'btn btn-primario', href: safeHref(`/pagar/${b.id}`) }, 'Pay the deposit') : h('a', { class: 'btn btn-secundario', href: safeHref(`/pagar/${b.id}`) }, 'View receipt'),
      h('button', { class: 'btn btn-peligro-suave', type: 'button', onclick: () => previsualizar(b.id) }, 'Cancel')));
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
    S.mensaje = aviso('ok', h('strong', {}, 'Booking cancelled.'), r.motivo, r.devolucion && r.devolucion !== '$ 0' ? ` We refund ${r.devolucion}: it goes back to the same wallet you paid with.` : '');
  } catch (err) {
    S.mensaje = aviso('error', h('strong', {}, 'Could not cancel'), errorDeRed(err));
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
    S.bill.mensaje = aviso('atencion', h('strong', {}, 'Too much time has passed'), 'For security, the connection to your wallet lasts a few minutes. Connect it again to see your bookings.');
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
  if (err?.code === 4001 || /user rejected|user denied|rejected the request/i.test(err?.message ?? '')) return aviso('info', h('strong', {}, 'You did not sign'), 'Nothing happened and nothing was charged. You can try again whenever you like.');
  if (err?.code === -32002) return aviso('atencion', h('strong', {}, 'Your wallet has an open request'), 'Open it and answer that request first.');
  return aviso('error', h('strong', {}, 'We could not verify your wallet'), err.status ? err.message : (err?.message ?? 'Please try again.'));
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
        h('div', { class: 'fila' }, icono('wallet'), h('strong', {}, 'Wallet connected'), h('span', { class: 'mono apagado' }, abreviar(b.direccion))),
        h('button', { class: 'btn btn-fantasma btn-chico', type: 'button', onclick: () => { desconectarBilletera(); renderBilletera(); renderMias(); } }, 'Disconnect')),
      h('p', { class: 'apagado', role: 'status' }, b.reservas.length === 0
        ? 'We found no bookings paid with this wallet.'
        : `We found ${b.reservas.length} paid ${b.reservas.length === 1 ? 'booking' : 'bookings'} with this wallet. You can see them below, on any device.`)));
    return;
  }
  if (!window.ethereum) {
    setChildren($('#billetera'), h('div', { class: 'tarjeta tarjeta--suave pila--chica' },
      h('div', { class: 'fila' }, icono('wallet'), h('strong', {}, 'Did you pay with your wallet?')),
      h('p', { class: 'apagado' }, 'Open this page from your wallet\'s browser (MetaMask, MiniPay…) and you will see your bookings from any phone or computer.')));
    return;
  }
  setChildren($('#billetera'), h('div', { class: 'tarjeta pila--chica' },
    h('div', { class: 'fila' }, icono('wallet'), h('h3', {}, 'See my bookings with my wallet')),
    h('p', { class: 'apagado' }, 'You sign a message (it costs nothing and moves no money) and we show you every booking you paid with that wallet, from any device.'),
    b.mensaje,
    h('button', { class: 'btn btn-secundario btn-bloque', type: 'button', id: 'conectar-billetera', onclick: conectarBilletera, ...(b.conectando ? { 'aria-busy': 'true' } : {}) }, b.conectando ? 'Waiting for your signature…' : 'Connect wallet')));
}

init().catch((err) => {
  setChildren($('#turnos'), aviso('error', h('strong', {}, 'We could not load the page'), errorDeRed(err),
    h('div', { class: 'acciones' }, h('button', { class: 'btn btn-secundario', type: 'button', onclick: () => location.reload() }, 'Reload'))));
  $('#turnos').setAttribute('aria-busy', 'false');
});
