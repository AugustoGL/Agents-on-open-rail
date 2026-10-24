// Saldos de la wallet del agente en Celo mainnet.
//   npm run balance
import { formatEther, formatUnits, erc20Abi } from 'viem';
import { getPermit2AllowanceReadParams } from '@x402/evm';
import { agentAccount, publicClient } from './lib.mjs';
import { TOKENS, WARS } from '../src/constants.js';

const account = agentAccount();
const client = publicClient();
console.log('Dirección:', account.address);
console.log('CELO:', formatEther(await client.getBalance({ address: account.address })));
for (const [symbol, t] of Object.entries(TOKENS)) {
  const b = await client.readContract({ address: t.address, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] });
  console.log(`${symbol}:`, formatUnits(b, t.decimals));
}
const allowance = await client.readContract(getPermit2AllowanceReadParams({ tokenAddress: WARS.address, ownerAddress: account.address }));
console.log('wARS habilitados para Permit2:', allowance === 0n ? '0 (no hace falta para cobrar, solo para pagar)' : formatUnits(allowance, 18));
