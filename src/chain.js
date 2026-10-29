// Conexión con Celo mainnet. Toda transacción que manda la wallet del agente
// lleva el tag de atribución ERC-8021 (withAttribution lo agrega solo).
import { createPublicClient, createWalletClient, http, erc20Abi, getAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { celo } from 'viem/chains';
import { withAttribution, verifyTx } from '@celo/attribution-tags';
import { randomBytes } from 'node:crypto';
import { WARS, DEFAULT_RPC_URL } from './constants.js';

// Errores que el nodo devuelve ANTES de aceptar la transacción: es seguro reintentar.
const PRE_BROADCAST = /insufficient funds|exceeds balance|nonce too low|intrinsic gas|fee cap|underpriced|invalid sender|gas required exceeds/i;

export function createLiveChain({ privateKey, rpcUrl = DEFAULT_RPC_URL, tag, feeCurrency, logger = console, transport: customTransport }) {
  if (!privateKey) throw new Error('Falta AGENT_PRIVATE_KEY.');
  if (!tag || !/^celo_[a-z0-9]{12}$/.test(tag)) throw new Error(`ATTRIBUTION_TAG inválido: "${tag}". Tiene que ser como celo_aa27de260db7.`);
  const account = privateKeyToAccount(privateKey);
  const transport = customTransport ?? http(rpcUrl);
  const publicClient = createPublicClient({ chain: celo, transport });
  const wallet = createWalletClient({ account, chain: celo, transport }).extend(withAttribution(tag));
  const fee = feeCurrency ? { feeCurrency: getAddress(feeCurrency) } : {};

  return {
    mode: 'live',
    address: account.address,
    publicClient,

    async balanceWei() {
      return publicClient.readContract({ address: WARS.address, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] });
    },

    async celoBalanceWei() {
      return publicClient.getBalance({ address: account.address });
    },

    /** Transfiere wARS desde la wallet del agente y espera la confirmación. */
    async sendWars({ to, amountWei }) {
      let request;
      try {
        ({ request } = await publicClient.simulateContract({
          account, address: WARS.address, abi: erc20Abi, functionName: 'transfer', args: [getAddress(to), BigInt(amountWei)],
        }));
      } catch (err) {
        const e = new Error(`La simulación falló (no se mandó nada): ${err.shortMessage ?? err.message}`);
        e.notSent = true;
        throw e;
      }
      let hash;
      try {
        hash = await wallet.writeContract({ ...request, ...fee });
      } catch (err) {
        const msg = err.shortMessage ?? err.message;
        const e = new Error(`El nodo rechazó la transacción: ${msg}`);
        e.notSent = PRE_BROADCAST.test(msg) || PRE_BROADCAST.test(err.details ?? '');
        throw e;
      }
      logger.info?.(`[cadena] transferencia enviada ${hash}`);
      const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 90_000, pollingInterval: customTransport ? 10 : undefined });
      if (receipt.status !== 'success') {
        const e = new Error(`La transacción ${hash} revirtió (no movió plata).`);
        e.notSent = true;
        throw e;
      }
      return { hash };
    },

    async verifyTag(hash) {
      return verifyTx({ client: publicClient, hash });
    },
  };
}

/** Cadena de mentira para probar todo sin plata real. */
export function createMockChain({ address = '0x00000000000000000000000000000000000A6E17', initialBalanceWei = 0n, logger = console } = {}) {
  const state = { balance: BigInt(initialBalanceWei), sent: [], failNext: null };
  return {
    mode: 'mock',
    address,
    state,
    async balanceWei() { return state.balance; },
    async celoBalanceWei() { return 0n; },
    /** Simula que el facilitador depositó un cobro en la wallet del agente. */
    credit(amountWei) { state.balance += BigInt(amountWei); },
    async sendWars({ to, amountWei }) {
      if (state.failNext) {
        const e = new Error(state.failNext.message);
        e.notSent = state.failNext.notSent;
        state.failNext = null;
        throw e;
      }
      const amount = BigInt(amountWei);
      if (amount > state.balance) {
        const e = new Error('Insufficient wARS balance (simulated).');
        e.notSent = true;
        throw e;
      }
      state.balance -= amount;
      const hash = `0x${randomBytes(32).toString('hex')}`;
      state.sent.push({ to, amountWei: amount, hash });
      logger.info?.(`[cadena simulada] ${amount} wei de wARS a ${to} (${hash})`);
      return { hash };
    },
    async verifyTag() { return null; },
  };
}
