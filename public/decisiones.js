// Public log de decisiones del agente. Los datos entran siempre como texto.
import { h, $, setChildren, request, safeHref, carteles, barraCliente, aviso, esqueletos, vacio } from '/static/dom.js';
import { GRUPOS, grupoDe, agruparPorDia, tarjetaDecision } from '/static/decisiones-vista.js';

const S = { negocio: null, resumen: null, decisiones: [], grupo: '', cargando: true, error: null };
const errorDeRed = (err) => (err.status ? err.message : 'We could not connect. Check your connection and try again.');

const nbsp = (s) => String(s).replace('$ ', '$ ');

function renderNumeros() {
  const r = S.resumen;
  const el = $('#numeros');
  el.setAttribute('aria-busy', 'false');
  if (!r) { setChildren(el); return; }
  const dato = (valor, texto) => h('div', { class: 'estadistica' }, h('strong', { class: 'num' }, valor), h('span', {}, texto));
  setChildren(el,
    dato(r.decisiones, r.decisiones === 1 ? 'decision logged' : 'decisions logged'),
    dato(r.senasCobradas, r.senasCobradas === 1 ? 'deposit collected' : 'deposits collected'),
    dato(nbsp(r.montoDevuelto), `refunded (${r.devolucionesEnviadas} ${r.devolucionesEnviadas === 1 ? 'refund' : 'refunds'})`),
    dato(r.turnosReubicados, r.turnosReubicados === 1 ? 'slot offered to the waitlist' : 'slots offered to the waitlist'),
    dato(r.reservasLiberadas, r.reservasLiberadas === 1 ? 'booking released for non-payment' : 'bookings released for non-payment'));
}

function renderReglas() {
  const n = S.negocio;
  const ul = $('#reglas');
  // Las reglas vienen redactadas por el servidor, a partir de la configuración vigente.
  setChildren(ul, n.politica.map((p) => h('li', {}, p)));
}

function renderFiltros() {
  const cuenta = (g) => (g ? S.decisiones.filter((d) => grupoDe(d) === g).length : S.decisiones.length);
  setChildren($('#filtros'), GRUPOS.map(([id, label]) => h('button', {
    class: 'pestana', type: 'button', 'aria-pressed': String(S.grupo === id), onclick: () => { S.grupo = id; renderFiltros(); renderLista(); },
  }, `${label} (${cuenta(id)})`)));
}

function renderLista() {
  const lista = $('#lista');
  lista.setAttribute('aria-busy', String(S.cargando));
  if (S.cargando) { setChildren(lista, esqueletos()); return; }
  if (S.error) {
    setChildren(lista, aviso('error', h('strong', {}, 'We could not load the log'), S.error,
      h('div', { class: 'acciones' }, h('button', { class: 'btn btn-secundario', type: 'button', onclick: cargar }, 'Try again'))));
    return;
  }
  const visibles = S.decisiones.filter((d) => !S.grupo || grupoDe(d) === S.grupo);
  if (visibles.length === 0) {
    setChildren(lista, vacio({
      icon: 'doc', titulo: S.decisiones.length ? 'No decisions of this type' : 'No decisions yet',
      texto: S.decisiones.length ? 'Try another filter.' : 'As soon as someone books, pays or cancels a slot, you will see it here.',
      accion: S.decisiones.length ? null : h('a', { class: 'btn btn-primario', href: '/' }, 'Book a slot'),
    }));
    return;
  }
  setChildren(lista, agruparPorDia(visibles).map((g) => h('section', {}, h('h3', { class: 'dia-grupo' }, g.etiqueta),
    h('div', { class: 'pila--chica' }, g.items.map((d) => tarjetaDecision(d, { modoPrueba: S.negocio.modoPrueba }))))));
}

async function cargar() {
  S.cargando = true; S.error = null; renderLista();
  try {
    const [negocio, resumen, data] = await Promise.all([request('GET', '/api/negocio'), request('GET', '/api/resumen-publico'), request('GET', '/api/decisiones?limit=150')]);
    S.negocio = negocio; S.resumen = resumen; S.decisiones = data.decisiones;
    if (negocio.celoscanWars) { $('#celoscan-link').href = safeHref(negocio.celoscanWars); $('#celoscan').hidden = false; }
    setChildren($('#carteles'), carteles(negocio));
    renderReglas(); renderNumeros();
  } catch (err) {
    S.error = errorDeRed(err);
  }
  S.cargando = false;
  renderFiltros(); renderLista();
}

setChildren($('#barra'), barraCliente());
setChildren($('#numeros'), [1, 2, 3, 4].map(() => h('div', { class: 'esqueleto esqueleto--bloque', 'aria-hidden': 'true' })));
cargar();
setInterval(() => { if (!document.hidden && !S.cargando) request('GET', '/api/decisiones?limit=150').then((d) => { S.decisiones = d.decisiones; renderFiltros(); renderLista(); }).catch(() => {}); }, 30_000);
