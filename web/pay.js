// Página de pago para personas: conecta la billetera del navegador (MetaMask, MiniPay, etc.) y paga la seña con x402.
// Se compila con `npm run build:web` a public/pay.bundle.js.
// Las pantallas se arman con el DOM (nunca con HTML armado a mano): lo que viene del servidor entra como texto.
import { createPublicClient, createWalletClient, custom, http, erc20Abi } from 'viem';
import { celo } from 'viem/chains';
import { toClientEvmSigner } from '@x402/evm';
import { createPayingFetch, readPaymentResponse, readPermit2Allowance, permit2ApprovalTx } from '../src/buyer.js';
import { WARS } from '../src/constants.js';
import {
  h, $, setChildren, request, ahoraServidor, abreviar, carteles, barraCliente, aviso, icono, estadoEtiqueta, isTxHash, safeHref, vacio, cargando,
} from '../public/dom.js';

const RPC = 'https://forno.celo.org';
const CELO_HEX = '0xa4ec';
const bookingId = location.pathname.split('/').filter(Boolean).pop();
const publicClient = createPublicClient({ chain: celo, transport: http(RPC) });

const E = {
  negocio: null, booking: null, vista: 'cargando', fallo: null,
  cuenta: null, saldo: null, redOk: true, conectando: false, pagando: false, aprobando: false, necesitaAprobar: false,
  mensaje: null, copiado: false, pagoTx: null,
};
let walletClient = null;
let reloj = null;
let cuentaEl = null;

const pesos = (wei) => `$ ${(Number(BigInt(wei) / 10n ** 16n) / 100).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const nbsp = (s) => String(s).replace('$ ', '$ ');
const errorDeRed = (err) => (err.status ? err.message : 'No pudimos conectarnos. Revisá tu conexión y probá de nuevo.');

// --- Carga ----------------------------------------------------------------------------------------------------

async function cargar() {
  try {
    const [negocio, r] = await Promise.all([E.negocio ? E.negocio : request('GET', '/api/negocio'), request('GET', `/api/reservas/${bookingId}`)]);
    E.negocio = negocio;
    E.booking = r.reserva;
    E.fallo = null;
    E.vista = vistaDe(r.reserva);
  } catch (err) {
    if (err.status === 404) E.vista = 'noexiste';
    else { E.vista = 'red'; E.fallo = errorDeRed(err); }
  }
  render();
}

function vistaDe(b) {
  if (b.estado === 'confirmed' || b.estado === 'completed') return 'pagada';
  if (b.estado === 'expired') return 'vencida';
  if (b.estado === 'cancelled') return 'cancelada';
  if (b.venceEl && Date.parse(b.venceEl) <= ahoraServidor()) return 'vencida';
  return 'pagar';
}

function setPaso(listo) {
  const items = [...$('#pasos').children];
  items.forEach((li, i) => {
    li.removeAttribute('aria-current'); li.removeAttribute('data-hecho');
    if (listo ? i <= 3 : i < 2) li.setAttribute('data-hecho', '');
    if (!listo && i === 2) li.setAttribute('aria-current', 'step');
    if (listo && i === 3) li.setAttribute('aria-current', 'step');
  });
}

// --- Pantallas -------------------------------------------------------------------------------------------------

function resumen(b, { pagada = false } = {}) {
  return h('dl', { class: 'resumen' },
    h('div', {}, h('dt', {}, 'Turno'), h('dd', {}, `${b.recurso} · ${b.inicioLocal}`)),
    pagada ? h('div', {}, h('dt', {}, 'Seña pagada'), h('dd', { class: 'num' }, nbsp(b.sena.texto), ' ', h('span', { class: 'monto-token' }, 'en wARS'))) : null,
    h('div', {}, h('dt', {}, 'Reserva'), h('dd', { class: 'mono' }, b.id)));
}

function politica() {
  return h('details', {}, h('summary', {}, '¿Qué pasa si cancelo?'), h('ul', { class: 'pila--chica' }, (E.negocio?.politica ?? []).map((p) => h('li', {}, p))));
}

function vistaPagar() {
  const b = E.booking;
  const prueba = Boolean(E.negocio?.modoPrueba);
  const falta = !prueba && E.saldo !== null && E.saldo < BigInt(b.sena.wei);
  const nodes = [];

  nodes.push(h('div', { class: 'tarjeta tarjeta--realzada pila' }, h('div', { class: 'dato' }, h('span', { class: 'dato-etiqueta' }, 'Pagás'), h('span', { class: 'dato-valor' }, nbsp(b.sena.texto)), h('span', { class: 'monto-token' }, 'en wARS, el peso argentino digital')), resumen(b)));

  cuentaEl = h('div', { class: 'cuenta', role: 'timer', 'aria-label': 'Tiempo que queda para pagar' }, h('div', { class: 'cuenta-tiempo num' }, '--:--'), h('div', { class: 'cuenta-texto' }, `Tenés ${E.negocio.reservaSinPagarMinutos} minutos para pagar la seña`));
  nodes.push(cuentaEl);
  actualizarCuenta();

  // Billetera
  const wallet = h('div', { class: 'tarjeta pila' }, h('h2', {}, 'Pagá con tu billetera'));
  if (E.mensaje) wallet.append(E.mensaje);
  if (!window.ethereum) {
    wallet.append(
      aviso('atencion', h('strong', {}, 'No encontramos una billetera en este navegador'),
        'Para pagar necesitás una billetera como MetaMask o MiniPay. Abrí este mismo link desde el navegador de tu billetera.'),
      h('button', { class: 'btn btn-secundario btn-bloque', type: 'button', onclick: copiarLink }, icono('external'), E.copiado ? '¡Link copiado!' : 'Copiar el link para abrirlo en mi billetera'));
  } else if (!E.cuenta) {
    wallet.append(
      h('p', { class: 'apagado' }, 'Conectá tu billetera para ver tu saldo y firmar el pago. No cuesta comisión de red.'),
      h('button', { class: 'btn btn-primario btn-grande btn-bloque', type: 'button', onclick: conectar, ...(E.conectando ? { 'aria-busy': 'true' } : {}) }, icono('wallet'), E.conectando ? 'Conectando…' : 'Conectar mi billetera'));
  } else {
    wallet.append(h('dl', { class: 'resumen' },
      h('div', {}, h('dt', {}, 'Billetera'), h('dd', { class: 'mono' }, abreviar(E.cuenta))),
      h('div', {}, h('dt', {}, 'Tu saldo'), h('dd', { class: 'num' }, E.saldo === null ? '—' : `${nbsp(pesos(E.saldo))} en wARS`))));
    if (!E.redOk) {
      wallet.append(aviso('atencion', h('strong', {}, 'Tu billetera está en otra red'), 'Para pagar tiene que estar en la red Celo.'),
        h('button', { class: 'btn btn-primario btn-grande btn-bloque', type: 'button', onclick: cambiarRed }, 'Cambiar a la red Celo'));
    } else if (falta) {
      wallet.append(aviso('atencion', h('strong', {}, 'No te alcanza el saldo'), `Te faltan ${nbsp(pesos(BigInt(b.sena.wei) - E.saldo))} en wARS para pagar la seña.`),
        h('a', { class: 'btn btn-primario btn-grande btn-bloque', href: rampa(), target: '_blank', rel: 'noopener noreferrer' }, icono('external'), 'Cargar pesos con Ripio'),
        h('button', { class: 'btn btn-secundario btn-bloque', type: 'button', onclick: async () => { await refrescarBilletera(); render(); } }, 'Ya cargué, revisar de nuevo'));
    } else if (E.necesitaAprobar) {
      wallet.append(aviso('info', h('strong', {}, 'Un paso más, una sola vez'), 'Hay que habilitar wARS para pagar sin comisión de red. Se hace una vez y cuesta unos centavos de CELO.'),
        h('button', { class: 'btn btn-primario btn-grande btn-bloque', type: 'button', onclick: aprobar, ...(E.aprobando ? { 'aria-busy': 'true' } : {}) }, E.aprobando ? 'Habilitando…' : 'Habilitar wARS'));
    } else {
      wallet.append(h('button', { class: 'btn btn-primario btn-grande btn-bloque', type: 'button', onclick: pagar, ...(E.pagando ? { 'aria-busy': 'true' } : {}) },
        E.pagando ? 'Pagando…' : `Pagar ${nbsp(b.sena.texto)}`));
      if (E.pagando) wallet.append(aviso('info', h('strong', {}, 'Estamos procesando tu pago'), 'Firmá en tu billetera y esperá unos segundos. No cierres esta página.'));
    }
  }
  nodes.push(wallet);

  if (prueba) {
    nodes.push(h('div', { class: 'tarjeta pila' }, h('h2', {}, 'Probar sin billetera'),
      aviso('info', h('strong', {}, 'MODO PRUEBA'), 'Podés recorrer todo el pago sin billetera ni plata: usamos una billetera de prueba y el mismo camino que un pago de verdad.'),
      h('button', { class: 'btn btn-secundario btn-bloque', type: 'button', id: 'pago-prueba', onclick: pagoDePrueba, ...(E.pagando ? { 'aria-busy': 'true' } : {}) }, 'Pagar de prueba')));
  }

  nodes.push(h('details', {}, h('summary', {}, '¿No tenés wARS?'),
    h('div', { class: 'pila--chica' },
      h('p', {}, 'wARS es el peso argentino digital: 1 wARS vale 1 peso. Podés cargarlo con pesos desde tu cuenta bancaria o Mercado Pago a través de Ripio.'),
      h('a', { class: 'btn btn-secundario', href: rampa(), target: '_blank', rel: 'noopener noreferrer' }, icono('external'), 'Cargar pesos con Ripio'),
      h('p', { class: 'apagado chica' }, 'Cuando termines, volvé a esta página: tu reserva te espera mientras corra el tiempo.'))));
  nodes.push(politica());
  return nodes;
}

function vistaPagada() {
  const b = E.booking;
  const tx = E.pagoTx ?? b.pagoTx;
  const real = isTxHash(tx) && !E.negocio.modoPrueba;
  return [
    h('div', { class: 'comprobante pila' }, h('h2', {}, '¡Tu turno quedó confirmado!'), resumen(b, { pagada: true }),
      h('dl', { class: 'resumen' }, h('div', {}, h('dt', {}, 'Comprobante'), h('dd', {}, real ? h('a', { href: safeHref(`https://celoscan.io/tx/${tx}`), target: '_blank', rel: 'noopener noreferrer' }, abreviar(tx)) : (tx ? h('span', { class: 'mono' }, `${abreviar(tx)} (simulado)`) : '—'))))),
    aviso('info', h('strong', {}, 'Si necesitás cancelar'), 'Entrá a "Mis reservas": antes de confirmar te mostramos cuánto te devolvemos y por qué. Desde cualquier dispositivo la ves conectando la billetera con la que pagaste.'),
    h('div', { class: 'acciones' }, h('a', { class: 'btn btn-primario', href: '/#mis-reservas' }, 'Ver mis reservas'), h('a', { class: 'btn btn-secundario', href: '/' }, 'Reservar otro turno')),
    politica(),
  ];
}

const vistaVencida = () => [vacio({ icon: 'hourglass', titulo: 'Se venció el tiempo para pagar', texto: 'El turno se liberó para que lo pueda tomar otra persona. Si todavía lo querés, reservalo de nuevo.', accion: h('a', { class: 'btn btn-primario', href: '/' }, 'Reservar de nuevo') })];
const vistaCancelada = () => [vacio({ icon: 'x', titulo: 'Esta reserva está cancelada', texto: 'No hace falta pagar nada. Podés elegir otro turno cuando quieras.', accion: h('a', { class: 'btn btn-primario', href: '/' }, 'Elegir otro turno') })];
const vistaNoExiste = () => [vacio({ icon: 'search', titulo: 'No encontramos esa reserva', texto: 'Revisá que el link esté completo. Si reservaste desde este navegador, la ves en "Mis reservas".', accion: h('a', { class: 'btn btn-primario', href: '/#mis-reservas' }, 'Ir a mis reservas') })];
const vistaRed = () => [aviso('error', h('strong', {}, 'No pudimos cargar tu reserva'), E.fallo, h('div', { class: 'acciones' }, h('button', { class: 'btn btn-secundario', type: 'button', onclick: () => { E.vista = 'cargando'; render(); cargar(); } }, 'Probar de nuevo')))];

function render() {
  if (E.negocio) setChildren($('#carteles'), carteles(E.negocio));
  setChildren($('#barra'), barraCliente());
  const pagada = E.vista === 'pagada';
  setPaso(pagada);
  $('#titulo').textContent = pagada ? '¡Listo, estás adentro!' : 'Pagá la seña';
  $('#subtitulo').textContent = pagada ? 'Tu turno está confirmado.' : (E.vista === 'pagar' ? 'Es el último paso para confirmar tu turno.' : '');
  document.title = `${pagada ? 'Turno confirmado' : 'Pagá la seña'} · Seña`;
  const vistas = { pagar: vistaPagar, pagada: vistaPagada, vencida: vistaVencida, cancelada: vistaCancelada, noexiste: vistaNoExiste, red: vistaRed, cargando: () => [cargando('Cargando tu reserva…')] };
  clearInterval(reloj);
  cuentaEl = null;
  setChildren($('#vista'), vistas[E.vista]());
  if (E.vista === 'pagar') reloj = setInterval(actualizarCuenta, 500);
}

function actualizarCuenta() {
  if (!cuentaEl || !E.booking?.venceEl) return;
  const ms = Date.parse(E.booking.venceEl) - ahoraServidor();
  const total = Math.max(0, Math.ceil(ms / 1000));
  if (ms <= 0 && !E.pagando) { E.vista = 'vencida'; render(); return; }
  const tiempo = cuentaEl.firstChild;
  tiempo.textContent = `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  const urgente = total <= 120;
  if (urgente) cuentaEl.setAttribute('data-urgente', ''); else cuentaEl.removeAttribute('data-urgente');
  cuentaEl.lastChild.textContent = urgente ? 'Se está por vencer: pagá ahora o el turno se libera' : `Tenés ${Math.ceil(total / 60)} minutos para pagar la seña`;
}

// --- Billetera -------------------------------------------------------------------------------------------------

const rampa = () => `https://ramp.ripio.com/?country=AR&chain=42220&token=WARS${E.cuenta ? `&address=${E.cuenta}` : ''}`;

function mensajeDeBilletera(err, fallback) {
  if (err?.code === 4001 || /user rejected|user denied|rejected the request/i.test(err?.message ?? '')) return aviso('info', h('strong', {}, 'No aceptaste en tu billetera'), 'No pasó nada ni se cobró nada. Podés intentar de nuevo cuando quieras.');
  if (err?.code === -32002) return aviso('atencion', h('strong', {}, 'Tu billetera tiene un pedido abierto'), 'Abrila y respondé ese pedido primero.');
  return aviso('error', h('strong', {}, fallback), err?.shortMessage ?? err?.message ?? 'Probá de nuevo.');
}

async function refrescarBilletera() {
  if (!E.cuenta) return;
  const chainId = await window.ethereum.request({ method: 'eth_chainId' });
  E.redOk = Number(chainId) === celo.id;
  E.saldo = null;
  if (E.redOk) {
    E.saldo = await publicClient.readContract({ address: WARS.address, abi: erc20Abi, functionName: 'balanceOf', args: [E.cuenta] }).catch(() => null);
  }
}

async function conectar() {
  E.conectando = true; E.mensaje = null; render();
  try {
    [E.cuenta] = await window.ethereum.request({ method: 'eth_requestAccounts' });
    walletClient = createWalletClient({ account: E.cuenta, chain: celo, transport: custom(window.ethereum) });
    await refrescarBilletera();
  } catch (err) {
    E.cuenta = null;
    E.mensaje = mensajeDeBilletera(err, 'No pudimos conectar tu billetera');
  }
  E.conectando = false; render();
}

async function cambiarRed() {
  E.mensaje = null;
  try {
    try {
      await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CELO_HEX }] });
    } catch (err) {
      if (err.code !== 4902) throw err;
      await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [{ chainId: CELO_HEX, chainName: 'Celo', nativeCurrency: { name: 'CELO', symbol: 'CELO', decimals: 18 }, rpcUrls: [RPC], blockExplorerUrls: ['https://celoscan.io'] }] });
    }
    await refrescarBilletera();
  } catch (err) {
    E.mensaje = mensajeDeBilletera(err, 'No pudimos cambiar de red');
  }
  render();
}

async function copiarLink() {
  try { await navigator.clipboard.writeText(location.href); E.copiado = true; } catch { window.prompt('Copiá este link:', location.href); }
  render();
}

async function aprobar() {
  E.aprobando = true; E.mensaje = null; render();
  try {
    const tx = permit2ApprovalTx();
    const hash = await walletClient.sendTransaction({ account: E.cuenta, to: tx.to, data: tx.data });
    await publicClient.waitForTransactionReceipt({ hash });
    E.necesitaAprobar = false;
    E.mensaje = aviso('ok', h('strong', {}, 'Listo, wARS habilitado'), 'Ahora tocá "Pagar".');
  } catch (err) {
    E.mensaje = mensajeDeBilletera(err, 'No se pudo habilitar wARS');
  }
  E.aprobando = false; render();
}

// --- Pagos ---------------------------------------------------------------------------------------------------------

async function terminarPago(tx) {
  E.pagoTx = tx ?? null;
  E.pagando = false;
  await cargar();
  if (E.vista !== 'pagada') { E.booking = { ...E.booking, estado: 'confirmed' }; E.vista = 'pagada'; render(); }
  $('#titulo').focus();
}

async function pagar() {
  E.pagando = true; E.mensaje = null; render();
  try {
    const signer = toClientEvmSigner({ address: E.cuenta, signTypedData: (msg) => walletClient.signTypedData({ account: E.cuenta, ...msg }) }, publicClient);
    const payingFetch = createPayingFetch({ signer, maxPerPaymentWei: BigInt(E.booking.sena.wei), rpcUrl: RPC });
    // Ruta relativa al sitio actual: funciona igual desde localhost, un túnel o el dominio final.
    const res = await payingFetch(new URL(E.booking.pagarEn, location.origin).pathname, { method: 'POST' });
    if (res.ok) { await terminarPago(readPaymentResponse(res)?.transaction); return; }
    const body = await res.json().catch(() => ({}));
    E.pagando = false;
    if (res.status === 409) { await cargar(); return; } // ya estaba pagada
    if (res.status === 410) { E.vista = 'vencida'; render(); return; }
    // Si falta la habilitación de Permit2 y el token no permite hacerla sin gas, se ofrece hacerla a mano.
    const allowance = await readPermit2Allowance(publicClient, E.cuenta).catch(() => null);
    if (allowance !== null && allowance < BigInt(E.booking.sena.wei)) {
      E.necesitaAprobar = true;
      E.mensaje = aviso('atencion', h('strong', {}, 'Falta un paso antes del primer pago'), 'Tocá "Habilitar wARS" y después volvé a tocar "Pagar".');
    } else {
      E.mensaje = aviso('error', h('strong', {}, 'No se pudo completar el pago'), `${body.error ?? body.errorReason ?? body.invalidReason ?? 'Probá de nuevo en un momento.'} No se cobró nada.`);
    }
  } catch (err) {
    E.pagando = false;
    E.mensaje = mensajeDeBilletera(err, 'No se pudo completar el pago');
  }
  render();
}

async function pagoDePrueba() {
  E.pagando = true; E.mensaje = null; render();
  try {
    const r = await request('POST', `/api/modo-prueba/pagar/${bookingId}`, {});
    await terminarPago(r.tx);
    return;
  } catch (err) {
    E.pagando = false;
    if (err.status === 410) E.vista = 'vencida';
    else if (err.status === 409) { await cargar(); return; }
    else E.mensaje = aviso('error', h('strong', {}, 'No se pudo hacer el pago de prueba'), errorDeRed(err));
  }
  render();
}

if (window.ethereum?.on) {
  window.ethereum.on('accountsChanged', async (a) => { E.cuenta = a[0] ?? null; if (E.cuenta) { walletClient = createWalletClient({ account: E.cuenta, chain: celo, transport: custom(window.ethereum) }); await refrescarBilletera(); } render(); });
  window.ethereum.on('chainChanged', async () => { await refrescarBilletera(); render(); });
}

render();
cargar();
