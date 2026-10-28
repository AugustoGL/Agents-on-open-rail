// Manda un ticket de prueba con el contrato ya desplegado y muestra dónde verlo.
//   npm run nft:probar                         -> un ticket de prueba para la billetera del agente
//   npm run nft:probar -- --to 0xTuBilletera   -> para que lo veas en TU billetera
//   npm run nft:probar -- --to 0x... --quemar  -> lo emite, lo marca como jugado y lo quema (ciclo completo)
import { getAddress, isAddress } from 'viem';
import { createNftClient, ticketMetadata, tokenUri, tokenIdFor } from '../src/nft.js';
import { normalizePrivateKey } from '../src/keys.js';

const flag = (n) => process.argv.includes(`--${n}`);
const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const falta = (k) => { console.error(`Falta ${k} en el archivo .env. Primero: npm run nft:deploy -- --send`); process.exit(1); };
const contrato = process.env.NFT_CONTRACT?.trim() || falta('NFT_CONTRACT');
const clave = process.env.NFT_PRIVATE_KEY?.trim() || falta('NFT_PRIVATE_KEY');
const nft = createNftClient({ contract: contrato, privateKey: normalizePrivateKey(clave, 'NFT_PRIVATE_KEY'), red: process.env.NFT_CHAIN?.trim() || 'celoSepolia', rpcUrl: process.env.NFT_RPC_URL?.trim() || undefined, logger: console });
const para = arg('to') ? (isAddress(arg('to')) ? getAddress(arg('to')) : (console.error('--to no es una dirección válida.'), process.exit(1))) : nft.agentAddress;
const codigo = `S-TEST${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
const tokenId = tokenIdFor(codigo);
const datos = { negocio: 'Pádel Demo', recurso: 'Cancha 1', cuando: 'jue 29/10 20:00', inicioMs: Date.now() + 86_400_000, sena: '$ 6.000', codigo };

console.log(`Red: ${nft.redNombre} · contrato ${nft.contract}\nPara: ${para}\nTicket: ${codigo} (id ${tokenId})`);
const { hash } = await nft.mint({ to: para, tokenId, uri: tokenUri(ticketMetadata({ ...datos, estado: 'confirmada' })) });
console.log(`✅ Emitido: ${nft.urlTx(hash)}\n   Verlo: ${nft.urlToken(tokenId)}`);
if (flag('quemar')) {
  const usado = await nft.setUri(tokenId, tokenUri(ticketMetadata({ ...datos, estado: 'jugada' })));
  console.log(`✅ Marcado como jugado: ${nft.urlTx(usado.hash)}`);
  const quemado = await nft.burn(tokenId);
  console.log(`✅ Quemado: ${nft.urlTx(quemado.hash)}`);
} else {
  console.log('\nPara ver el ciclo completo (jugado y quemado) agregá --quemar. Para quemar este ticket más tarde, hace falta su id: ' + tokenId);
}
