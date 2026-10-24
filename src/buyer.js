// Lado del que paga (un agente comprador o la página web de pago).
// Funciona en Node y en el navegador: no importa nada de Node.
import { x402Client } from '@x402/core/client';
import { wrapFetchWithPayment, decodePaymentResponseHeader } from '@x402/fetch';
import { registerExactEvmScheme } from '@x402/evm/exact/client';
import { getPermit2AllowanceReadParams, createPermit2ApprovalTx } from '@x402/evm';
import { CELO_NETWORK, WARS } from './constants.js';

/**
 * fetch que paga solo cuando el servidor responde 402.
 * Por defecto x402 solo acepta USDC/USDT/USA₮; wARS hay que habilitarlo a mano, con tope por pago.
 * @param {object} opts
 * @param {object} opts.signer        cuenta viem (local o del navegador) con address y signTypedData
 * @param {bigint} opts.maxPerPaymentWei  tope por pago en unidades mínimas de wARS
 * @param {string} [opts.rpcUrl]      para leer allowance y firmar el permiso EIP-2612 si hace falta
 */
export function createPayingFetch({ signer, maxPerPaymentWei, rpcUrl, fetchImpl = globalThis.fetch }) {
  const client = new x402Client();
  registerExactEvmScheme(client, {
    signer,
    networks: [CELO_NETWORK],
    schemeOptions: rpcUrl ? { rpcUrl } : undefined,
  });
  client.setSpendControls({
    maxAmountPerPayment: false,
    allowedAssets: [{ network: CELO_NETWORK, asset: WARS.address, maxAmountPerPayment: BigInt(maxPerPaymentWei).toString() }],
  });
  // Solo pagamos en wARS sobre Celo, nunca en otra cosa.
  client.registerPolicy((_v, reqs) => reqs.filter((r) => r.network === CELO_NETWORK && r.asset.toLowerCase() === WARS.address.toLowerCase()));
  return wrapFetchWithPayment(fetchImpl, client);
}

/** Lee la respuesta de pago (hash de la transacción) que manda el servidor. */
export function readPaymentResponse(response) {
  const header = response.headers.get('payment-response') ?? response.headers.get('x-payment-response');
  if (!header) return null;
  try { return decodePaymentResponseHeader(header); } catch { return null; }
}

/** Cuánto le permitió la wallet al contrato Permit2 para gastar en wARS. */
export async function readPermit2Allowance(publicClient, owner) {
  return publicClient.readContract(getPermit2AllowanceReadParams({ tokenAddress: WARS.address, ownerAddress: owner }));
}

/** Datos de la transacción de aprobación única a Permit2 (cuesta gas, se hace una sola vez). */
export function permit2ApprovalTx() {
  return createPermit2ApprovalTx(WARS.address);
}
