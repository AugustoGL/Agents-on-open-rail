// El ticket de la reserva como NFT (contracts/SenaTicket.sol): un ERC-721 intransferible que el agente le manda
// a la billetera que pagó la seña. Acá está lo que arma el contenido del ticket (imagen y datos) y los clientes
// que hablan con el contrato: uno real (viem) y uno simulado en memoria para el modo prueba y los tests.
import { readFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, keccak256, toHex, getAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { celoSepolia, sepolia, celo } from 'viem/chains';

export const ARTEFACTO = JSON.parse(readFileSync(new URL('../contracts/SenaTicket.json', import.meta.url), 'utf8'));

export const REDES_NFT = {
  celoSepolia: { chain: celoSepolia, nombre: 'Celo Sepolia (testnet)', explorador: 'https://celo-sepolia.blockscout.com', token: (e, c, id) => `${e}/token/${c}/instance/${id}`, testnet: true },
  sepolia: { chain: sepolia, nombre: 'Ethereum Sepolia (testnet)', explorador: 'https://sepolia.etherscan.io', token: (e, c, id) => `${e}/nft/${c}/${id}`, testnet: true },
  celo: { chain: celo, nombre: 'Celo', explorador: 'https://celoscan.io', token: (e, c, id) => `${e}/nft/${c}/${id}`, testnet: false },
};

/** El id del ticket sale del código de la reserva: emitir dos veces la misma reserva es imposible. */
export const tokenIdFor = (bookingId) => BigInt(keccak256(toHex(String(bookingId))));

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const corto = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));

const ESTADOS = {
  confirmada: { etiqueta: 'CONFIRMADA', fondo: '#1F6F54', pastilla: '#E1F2E9', texto: '#14573F', simbolo: '✓' },
  jugada: { etiqueta: 'JUGADA', fondo: '#3B5370', pastilla: '#E3EAF2', texto: '#3B5370', simbolo: '⚑' },
};

/** La imagen del ticket (SVG chico). Todo texto que viene del comercio se escapa. */
export function ticketSvg({ negocio, recurso, cuando, sena, estado = 'confirmada', codigo }) {
  const e = ESTADOS[estado] ?? ESTADOS.confirmada;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 340" width="600" height="340">`
    + `<rect width="600" height="340" rx="28" fill="${e.fondo}"/>`
    + `<circle cx="600" cy="170" r="30" fill="#F6F3EC"/><circle cx="0" cy="170" r="30" fill="#F6F3EC"/>`
    + `<text x="40" y="62" font-family="system-ui,sans-serif" font-size="20" font-weight="700" letter-spacing="3" fill="#ffffffcc">SEÑA · RESERVA</text>`
    + `<text x="40" y="118" font-family="system-ui,sans-serif" font-size="34" font-weight="800" fill="#ffffff">${esc(corto(recurso, 22))}</text>`
    + `<text x="40" y="160" font-family="system-ui,sans-serif" font-size="24" fill="#ffffff">${esc(corto(cuando, 30))}</text>`
    + `<text x="40" y="200" font-family="system-ui,sans-serif" font-size="20" fill="#ffffffdd">${esc(corto(negocio, 34))}</text>`
    + `<rect x="40" y="226" rx="18" width="190" height="38" fill="${e.pastilla}"/>`
    + `<text x="135" y="251" text-anchor="middle" font-family="system-ui,sans-serif" font-size="17" font-weight="700" fill="${e.texto}">${e.simbolo} ${e.etiqueta}</text>`
    + `<text x="40" y="304" font-family="ui-monospace,monospace" font-size="18" fill="#ffffffcc">${esc(codigo)}</text>`
    + `<text x="560" y="304" text-anchor="end" font-family="system-ui,sans-serif" font-size="20" font-weight="700" fill="#ffffff">${esc(sena)} · wARS</text>`
    + `</svg>`;
}

/** Los datos del ticket tal como los muestran las billeteras (formato estándar de metadatos de NFT). */
export function ticketMetadata({ negocio, recurso, cuando, inicioMs, sena, codigo, estado = 'confirmada', urlBase }) {
  const e = ESTADOS[estado] ?? ESTADOS.confirmada;
  const svg = ticketSvg({ negocio, recurso, cuando, sena, estado, codigo });
  return {
    name: `Reserva ${codigo} · ${recurso}`,
    description: `Reserva de ${recurso} en ${negocio}: ${cuando}. Es un ticket intransferible: pertenece a la billetera que pagó la seña (${sena} en wARS).`,
    image: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
    ...(urlBase ? { external_url: `${urlBase.replace(/\/$/, '')}/pagar/${codigo}` } : {}),
    attributes: [
      { trait_type: 'Comercio', value: negocio },
      { trait_type: 'Cancha', value: recurso },
      { trait_type: 'Turno', value: cuando },
      { trait_type: 'Inicio', display_type: 'date', value: Math.floor(inicioMs / 1000) },
      { trait_type: 'Seña', value: sena },
      { trait_type: 'Estado', value: e.etiqueta[0] + e.etiqueta.slice(1).toLowerCase() },
    ],
  };
}

/** El contenido viaja dentro del contrato como un data: URI: la reserva se ve en la billetera sin ningún servidor. */
export const tokenUri = (metadata) => `data:application/json;base64,${Buffer.from(JSON.stringify(metadata)).toString('base64')}`;

const notSent = (err) => Object.assign(err, { notSent: true });

/**
 * Cliente real: manda las transacciones desde la billetera del agente (clave de TESTNET dedicada, nunca la del modo real).
 * Si la simulación falla, no sale nada (notSent); si salió y no se sabe, el reintento es seguro porque emitir, actualizar
 * y quemar son idempotentes (se revisa antes con exists()).
 */
export function createNftClient({ contract, privateKey, red = 'celoSepolia', rpcUrl, logger = console }) {
  const r = REDES_NFT[red];
  if (!r) throw new Error(`NFT_CHAIN desconocida: ${red}. Usá celoSepolia, sepolia o celo.`);
  const account = privateKeyToAccount(privateKey);
  const transport = http(rpcUrl ?? r.chain.rpcUrls.default.http[0]);
  const pub = createPublicClient({ chain: r.chain, transport });
  const wallet = createWalletClient({ account, chain: r.chain, transport });
  const address = getAddress(contract);
  const abi = ARTEFACTO.abi;

  async function enviar(functionName, args) {
    try {
      await pub.simulateContract({ address, abi, functionName, args, account });
    } catch (err) {
      throw notSent(Object.assign(new Error(err.shortMessage ?? err.message), { cause: err }));
    }
    const hash = await wallet.writeContract({ address, abi, functionName, args });
    const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 90_000 });
    if (receipt.status !== 'success') throw notSent(new Error(`La transacción ${hash} fue rechazada por el contrato.`));
    logger.info?.(`[nft] ${functionName} ${hash}`);
    return { hash };
  }

  return {
    simulated: false, red, redNombre: r.nombre, chainId: r.chain.id, testnet: r.testnet, contract: address, agentAddress: account.address,
    rpcUrl: rpcUrl ?? r.chain.rpcUrls.default.http[0], explorador: r.explorador, moneda: r.chain.nativeCurrency,
    urlToken: (tokenId) => r.token(r.explorador, address, tokenId),
    urlTx: (tx) => `${r.explorador}/tx/${tx}`,
    exists: (tokenId) => pub.readContract({ address, abi, functionName: 'exists', args: [BigInt(tokenId)] }),
    mint: ({ to, tokenId, uri }) => enviar('mint', [getAddress(to), BigInt(tokenId), uri]),
    setUri: (tokenId, uri) => enviar('setURI', [BigInt(tokenId), uri]),
    burn: (tokenId) => enviar('burn', [BigInt(tokenId)]),
  };
}

/** Cliente simulado (en memoria): mismo contrato de uso, sin cadena. Sirve para el modo prueba y los tests. */
export function createSimulatedNft({ red = 'celoSepolia', fallas = {} } = {}) {
  const r = REDES_NFT[red] ?? REDES_NFT.celoSepolia;
  const tokens = new Map(); // id -> { to, uri }
  const bloqueados = new Set(); // ids que no se pueden emitir (para probar qué pasa cuando la cadena no responde)
  const llamadas = [];
  const falla = (nombre) => {
    if ((fallas[nombre] ?? 0) > 0) { fallas[nombre] -= 1; throw notSent(new Error(`Falla simulada de ${nombre}`)); }
  };
  const tx = () => `0x${[...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
  const contract = '0x5e7A71c4e7000000000000000000000000000001';
  return {
    simulated: true, red, redNombre: `${r.nombre} · simulado`, chainId: r.chain.id, testnet: true, contract, agentAddress: '0x000000000000000000000000000000000000A6E1',
    rpcUrl: r.chain.rpcUrls.default.http[0], explorador: r.explorador, moneda: r.chain.nativeCurrency,
    tokens, llamadas, fallas, bloqueados,
    urlToken: (tokenId) => r.token(r.explorador, contract, tokenId),
    urlTx: (hash) => `${r.explorador}/tx/${hash}`,
    async exists(tokenId) { return tokens.has(String(tokenId)); },
    async mint({ to, tokenId, uri }) { falla('mint'); if (bloqueados.has(String(tokenId))) throw notSent(new Error('La cadena no respondió (simulado)')); if (tokens.has(String(tokenId))) throw notSent(new Error('YaExiste')); tokens.set(String(tokenId), { to: getAddress(to), uri }); llamadas.push(['mint', String(tokenId)]); return { hash: tx() }; },
    async setUri(tokenId, uri) { falla('setUri'); if (!tokens.has(String(tokenId))) throw notSent(new Error('NoExiste')); tokens.get(String(tokenId)).uri = uri; llamadas.push(['setUri', String(tokenId)]); return { hash: tx() }; },
    async burn(tokenId) { falla('burn'); if (!tokens.delete(String(tokenId))) throw notSent(new Error('NoExiste')); llamadas.push(['burn', String(tokenId)]); return { hash: tx() }; },
  };
}
