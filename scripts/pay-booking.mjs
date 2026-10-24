// Agente comprador de prueba: reserva un turno y paga la seña por x402 con su propia wallet.
// Sirve para probar el cobro real en mainnet (con una wallet DISTINTA a la del agente).
//
//   npm run pay -- --url http://localhost:8402 --fecha 2026-10-21 --hora 20:00 --recurso "Cancha 1"
//   npm run pay -- --url http://localhost:8402 --reserva S-ABC234
//   Opciones: --max 10000 (tope en pesos)  --approve (habilita Permit2 si hace falta; cuesta gas)
import { createWalletClient, http, formatUnits, erc20Abi, getAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { celo } from 'viem/chains';
import { toClientEvmSigner } from '@x402/evm';
import { withAttribution } from '@celo/attribution-tags';
import { createPayingFetch, readPaymentResponse, readPermit2Allowance, permit2ApprovalTx } from '../src/buyer.js';
import { arsToWei, formatArs } from '../src/money.js';
import { WARS, FEE_CURRENCIES, DEFAULT_RPC_URL } from '../src/constants.js';
import { publicClient, requireEnv, readKey, flag, arg } from './lib.mjs';
import { normalizePrivateKey } from '../src/keys.js';

const base = (arg('url') ?? process.env.PUBLIC_BASE_URL ?? 'http://localhost:8402').replace(/\/$/, '');
const buyer = privateKeyToAccount(readKey('BUYER_PRIVATE_KEY', 'Usá una wallet distinta a la del agente, con algo de wARS.'));
const maxWei = arsToWei(arg('max') ?? '10000');
const rpcUrl = process.env.RPC_URL?.trim() || DEFAULT_RPC_URL;
const isMock = (await (await fetch(`${base}/health`)).json()).modo === 'mock';
const client = isMock ? null : publicClient();

if (process.env.AGENT_PRIVATE_KEY && privateKeyToAccount(normalizePrivateKey(process.env.AGENT_PRIVATE_KEY)).address === buyer.address) {
  console.error('BUYER_PRIVATE_KEY es la misma wallet que el agente: pagarse a uno mismo no prueba nada. Usá otra wallet.');
  process.exit(1);
}
console.log(`Comprador: ${buyer.address} · servidor ${base} (${isMock ? 'simulado' : 'mainnet'})`);

// 1) Conseguir la reserva
let reserva;
if (arg('reserva')) {
  const r = await fetch(`${base}/api/reservas/${arg('reserva')}`);
  if (!r.ok) { console.error('No existe esa reserva.'); process.exit(1); }
  reserva = (await r.json()).reserva;
} else {
  const body = { recurso: arg('recurso') ?? 'Cancha 1', fecha: arg('fecha'), hora: arg('hora'), cliente: { nombre: 'Agente comprador', wallet: buyer.address } };
  if (!body.fecha || !body.hora) { console.error('Pasá --fecha YYYY-MM-DD y --hora HH:MM, o --reserva S-XXXXXX.'); process.exit(1); }
  const r = await fetch(`${base}/api/reservas`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await r.json();
  if (!r.ok) { console.error(`No se pudo reservar: ${data.error}`); process.exit(1); }
  reserva = data.reserva;
  console.log(`Reservado ${reserva.id}: ${reserva.inicioLocal} · ${reserva.recurso}. Token para cancelar: ${data.clienteToken}`);
}
console.log(`Seña: ${reserva.sena.texto} (tope del comprador: ${formatArs(maxWei)})`);

// 2) Chequeos en mainnet: saldo y habilitación de Permit2
if (!isMock) {
  const bal = await client.readContract({ address: WARS.address, abi: erc20Abi, functionName: 'balanceOf', args: [buyer.address] });
  console.log(`Saldo wARS del comprador: ${formatUnits(bal, 18)}`);
  if (bal < BigInt(reserva.sena.wei)) { console.error('No alcanza el saldo de wARS.'); process.exit(1); }
  const allowance = await readPermit2Allowance(client, buyer.address);
  if (allowance < BigInt(reserva.sena.wei)) {
    if (!flag('approve')) {
      console.log('⚠️  La wallet no habilitó Permit2 para wARS. Si wARS soporta permit (ver `npm run probe`), x402 lo resuelve sin gas.');
      console.log('   Si el pago falla por eso, repetí con --approve (manda una transacción de aprobación, cuesta gas).');
    } else {
      const feeRaw = process.env.FEE_CURRENCY?.trim();
      const feeCurrency = feeRaw ? getAddress(FEE_CURRENCIES[feeRaw.toUpperCase()] ?? feeRaw) : undefined;
      let wallet = createWalletClient({ account: buyer, chain: celo, transport: http(rpcUrl) });
      if (process.env.ATTRIBUTION_TAG) wallet = wallet.extend(withAttribution(process.env.ATTRIBUTION_TAG.trim()));
      const tx = permit2ApprovalTx();
      const hash = await wallet.sendTransaction({ to: tx.to, data: tx.data, ...(feeCurrency ? { feeCurrency } : {}) });
      await client.waitForTransactionReceipt({ hash });
      console.log(`Permit2 habilitado: https://celoscan.io/tx/${hash}`);
    }
  }
}

// 3) Pagar por x402
const signer = isMock ? buyer : toClientEvmSigner(buyer, client);
const payingFetch = createPayingFetch({ signer, maxPerPaymentWei: maxWei, rpcUrl: isMock ? undefined : rpcUrl });
const res = await payingFetch(reserva.pagarEn, { method: 'POST' });
const text = await res.text();
if (!res.ok) {
  console.error(`El pago no se completó (${res.status}): ${text}`);
  process.exit(1);
}
const receipt = readPaymentResponse(res);
console.log('✅ Pagado.', JSON.parse(text).mensaje);
if (receipt?.transaction) console.log(`Transacción: ${isMock ? receipt.transaction + ' (simulada)' : `https://celoscan.io/tx/${receipt.transaction}`}`);
