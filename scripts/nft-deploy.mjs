// Despliega el contrato SenaTicket (el NFT de la reserva). Por defecto en Celo Sepolia, una TESTNET.
//   npm run nft:deploy              -> simulación: muestra quién despliega, el saldo y el gas. No manda nada.
//   npm run nft:deploy -- --send    -> despliega de verdad
//   npm run nft:deploy -- --send --agent 0xTuAgente   (la billetera que podrá emitir tickets; por defecto, la que despliega)
// Lee NFT_PRIVATE_KEY (una clave de testnet con fondos de prueba), NFT_CHAIN y NFT_RPC_URL del entorno / .env.
import { createPublicClient, createWalletClient, http, encodeDeployData, formatEther, getAddress, isAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { ARTEFACTO, REDES_NFT } from '../src/nft.js';
import { normalizePrivateKey } from '../src/keys.js';

const flag = (n) => process.argv.includes(`--${n}`);
const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const FAUCETS = { celoSepolia: 'https://faucet.celo.org/celo-sepolia', sepolia: 'buscá "Sepolia faucet" (por ejemplo el de Google Cloud Web3 o Alchemy)' };

const red = process.env.NFT_CHAIN?.trim() || 'celoSepolia';
const r = REDES_NFT[red];
if (!r) { console.error(`NFT_CHAIN desconocida: ${red}. Usá celoSepolia, sepolia o celo.`); process.exit(1); }
if (!r.testnet && !flag('mainnet')) {
  console.error(`${r.nombre} es una red REAL (cuesta plata). Si de verdad querés desplegar ahí, agregá --mainnet.`);
  process.exit(1);
}
const clave = process.env.NFT_PRIVATE_KEY?.trim();
if (!clave) {
  console.error('Falta NFT_PRIVATE_KEY en el archivo .env: una clave de TESTNET dedicada al NFT (no la del agente en el modo real).');
  process.exit(1);
}
let account;
try { account = privateKeyToAccount(normalizePrivateKey(clave, 'NFT_PRIVATE_KEY')); } catch (err) { console.error(err.message); process.exit(1); }
const agente = arg('agent') ? (isAddress(arg('agent')) ? getAddress(arg('agent')) : (console.error('--agent no es una dirección válida.'), process.exit(1))) : account.address;
const transport = http(process.env.NFT_RPC_URL?.trim() || r.chain.rpcUrls.default.http[0]);
const pub = createPublicClient({ chain: r.chain, transport });
const data = encodeDeployData({ abi: ARTEFACTO.abi, bytecode: ARTEFACTO.bytecode, args: [agente] });

console.log(`Red:          ${r.nombre} (chain ${r.chain.id})`);
console.log(`Despliega:    ${account.address}`);
console.log(`Agente:       ${agente}  (la billetera que va a poder emitir los tickets)`);
let saldo;
try { saldo = await pub.getBalance({ address: account.address }); } catch (err) { console.error(`No pude conectarme a la red: ${err.shortMessage ?? err.message}`); process.exit(1); }
console.log(`Saldo:        ${formatEther(saldo)} ${r.chain.nativeCurrency.symbol}`);
if (saldo === 0n) {
  console.error(`\nLa billetera no tiene fondos de prueba. Cargale desde un faucet: ${FAUCETS[red] ?? 'un faucet de la red'}`);
  console.error(`Dirección para cargar: ${account.address}`);
  process.exit(1);
}
const gas = await pub.estimateGas({ account: account.address, data }).catch((err) => { console.error(`No se pudo estimar el gas: ${err.shortMessage ?? err.message}`); process.exit(1); });
const precio = await pub.getGasPrice();
console.log(`Gas estimado: ${gas} (≈ ${formatEther(gas * precio)} ${r.chain.nativeCurrency.symbol})`);
if (!flag('send')) {
  console.log('\nSimulación: no se mandó nada. Para desplegar de verdad: npm run nft:deploy -- --send');
  process.exit(0);
}
const wallet = createWalletClient({ account, chain: r.chain, transport });
const hash = await wallet.deployContract({ abi: ARTEFACTO.abi, bytecode: ARTEFACTO.bytecode, args: [agente] });
console.log(`\nTransacción: ${hash}\nEsperando la confirmación...`);
const recibo = await pub.waitForTransactionReceipt({ hash });
if (recibo.status !== 'success' || !recibo.contractAddress) { console.error('El despliegue falló.'); process.exit(1); }
console.log(`\n✅ Contrato desplegado: ${recibo.contractAddress}`);
console.log(`   Explorador: ${r.explorador}/address/${recibo.contractAddress}`);
console.log('\nAhora poné esto en tu archivo .env y reiniciá el servidor:');
console.log(`   NFT_CONTRACT=${recibo.contractAddress}`);
console.log(`   NFT_CHAIN=${red}`);
console.log('   NFT_PRIVATE_KEY=<la misma clave de testnet, si el agente es la billetera que desplegó>');
console.log('Probalo con: npm run nft:probar');
