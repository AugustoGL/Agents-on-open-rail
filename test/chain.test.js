// Prueba la cadena "real" contra un nodo falso: verifica que la transferencia de wARS
// lleve el tag ERC-8021 al final del calldata y que el gas se pague con el adaptador elegido.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { custom, decodeFunctionData, erc20Abi, encodeAbiParameters, keccak256 } from 'viem';
import { parseTransaction } from 'viem/celo';
import { generatePrivateKey } from 'viem/accounts';
import { fromDataSuffix } from '@celo/attribution-tags';
import { createLiveChain } from '../src/chain.js';
import { WARS, FEE_CURRENCIES } from '../src/constants.js';
import { silent } from './helpers.js';

function fakeNode({ revert = false, rejectSend = null } = {}) {
  const sent = [];
  const hex = (n) => `0x${BigInt(n).toString(16)}`;
  const request = async ({ method, params }) => {
    switch (method) {
      case 'eth_chainId': return hex(42220);
      case 'eth_call': return encodeAbiParameters([{ type: 'bool' }], [true]);
      case 'eth_estimateGas': return hex(60_000);
      case 'eth_getTransactionCount': return hex(7);
      case 'eth_gasPrice': return hex(25_000_000_000);
      case 'eth_maxPriorityFeePerGas': return hex(1_000_000_000);
      case 'eth_getBlockByNumber': return { number: hex(100), baseFeePerGas: hex(25_000_000_000), timestamp: hex(1), hash: `0x${'11'.repeat(32)}`, transactions: [] };
      case 'eth_blockNumber': return hex(101);
      case 'eth_sendRawTransaction': {
        if (rejectSend) throw Object.assign(new Error(rejectSend), { code: -32000 });
        sent.push(params[0]);
        return keccak256(params[0]);
      }
      case 'eth_getTransactionReceipt': {
        const raw = sent.at(-1);
        return { transactionHash: keccak256(raw), status: revert ? '0x0' : '0x1', blockNumber: hex(100), blockHash: `0x${'22'.repeat(32)}`, logs: [], gasUsed: hex(50_000), cumulativeGasUsed: hex(50_000), effectiveGasPrice: hex(1), from: '0x0000000000000000000000000000000000000001', to: WARS.address, transactionIndex: '0x0', type: '0x2', logsBloom: `0x${'00'.repeat(256)}`, contractAddress: null };
      }
      default: throw new Error(`método no simulado: ${method}`);
    }
  };
  return { sent, transport: custom({ request }) };
}

test('la transferencia de wARS lleva el tag y paga gas con USA₮', async () => {
  const node = fakeNode();
  const chain = createLiveChain({ privateKey: generatePrivateKey(), tag: 'celo_aa27de260db7', feeCurrency: FEE_CURRENCIES.USAT, transport: node.transport, logger: silent });
  const to = '0x1111111111111111111111111111111111111111';
  const { hash } = await chain.sendWars({ to, amountWei: 6000n * 10n ** 18n });
  assert.match(hash, /^0x[0-9a-f]{64}$/);
  const tx = parseTransaction(node.sent[0]);
  assert.equal(tx.to.toLowerCase(), WARS.address.toLowerCase());
  assert.equal(tx.feeCurrency.toLowerCase(), FEE_CURRENCIES.USAT.toLowerCase());
  const attribution = fromDataSuffix(tx.data);
  assert.deepEqual(attribution.codes, ['celo_aa27de260db7']);
  // El calldata sigue siendo un transfer(to, monto) válido: el sufijo no lo rompe.
  const { functionName, args } = decodeFunctionData({ abi: erc20Abi, data: tx.data });
  assert.equal(functionName, 'transfer');
  assert.equal(args[0].toLowerCase(), to);
  assert.equal(args[1], 6000n * 10n ** 18n);
});

test('sin FEE_CURRENCY el gas va en CELO y el tag sigue estando', async () => {
  const node = fakeNode();
  const chain = createLiveChain({ privateKey: generatePrivateKey(), tag: 'celo_aa27de260db7', transport: node.transport, logger: silent });
  await chain.sendWars({ to: '0x1111111111111111111111111111111111111111', amountWei: 1n });
  const tx = parseTransaction(node.sent[0]);
  assert.equal(tx.feeCurrency, undefined);
  assert.deepEqual(fromDataSuffix(tx.data).codes, ['celo_aa27de260db7']);
});

test('errores: tag inválido, rechazo del nodo antes de enviar y reversión', async () => {
  assert.throws(() => createLiveChain({ privateKey: generatePrivateKey(), tag: 'CELOBUILDERS', logger: silent }), /ATTRIBUTION_TAG/);

  const rejecting = fakeNode({ rejectSend: 'insufficient funds for gas * price + value' });
  const c1 = createLiveChain({ privateKey: generatePrivateKey(), tag: 'celo_aa27de260db7', transport: rejecting.transport, logger: silent });
  await assert.rejects(c1.sendWars({ to: '0x1111111111111111111111111111111111111111', amountWei: 1n }), (err) => err.notSent === true);

  const reverting = fakeNode({ revert: true });
  const c2 = createLiveChain({ privateKey: generatePrivateKey(), tag: 'celo_aa27de260db7', transport: reverting.transport, logger: silent });
  await assert.rejects(c2.sendWars({ to: '0x1111111111111111111111111111111111111111', amountWei: 1n }), (err) => err.notSent === true && /revirtió/.test(err.message));
});
