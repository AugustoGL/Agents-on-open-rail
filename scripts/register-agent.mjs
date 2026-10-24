// Registra la identidad ERC-8004 del agente desde su wallet, con el tag de atribución.
//   npm run register              -> solo simula, no manda nada
//   npm run register -- --send    -> manda la transacción real
// Gas en USA₮/USDC: poné FEE_CURRENCY=USAT (o USDC) en .env.
import { createWalletClient, http, parseEventLogs, getAddress } from 'viem';
import { celo } from 'viem/chains';
import { withAttribution, verifyTx } from '@celo/attribution-tags';
import { agentAccount, publicClient, requireEnv, flag } from './lib.mjs';
import { ERC8004_IDENTITY_REGISTRY, FEE_CURRENCIES, DEFAULT_RPC_URL } from '../src/constants.js';

const TAG = requireEnv('ATTRIBUTION_TAG', 'Es el código celo_... del panel de Loops House.');
const AGENT_URI = process.env.AGENT_URI?.trim() || 'https://raw.githubusercontent.com/AugustoGL/Agents-on-open-rail/main/agent.json';
const feeRaw = process.env.FEE_CURRENCY?.trim();
const feeCurrency = feeRaw ? getAddress(FEE_CURRENCIES[feeRaw.toUpperCase()] ?? feeRaw) : undefined;

const abi = [
  { type: 'function', name: 'register', stateMutability: 'nonpayable', inputs: [{ name: 'agentURI', type: 'string' }], outputs: [{ name: 'agentId', type: 'uint256' }] },
  { type: 'event', name: 'Registered', inputs: [{ name: 'agentId', type: 'uint256', indexed: true }, { name: 'agentURI', type: 'string' }, { name: 'owner', type: 'address', indexed: true }] },
];

const account = agentAccount();
const client = publicClient();
const wallet = createWalletClient({ account, chain: celo, transport: http(process.env.RPC_URL?.trim() || DEFAULT_RPC_URL) }).extend(withAttribution(TAG));

console.log('Wallet:', account.address);
console.log('Archivo de registro:', AGENT_URI);
console.log('Tag:', TAG, feeCurrency ? `· gas pagado con ${feeRaw}` : '· gas pagado en CELO');

const res = await fetch(AGENT_URI).catch(() => null);
if (!res?.ok) {
  console.error(`No pude leer ${AGENT_URI}. Subí agent.json al repo (git push) antes de registrar.`);
  process.exit(1);
}

const { request } = await client.simulateContract({ account, address: ERC8004_IDENTITY_REGISTRY, abi, functionName: 'register', args: [AGENT_URI] });
console.log('Simulación OK: el registro es válido.');
if (!flag('send')) {
  console.log('No se mandó nada. Para mandarlo de verdad: npm run register -- --send');
  process.exit(0);
}

if (process.env.ERC8004_AGENT_ID?.trim() && !flag('otra-vez')) {
  console.error(`Ya tenés ERC8004_AGENT_ID=${process.env.ERC8004_AGENT_ID.trim()} en .env: registrar de nuevo crea OTRA identidad.`);
  console.error('Si de verdad querés otra, agregá --otra-vez.');
  process.exit(1);
}

const hash = await wallet.writeContract({ ...request, ...(feeCurrency ? { feeCurrency } : {}) });
console.log('Transacción enviada:', hash);
const receipt = await client.waitForTransactionReceipt({ hash });
const [reg] = parseEventLogs({ abi, eventName: 'Registered', logs: receipt.logs });
console.log('agentId:', reg?.args.agentId?.toString(), '(guardalo en .env como ERC8004_AGENT_ID)');
const tag = await verifyTx({ client, hash });
console.log('Tag en cadena:', tag ? tag.codes.join(', ') : 'NO ENCONTRADO');
if (!tag?.codes.includes(TAG)) console.error('⚠️  El tag no aparece en la transacción. No mandes nada más y revisalo.');
console.log(`Celoscan: https://celoscan.io/tx/${hash}`);
