// Chequeos de solo lectura antes de mover plata. No firma ni manda nada.
//   npm run probe
// Responde las preguntas abiertas del plan:
//  1. ¿El facilitador de Celo sigue aceptando wARS por Permit2?
//  2. ¿El dominio EIP-712 de wARS es "Peso Argentino" versión 1?
//  3. ¿wARS implementa permit (EIP-2612)? Si sí, el primer pago no necesita gas para habilitar Permit2.
//  4. ¿Están desplegados Permit2 y el proxy de x402 en Celo?
import { parseAbi } from 'viem';
import { PERMIT2_ADDRESS, x402ExactPermit2ProxyAddress } from '@x402/evm';
import { publicClient } from './lib.mjs';
import { WARS, CELO_NETWORK, DEFAULT_FACILITATOR_URL } from '../src/constants.js';

const client = publicClient();
const ok = (b) => (b ? '✅' : '❌');
let problems = 0;
const check = (cond, text) => { console.log(`${ok(cond)} ${text}`); if (!cond) problems++; };

const facilitator = process.env.X402_FACILITATOR_URL?.trim() || DEFAULT_FACILITATOR_URL;
try {
  const res = await fetch(`${facilitator}/supported`);
  const data = await res.json();
  const kind = data.kinds?.find((k) => k.x402Version === 2 && k.network === CELO_NETWORK && k.scheme === 'exact');
  const asset = kind?.extra?.supportedAssets?.find((a) => a.asset.toLowerCase() === WARS.address.toLowerCase());
  check(Boolean(asset), `El facilitador ${facilitator} acepta wARS en Celo (x402 v2, exact)`);
  if (asset) {
    check(asset.assetTransferMethod === 'permit2', `  método: ${asset.assetTransferMethod} (esperado permit2)`);
    check(asset.decimals === 18, `  decimales: ${asset.decimals}`);
    check(asset.name === WARS.eip712Name && asset.version === WARS.eip712Version, `  dominio publicado: "${asset.name}" v${asset.version}`);
  }
  const ext = data.extensions ?? kind?.extra?.extensions ?? [];
  console.log(`ℹ️  extensiones del facilitador: ${ext.join(', ') || 'ninguna'}`);
} catch (err) {
  check(false, `No pude leer ${facilitator}/supported: ${err.message}`);
}

try {
  const name = await client.readContract({ address: WARS.address, abi: parseAbi(['function name() view returns (string)']), functionName: 'name' });
  console.log(`ℹ️  name() del token: "${name}"`);
} catch (err) {
  console.log(`ℹ️  name() falló: ${err.shortMessage ?? err.message}`);
}

try {
  const d = await client.readContract({
    address: WARS.address,
    abi: parseAbi(['function eip712Domain() view returns (bytes1, string, string, uint256, address, bytes32, uint256[])']),
    functionName: 'eip712Domain',
  });
  check(d[1] === WARS.eip712Name && d[2] === WARS.eip712Version, `eip712Domain() del token: "${d[1]}" v${d[2]}, chainId ${d[3]}`);
} catch {
  console.log('ℹ️  El token no expone eip712Domain() (no es grave, el facilitador publica el dominio).');
}

let supports2612 = false;
try {
  await client.readContract({ address: WARS.address, abi: parseAbi(['function nonces(address) view returns (uint256)']), functionName: 'nonces', args: ['0x0000000000000000000000000000000000000001'] });
  await client.readContract({ address: WARS.address, abi: parseAbi(['function DOMAIN_SEPARATOR() view returns (bytes32)']), functionName: 'DOMAIN_SEPARATOR' });
  supports2612 = true;
} catch { /* sin permit */ }
console.log(supports2612
  ? '✅ wARS tiene nonces() y DOMAIN_SEPARATOR(): probablemente soporta permit (EIP-2612), así que el primer pago puede habilitar Permit2 sin gas.'
  : '⚠️  wARS no parece soportar permit (EIP-2612): cada wallet que pague por primera vez tiene que aprobar Permit2 una vez, pagando gas.');

for (const [label, address] of [['Permit2', PERMIT2_ADDRESS], ['Proxy x402 exact', x402ExactPermit2ProxyAddress]]) {
  const code = await client.getCode({ address }).catch(() => undefined);
  check(Boolean(code && code !== '0x'), `${label} desplegado en Celo (${address})`);
}

console.log(problems === 0 ? '\nTodo en orden para probar un pago real.' : `\n${problems} chequeo(s) fallaron. No sigas con plata real hasta entender por qué.`);
