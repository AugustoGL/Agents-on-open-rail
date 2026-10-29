// Payment page for people: conecta la billetera del navegador (MetaMask, MiniPay, etc.) y paga la seña con x402.
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
  mensaje: null, copiado: false, pagoTx: null, nftMeta: null, nftMensaje: null, nftVigilando: 0,
};
let walletClient = null;
let reloj = null;
let relojNft = null;
let cuentaEl = null;

const pesos = (wei) => `$ ${(Number(BigInt(wei) / 10n ** 16n) / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const nbsp = (s) => String(s).replace('$ ', '$ ');
const errorDeRed = (err) => (err.status ? err.message : 'We could not connect. Check your connection and try again.');

// --- Carga ----------------------------------------------------------------------------------------------------

async function cargar() {
  try {
    const [negocio, r] = await Promise.all([E.negocio ? E.negocio : request('GET', '/api/negocio'), request('GET', `/api/reservas/${bookingId}`)]);
    E.negocio = negocio;
    E.booking = r.reserva;
    E.fallo = null;
    E.vista = vistaDe(r.reserva);
    if (r.reserva.nft && !E.nftMeta) E.nftMeta = (await request('GET', `/api/reservas/${bookingId}/nft`).catch(() => ({}))).metadata ?? null;
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
    h('div', {}, h('dt', {}, 'Slot'), h('dd', {}, `${b.recurso} · ${b.inicioLocal}`)),
    pagada ? h('div', {}, h('dt', {}, 'Deposit paid'), h('dd', { class: 'num' }, nbsp(b.sena.texto), ' ', h('span', { class: 'monto-token' }, 'in wARS'))) : null,
    h('div', {}, h('dt', {}, 'Booking'), h('dd', { class: 'mono' }, b.id)));
}

function politica() {
  return h('details', {}, h('summary', {}, 'What happens if I cancel?'), h('ul', { class: 'pila--chica' }, (E.negocio?.politica ?? []).map((p) => h('li', {}, p))));
}

function vistaPagar() {
  const b = E.booking;
  const prueba = Boolean(E.negocio?.modoPrueba);
  const falta = !prueba && E.saldo !== null && E.saldo < BigInt(b.sena.wei);
  const nodes = [];

  nodes.push(h('div', { class: 'tarjeta tarjeta--realzada pila' }, h('div', { class: 'dato' }, h('span', { class: 'dato-etiqueta' }, 'You pay'), h('span', { class: 'dato-valor' }, nbsp(b.sena.texto)), h('span', { class: 'monto-token' }, 'in wARS, the digital Argentine peso')), resumen(b)));

  cuentaEl = h('div', { class: 'cuenta', role: 'timer', 'aria-label': 'Time left to pay' }, h('div', { class: 'cuenta-tiempo num' }, '--:--'), h('div', { class: 'cuenta-texto' }, `You have ${E.negocio.reservaSinPagarMinutos} minutes to pay the deposit`));
  nodes.push(cuentaEl);
  actualizarCuenta();

  // Billetera
  const wallet = h('div', { class: 'tarjeta pila' }, h('h2', {}, 'Pay with your wallet'));
  if (E.mensaje) wallet.append(E.mensaje);
  if (!window.ethereum) {
    wallet.append(
      aviso('atencion', h('strong', {}, 'We could not find a wallet in this browser'),
        'To pay you need a wallet such as MetaMask or MiniPay. Open this same link from your wallet\'s browser.'),
      h('button', { class: 'btn btn-secundario btn-bloque', type: 'button', onclick: copiarLink }, icono('external'), E.copiado ? 'Link copied!' : 'Copy the link to open it in my wallet'));
  } else if (!E.cuenta) {
    wallet.append(
      h('p', { class: 'apagado' }, 'Connect your wallet to see your balance and sign the payment. There is no network fee.'),
      h('button', { class: 'btn btn-primario btn-grande btn-bloque', type: 'button', onclick: conectar, ...(E.conectando ? { 'aria-busy': 'true' } : {}) }, icono('wallet'), E.conectando ? 'Connecting…' : 'Connect my wallet'));
  } else {
    wallet.append(h('dl', { class: 'resumen' },
      h('div', {}, h('dt', {}, 'Wallet'), h('dd', { class: 'mono' }, abreviar(E.cuenta))),
      h('div', {}, h('dt', {}, 'Your balance'), h('dd', { class: 'num' }, E.saldo === null ? '—' : `${nbsp(pesos(E.saldo))} in wARS`))));
    if (!E.redOk) {
      wallet.append(aviso('atencion', h('strong', {}, 'Your wallet is on another network'), 'To pay it has to be on the Celo network.'),
        h('button', { class: 'btn btn-primario btn-grande btn-bloque', type: 'button', onclick: cambiarRed }, 'Switch to the Celo network'));
    } else if (falta) {
      wallet.append(aviso('atencion', h('strong', {}, 'Your balance is not enough'), `You are short ${nbsp(pesos(BigInt(b.sena.wei) - E.saldo))} in wARS to pay the deposit.`),
        h('a', { class: 'btn btn-primario btn-grande btn-bloque', href: rampa(), target: '_blank', rel: 'noopener noreferrer' }, icono('external'), 'Add pesos with Ripio'),
        h('button', { class: 'btn btn-secundario btn-bloque', type: 'button', onclick: async () => { await refrescarBilletera(); render(); } }, 'I topped up, check again'));
    } else if (E.necesitaAprobar) {
      wallet.append(aviso('info', h('strong', {}, 'One more step, just once'), 'wARS has to be enabled to pay without a network fee. It is done once and costs a few cents of CELO.'),
        h('button', { class: 'btn btn-primario btn-grande btn-bloque', type: 'button', onclick: aprobar, ...(E.aprobando ? { 'aria-busy': 'true' } : {}) }, E.aprobando ? 'Enabling…' : 'Enable wARS'));
    } else {
      wallet.append(h('button', { class: 'btn btn-primario btn-grande btn-bloque', type: 'button', onclick: pagar, ...(E.pagando ? { 'aria-busy': 'true' } : {}) },
        E.pagando ? 'Paying…' : `Pay ${nbsp(b.sena.texto)}`));
      if (E.pagando) wallet.append(aviso('info', h('strong', {}, 'We are processing your payment'), 'Sign in your wallet and wait a few seconds. Do not close this page.'));
    }
  }
  nodes.push(wallet);

  if (prueba) {
    nodes.push(h('div', { class: 'tarjeta pila' }, h('h2', {}, 'Try without a wallet'),
      aviso('info', h('strong', {}, 'TEST MODE'), 'You can go through the whole payment with no wallet and no money: we use a test wallet and the same path as a real payment.',
        E.negocio?.nft ? (E.cuenta ? ` The NFT ticket goes to your wallet (${abreviar(E.cuenta)}).` : ' If you connect your wallet above, the NFT ticket goes to it.') : ''),
      h('button', { class: 'btn btn-secundario btn-bloque', type: 'button', id: 'pago-prueba', onclick: pagoDePrueba, ...(E.pagando ? { 'aria-busy': 'true' } : {}) }, 'Pay as a test')));
  }

  nodes.push(h('details', {}, h('summary', {}, 'Don\'t have wARS?'),
    h('div', { class: 'pila--chica' },
      h('p', {}, 'wARS is the digital Argentine peso: 1 wARS is worth 1 peso. You can load it with pesos from your bank account or Mercado Pago through Ripio.'),
      h('a', { class: 'btn btn-secundario', href: rampa(), target: '_blank', rel: 'noopener noreferrer' }, icono('external'), 'Add pesos with Ripio'),
      h('p', { class: 'apagado chica' }, 'When you are done, come back to this page: your booking waits for you while the time runs.'))));
  nodes.push(politica());
  return nodes;
}

function vistaPagada() {
  const b = E.booking;
  const tx = E.pagoTx ?? b.pagoTx;
  const real = isTxHash(tx) && !E.negocio.modoPrueba;
  return [
    h('div', { class: 'comprobante pila' }, h('h2', {}, 'Your slot is confirmed!'), resumen(b, { pagada: true }),
      h('dl', { class: 'resumen' }, h('div', {}, h('dt', {}, 'Receipt'), h('dd', {}, real ? h('a', { href: safeHref(`https://celoscan.io/tx/${tx}`), target: '_blank', rel: 'noopener noreferrer' }, abreviar(tx)) : (tx ? h('span', { class: 'mono' }, `${abreviar(tx)} (simulated)`) : '—'))))),
    ...tarjetaNft(),
    aviso('info', h('strong', {}, 'If you need to cancel'), 'Go to "My bookings": before you confirm we show how much we refund and why. From any device you can see it by connecting the wallet you paid with.'),
    h('div', { class: 'acciones' }, h('a', { class: 'btn btn-primario', href: '/#mis-reservas' }, 'See my bookings'), h('a', { class: 'btn btn-secundario', href: '/' }, 'Book another slot')),
    politica(),
  ];
}

// --- Ticket NFT ------------------------------------------------------------------------------------------------------

function tarjetaNft() {
  const n = E.booking?.nft;
  if (!n) return [];
  const nodos = [h('h2', {}, 'Your booking, as an NFT')];
  if (E.nftMeta) nodos.push(h('img', { class: 'ticket-imagen', src: E.nftMeta.image, alt: `Ticket for booking ${E.booking.id}: ${E.booking.recurso}, ${E.booking.inicioLocal}`, width: '600', height: '340' }));
  if (n.estado === 'enviando') nodos.push(aviso('info', h('strong', {}, 'We are sending the ticket to your wallet'), 'It takes a few seconds. You do not need to do anything: your booking is already confirmed.'));
  else if (n.estado === 'error') nodos.push(aviso('atencion', h('strong', {}, 'The ticket has not gone out yet'), 'Your booking is confirmed anyway. We keep trying to send it to your wallet.'));
  else nodos.push(aviso('ok', h('strong', {}, n.estado === 'jugado' ? 'Ticket for a slot already played' : 'It is already in your wallet'), `It is a non-transferable NFT ticket, for wallet ${abreviar(n.billetera)}.`));
  nodos.push(h('dl', { class: 'resumen' },
    h('div', {}, h('dt', {}, 'Wallet'), h('dd', { class: 'mono' }, abreviar(n.billetera))),
    h('div', {}, h('dt', {}, 'Network'), h('dd', {}, n.red))));
  if (n.simulado) nodos.push(aviso('info', h('strong', {}, 'Simulation'), 'In this demo the ticket is not on any real chain: this is how it would look in your wallet.'));
  if (E.nftMensaje) nodos.push(E.nftMensaje);
  const listo = n.estado === 'enviado' || n.estado === 'jugado';
  if (!n.simulado && listo) {
    nodos.push(h('div', { class: 'acciones' },
      h('a', { class: 'btn btn-secundario', href: safeHref(n.urlToken), target: '_blank', rel: 'noopener noreferrer' }, icono('external'), 'View in the explorer'),
      window.ethereum ? h('button', { class: 'btn btn-primario', type: 'button', onclick: agregarNft }, icono('wallet'), 'Add to my wallet') : null));
  }
  return [h('section', { class: 'tarjeta pila' }, nodos)];
}

async function agregarNft() {
  const n = E.booking.nft;
  E.nftMensaje = null;
  try {
    const chainId = `0x${n.chainId.toString(16)}`;
    try {
      await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
    } catch (err) {
      if (err.code !== 4902) throw err;
      await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [{ chainId, chainName: n.red, nativeCurrency: n.moneda, rpcUrls: [n.rpcUrl], blockExplorerUrls: [n.explorador] }] });
    }
    const ok = await window.ethereum.request({ method: 'wallet_watchAsset', params: { type: 'ERC721', options: { address: n.contrato, tokenId: n.tokenId } } });
    E.nftMensaje = ok ? aviso('ok', 'Done: you can now see it in your wallet, in the collectibles section.') : aviso('info', 'It was not added. You can view it in the explorer or try again.');
  } catch (err) {
    E.nftMensaje = mensajeDeBilletera(err, 'We could not add it to your wallet');
  }
  render();
}

/** Mientras el ticket sale, se revisa cada pocos segundos (hasta 2 minutos). */
async function vigilarNft() {
  clearInterval(relojNft);
  if (E.vista !== 'pagada' || E.booking?.nft?.estado !== 'enviando' || E.nftVigilando >= 40) return;
  relojNft = setInterval(async () => {
    E.nftVigilando += 1;
    try { const r = await request('GET', `/api/reservas/${bookingId}`); E.booking = r.reserva; } catch { return; }
    if (E.booking.nft?.estado !== 'enviando' || E.nftVigilando >= 40) { clearInterval(relojNft); render(); }
  }, 3000);
}

const vistaVencida = () => [vacio({ icon: 'hourglass', titulo: 'The time to pay has run out', texto: 'The slot was released so someone else can take it. If you still want it, book it again.', accion: h('a', { class: 'btn btn-primario', href: '/' }, 'Book again') })];
const vistaCancelada = () => [vacio({ icon: 'x', titulo: 'This booking is cancelled', texto: 'There is nothing to pay. You can pick another slot whenever you like.', accion: h('a', { class: 'btn btn-primario', href: '/' }, 'Pick another slot') })];
const vistaNoExiste = () => [vacio({ icon: 'search', titulo: 'We could not find that booking', texto: 'Check that the link is complete. If you booked from this browser, you can see it in "My bookings".', accion: h('a', { class: 'btn btn-primario', href: '/#mis-reservas' }, 'Go to my bookings') })];
const vistaRed = () => [aviso('error', h('strong', {}, 'We could not load your booking'), E.fallo, h('div', { class: 'acciones' }, h('button', { class: 'btn btn-secundario', type: 'button', onclick: () => { E.vista = 'cargando'; render(); cargar(); } }, 'Try again')))];

function render() {
  if (E.negocio) setChildren($('#carteles'), carteles(E.negocio));
  setChildren($('#barra'), barraCliente());
  const pagada = E.vista === 'pagada';
  setPaso(pagada);
  $('#titulo').textContent = pagada ? 'Done, you are in!' : 'Pay the deposit';
  $('#subtitulo').textContent = pagada ? 'Your slot is confirmed.' : (E.vista === 'pagar' ? 'This is the last step to confirm your slot.' : '');
  document.title = `${pagada ? 'Slot confirmed' : 'Pay the deposit'} · Seña`;
  const vistas = { pagar: vistaPagar, pagada: vistaPagada, vencida: vistaVencida, cancelada: vistaCancelada, noexiste: vistaNoExiste, red: vistaRed, cargando: () => [cargando('Loading your booking…')] };
  clearInterval(reloj);
  cuentaEl = null;
  setChildren($('#vista'), vistas[E.vista]());
  if (E.vista === 'pagar') reloj = setInterval(actualizarCuenta, 500);
  vigilarNft();
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
  cuentaEl.lastChild.textContent = urgente ? 'About to expire: pay now or the slot is released' : `You have ${Math.ceil(total / 60)} minutes to pay the deposit`;
}

// --- Billetera -------------------------------------------------------------------------------------------------

const rampa = () => `https://ramp.ripio.com/?country=AR&chain=42220&token=WARS${E.cuenta ? `&address=${E.cuenta}` : ''}`;

function mensajeDeBilletera(err, fallback) {
  if (err?.code === 4001 || /user rejected|user denied|rejected the request/i.test(err?.message ?? '')) return aviso('info', h('strong', {}, 'You did not approve in your wallet'), 'Nothing happened and nothing was charged. You can try again whenever you like.');
  if (err?.code === -32002) return aviso('atencion', h('strong', {}, 'Your wallet has an open request'), 'Open it and answer that request first.');
  return aviso('error', h('strong', {}, fallback), err?.shortMessage ?? err?.message ?? 'Please try again.');
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
    E.mensaje = mensajeDeBilletera(err, 'We could not connect your wallet');
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
    E.mensaje = mensajeDeBilletera(err, 'We could not switch networks');
  }
  render();
}

async function copiarLink() {
  try { await navigator.clipboard.writeText(location.href); E.copiado = true; } catch { window.prompt('Copy this link:', location.href); }
  render();
}

async function aprobar() {
  E.aprobando = true; E.mensaje = null; render();
  try {
    const tx = permit2ApprovalTx();
    const hash = await walletClient.sendTransaction({ account: E.cuenta, to: tx.to, data: tx.data });
    await publicClient.waitForTransactionReceipt({ hash });
    E.necesitaAprobar = false;
    E.mensaje = aviso('ok', h('strong', {}, 'Done, wARS enabled'), 'Now tap "Pay".');
  } catch (err) {
    E.mensaje = mensajeDeBilletera(err, 'Could not enable wARS');
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
      E.mensaje = aviso('atencion', h('strong', {}, 'One step is missing before the first payment'), 'Tap "Enable wARS" and then tap "Pay" again.');
    } else {
      E.mensaje = aviso('error', h('strong', {}, 'The payment could not be completed'), `${body.error ?? body.errorReason ?? body.invalidReason ?? 'Please try again in a moment.'} Nothing was charged.`);
    }
  } catch (err) {
    E.pagando = false;
    E.mensaje = mensajeDeBilletera(err, 'The payment could not be completed');
  }
  render();
}

async function pagoDePrueba() {
  E.pagando = true; E.mensaje = null; render();
  try {
    // Si hay una billetera conectada, el ticket NFT va a ella (el pago de prueba lo firma una billetera descartable).
    const r = await request('POST', `/api/modo-prueba/pagar/${bookingId}`, E.cuenta ? { billetera: E.cuenta } : {});
    await terminarPago(r.tx);
    return;
  } catch (err) {
    E.pagando = false;
    if (err.status === 410) E.vista = 'vencida';
    else if (err.status === 409) { await cargar(); return; }
    else E.mensaje = aviso('error', h('strong', {}, 'The test payment could not be made'), errorDeRed(err));
  }
  render();
}

if (window.ethereum?.on) {
  window.ethereum.on('accountsChanged', async (a) => { E.cuenta = a[0] ?? null; if (E.cuenta) { walletClient = createWalletClient({ account: E.cuenta, chain: celo, transport: custom(window.ethereum) }); await refrescarBilletera(); } render(); });
  window.ethereum.on('chainChanged', async () => { await refrescarBilletera(); render(); });
}

render();
cargar();
