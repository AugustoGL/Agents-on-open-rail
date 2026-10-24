// Página de pago para personas: conecta la wallet del navegador (MetaMask, MiniPay, etc.)
// y paga la seña con x402. Se compila con `npm run build:web` a public/pay.bundle.js.
import { createPublicClient, createWalletClient, custom, http, erc20Abi } from 'viem';
import { celo } from 'viem/chains';
import { toClientEvmSigner } from '@x402/evm';
import { createPayingFetch, readPaymentResponse, readPermit2Allowance, permit2ApprovalTx } from '../src/buyer.js';
import { WARS } from '../src/constants.js';

const $ = (id) => document.getElementById(id);
const RPC = 'https://forno.celo.org';
const bookingId = location.pathname.split('/').filter(Boolean).pop();
const publicClient = createPublicClient({ chain: celo, transport: http(RPC) });
let booking = null;
let account = null;
let walletClient = null;
let modoPrueba = false;

function show(msg, kind = 'info') {
  const el = $('status');
  el.textContent = msg;
  el.className = `status ${kind}`;
}

function fmtArs(wei) {
  const ars = Number(BigInt(wei) / 10n ** 16n) / 100;
  return `$ ${ars.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

async function loadBooking() {
  const [r, n, h] = await Promise.all([fetch(`/api/reservas/${bookingId}`), fetch('/api/negocio'), fetch('/health')]);
  const negocio = await n.json();
  modoPrueba = (await h.json().catch(() => ({}))).modo === 'mock';
  $('negocio').textContent = negocio.nombre + (negocio.esDemostracion ? ' · comercio de demostración' : '') + (modoPrueba ? ' · MODO PRUEBA (no se mueve plata)' : '');
  $('politica').innerHTML = negocio.politica.map((p) => `<li>${p}</li>`).join('');
  if (!r.ok) { show('No encontré esa reserva.', 'error'); return; }
  booking = (await r.json()).reserva;
  $('turno').textContent = `${booking.inicioLocal} · ${booking.recurso}`;
  $('monto').textContent = booking.sena.texto;
  $('id').textContent = booking.id;
  if (booking.estado === 'confirmed') { show('Esta reserva ya está pagada. ¡Nos vemos en la cancha!', 'ok'); $('connect').hidden = true; return; }
  if (booking.estado !== 'held') { show('Esta reserva ya no está activa. Reservá de nuevo desde el bot.', 'error'); $('connect').hidden = true; return; }
  const left = Math.max(0, Math.round((Date.parse(booking.venceEl) - Date.now()) / 60000));
  show(`Tenés ${left} minutos para pagar la seña.`);
}

async function ensureCelo() {
  const chainId = await window.ethereum.request({ method: 'eth_chainId' });
  if (Number(chainId) === celo.id) return;
  try {
    await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xa4ec' }] });
  } catch (err) {
    if (err.code !== 4902) throw err;
    await window.ethereum.request({
      method: 'wallet_addEthereumChain',
      params: [{ chainId: '0xa4ec', chainName: 'Celo', nativeCurrency: { name: 'CELO', symbol: 'CELO', decimals: 18 }, rpcUrls: [RPC], blockExplorerUrls: ['https://celoscan.io'] }],
    });
  }
}

async function connect() {
  if (!window.ethereum) { show('No encontré una wallet en este navegador. Abrí este link desde MetaMask o MiniPay.', 'error'); return; }
  try {
    [account] = await window.ethereum.request({ method: 'eth_requestAccounts' });
    await ensureCelo();
    walletClient = createWalletClient({ account, chain: celo, transport: custom(window.ethereum) });
    const balance = await publicClient.readContract({ address: WARS.address, abi: erc20Abi, functionName: 'balanceOf', args: [account] });
    $('wallet').textContent = `${account.slice(0, 6)}…${account.slice(-4)} · saldo ${fmtArs(balance)} en wARS`;
    $('connect').hidden = true;
    if (balance < BigInt(booking.sena.wei) && !modoPrueba) {
      show('No te alcanza el saldo de wARS. Cargá pesos con Ripio y volvé a esta página.', 'error');
      $('ramp').href = `https://ramp.ripio.com/?country=AR&chain=42220&token=WARS&address=${account}`;
      $('ramp').hidden = false;
      return;
    }
    $('pay').hidden = false;
    show('Wallet conectada. Revisá el monto y tocá Pagar.');
  } catch (err) {
    show(`No se pudo conectar: ${err.shortMessage ?? err.message}`, 'error');
  }
}

async function approve() {
  try {
    show('Confirmá la habilitación en tu wallet (se hace una sola vez y cuesta un poco de CELO de gas)...');
    const tx = permit2ApprovalTx();
    const hash = await walletClient.sendTransaction({ account, to: tx.to, data: tx.data });
    await publicClient.waitForTransactionReceipt({ hash });
    $('approve').hidden = true;
    $('pay').hidden = false;
    show('Listo. Ahora tocá Pagar.', 'ok');
  } catch (err) {
    show(`No se pudo habilitar: ${err.shortMessage ?? err.message}`, 'error');
  }
}

async function pay() {
  $('pay').disabled = true;
  try {
    const signer = toClientEvmSigner({
      address: account,
      signTypedData: (msg) => walletClient.signTypedData({ account, ...msg }),
    }, publicClient);
    const payingFetch = createPayingFetch({ signer, maxPerPaymentWei: BigInt(booking.sena.wei), rpcUrl: RPC });
    show('Firmá el pago en tu wallet (no cuesta gas)...');
    const res = await payingFetch(booking.pagarEn, { method: 'POST' });
    if (res.ok) {
      const receipt = readPaymentResponse(res);
      show('✅ ¡Seña pagada! Tu turno quedó confirmado. Te llega el aviso por Telegram.', 'ok');
      if (receipt?.transaction && !modoPrueba) {
        $('tx').href = `https://celoscan.io/tx/${receipt.transaction}`;
        $('tx').hidden = false;
      }
      $('pay').hidden = true;
      return;
    }
    const body = await res.json().catch(() => ({}));
    const reason = body.error ?? body.errorReason ?? body.invalidReason ?? `respuesta ${res.status}`;
    // Si falta la habilitación de Permit2 y el token no permite hacerla sin gas, se ofrece hacerla a mano.
    const allowance = await readPermit2Allowance(publicClient, account).catch(() => null);
    if (allowance !== null && allowance < BigInt(booking.sena.wei)) {
      $('approve').hidden = false;
      $('pay').hidden = true;
      show('Antes del primer pago hay que habilitar wARS para pagos sin gas. Tocá "Habilitar".', 'error');
      return;
    }
    show(`El pago no se completó: ${reason}`, 'error');
  } catch (err) {
    show(`El pago no se completó: ${err.shortMessage ?? err.message}`, 'error');
  } finally {
    $('pay').disabled = false;
  }
}

$('connect').addEventListener('click', connect);
$('approve').addEventListener('click', approve);
$('pay').addEventListener('click', pay);
loadBooking().catch((err) => show(`Error cargando la reserva: ${err.message}`, 'error'));
