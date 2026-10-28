// Genera una clave NUEVA de testnet para el NFT y te dice qué dirección cargar con fondos de prueba.
//   npm run nft:clave
// La clave se muestra una sola vez, en tu terminal: copiala al .env como NFT_PRIVATE_KEY. No se guarda en ningún lado.
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
const clave = generatePrivateKey();
const cuenta = privateKeyToAccount(clave);
console.log('Clave nueva de TESTNET (solo para el NFT; no la uses para nada con plata real):\n');
console.log(`  NFT_PRIVATE_KEY=${clave}`);
console.log(`\nDirección (cargale fondos de prueba): ${cuenta.address}`);
console.log('Faucet de Celo Sepolia: https://faucet.celo.org/celo-sepolia');
console.log('\nDespués: npm run nft:deploy   y   npm run nft:deploy -- --send');
