// Registro público de decisiones del agente. Los datos entran siempre como texto.
import { h, $, setChildren, request, carteles, barraCliente, aviso, esqueletos, vacio } from '/static/dom.js';
import { GRUPOS, grupoDe, agruparPorDia, tarjetaDecision } from '/static/decisiones-vista.js';

const S = { negocio: null, resumen: null, decisiones: [], grupo: '', cargando: true, error: null };
const errorDeRed = (err) => (err.status ? err.message : 'No pudimos conectarnos. Revisá tu conexión y probá de nuevo.');

const nbsp = (s) => String(s).replace('$ ', '$ ');

function renderNumeros() {
  const r = S.resumen;
  const el = $('#numeros');
  el.setAttribute('aria-busy', 'false');
  if (!r) { setChildren(el); return; }
  const dato = (valor, texto) => h('div', { class: 'estadistica' }, h('strong', { class: 'num' }, valor), h('span', {}, texto));
  setChildren(el,
    dato(r.decisiones, r.decisiones === 1 ? 'decisión registrada' : 'decisiones registradas'),
    dato(r.senasCobradas, r.senasCobradas === 1 ? 'seña cobrada' : 'señas cobradas'),
    dato(nbsp(r.montoDevuelto), `devuelto (${r.devolucionesEnviadas} ${r.devolucionesEnviadas === 1 ? 'devolución' : 'devoluciones'})`),
    dato(r.turnosReubicados, r.turnosReubicados === 1 ? 'turno ofrecido a la lista de espera' : 'turnos ofrecidos a la lista de espera'),
    dato(r.reservasLiberadas, r.reservasLiberadas === 1 ? 'reserva liberada por falta de pago' : 'reservas liberadas por falta de pago'));
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
    setChildren(lista, aviso('error', h('strong', {}, 'No pudimos cargar el registro'), S.error,
      h('div', { class: 'acciones' }, h('button', { class: 'btn btn-secundario', type: 'button', onclick: cargar }, 'Probar de nuevo'))));
    return;
  }
  const visibles = S.decisiones.filter((d) => !S.grupo || grupoDe(d) === S.grupo);
  if (visibles.length === 0) {
    setChildren(lista, vacio({
      icon: 'doc', titulo: S.decisiones.length ? 'No hay decisiones de este tipo' : 'Todavía no hay decisiones',
      texto: S.decisiones.length ? 'Probá con otro filtro.' : 'Apenas alguien reserve, pague o cancele un turno, lo vas a ver acá.',
      accion: S.decisiones.length ? null : h('a', { class: 'btn btn-primario', href: '/' }, 'Reservar un turno'),
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
