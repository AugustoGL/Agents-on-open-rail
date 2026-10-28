// Prueba del contrato SenaTicket en una EVM local (ganache), sin red ni plata. Cubre: solo el agente emite, no se puede
// emitir dos veces la misma reserva, es intransferible (ni el agente transfiere), el agente actualiza y quema, y el dueño
// puede cambiar de agente. Ganache NO es una dependencia del proyecto: se instala solo para esta prueba y sin tocar package.json.
//   npm install --no-save ganache@7.9.2
//   node contracts/probar/SenaTicket.ganache.mjs
import ganache from 'ganache';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, custom, keccak256, toHex, getContract, encodeFunctionData, toFunctionSelector } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';

const art = JSON.parse(readFileSync(process.env.ARTEFACTO ?? new URL('../SenaTicket.json', import.meta.url), 'utf8'));
const claves = [
  '0x' + '11'.repeat(32), '0x' + '22'.repeat(32), '0x' + '33'.repeat(32), '0x' + '44'.repeat(32),
];
const cuentas = claves.map((k) => privateKeyToAccount(k));
const provider = ganache.provider({ logging: { quiet: true }, chain: { hardfork: 'shanghai', chainId: 31337 }, wallet: { accounts: claves.map((k) => ({ secretKey: k, balance: '0x56BC75E2D63100000' })) } });
const chain = { ...foundry, id: 31337 };
const pub = createPublicClient({ chain, transport: custom(provider) });
const wallet = (account) => createWalletClient({ account, chain, transport: custom(provider) });
const [duenio, agente, cliente, otro] = cuentas;

const hash = await wallet(duenio).deployContract({ abi: art.abi, bytecode: art.bytecode, args: [agente.address] });
const { contractAddress } = await pub.waitForTransactionReceipt({ hash });
const c = (account) => getContract({ address: contractAddress, abi: art.abi, client: { public: pub, wallet: wallet(account) } });
const id = BigInt(keccak256(toHex('S-ABC123')));
const uri = 'data:application/json;base64,' + Buffer.from(JSON.stringify({ name: 'Reserva S-ABC123', image: 'data:image/svg+xml;base64,AAAA' })).toString('base64');
const revierte = async (desde, functionName, args, error) => {
  try {
    await provider.request({ method: 'eth_call', params: [{ from: desde.address, to: contractAddress, data: encodeFunctionData({ abi: art.abi, functionName, args }) }, 'latest'] });
  } catch (e) { assert.equal(e.data, toFunctionSelector(`${error}()`), `${functionName}: esperaba ${error}, vino ${e.data}`); return; }
  assert.fail(`${functionName} no revirtió (esperaba ${error})`);
};
const esperar = async (h) => { const r = await pub.waitForTransactionReceipt({ hash: h }); assert.equal(r.status, 'success'); return r; };

assert.equal(await c(duenio).read.name(), 'Seña Ticket');
assert.equal(await c(duenio).read.symbol(), 'SENA');
assert.equal((await c(duenio).read.agent()).toLowerCase(), agente.address.toLowerCase());
assert.equal((await c(duenio).read.owner()).toLowerCase(), duenio.address.toLowerCase());
for (const i of ['0x01ffc9a7', '0x80ac58cd', '0x5b5e139f', '0xb45a3c0e', '0x49064906']) assert.equal(await c(duenio).read.supportsInterface([i]), true, i);
assert.equal(await c(duenio).read.supportsInterface(['0xffffffff']), false);

// Solo el agente emite
await revierte(cliente, 'mint', [cliente.address, id, uri], 'SoloAgente');
await revierte(duenio, 'mint', [cliente.address, id, uri], 'SoloAgente');
await revierte(agente, 'mint', ['0x0000000000000000000000000000000000000000', id, uri], 'DireccionInvalida');
const rMint = await esperar(await c(agente).write.mint([cliente.address, id, uri]));
console.log('gas del mint:', rMint.gasUsed);
const logs = rMint.logs.map((l) => l.topics[0]);
assert.equal(rMint.logs.length, 2); // Transfer + Locked
assert.equal((await c(duenio).read.ownerOf([id])).toLowerCase(), cliente.address.toLowerCase());
assert.equal(await c(duenio).read.balanceOf([cliente.address]), 1n);
assert.equal(await c(duenio).read.tokenURI([id]), uri);
assert.equal(await c(duenio).read.locked([id]), true);
assert.equal(await c(duenio).read.exists([id]), true);
assert.equal(await c(duenio).read.getApproved([id]), '0x0000000000000000000000000000000000000000');
assert.equal(await c(duenio).read.isApprovedForAll([cliente.address, otro.address]), false);

// No se puede emitir dos veces la misma reserva (idempotencia)
await revierte(agente, 'mint', [cliente.address, id, uri], 'YaExiste');

// Intransferible
await revierte(cliente, 'transferFrom', [cliente.address, otro.address, id], 'Intransferible');
await revierte(cliente, 'safeTransferFrom', [cliente.address, otro.address, id], 'Intransferible');
await revierte(cliente, 'approve', [otro.address, id], 'Intransferible');
await revierte(cliente, 'setApprovalForAll', [otro.address, true], 'Intransferible');
await revierte(agente, 'transferFrom', [cliente.address, otro.address, id], 'Intransferible'); // ni el agente

// Actualizar el estado (jugada) lo hace solo el agente
const uri2 = uri + 'x';
await revierte(cliente, 'setURI', [id, uri2], 'SoloAgente');
await revierte(agente, 'setURI', [id + 1n, uri2], 'NoExiste');
const rSet = await esperar(await c(agente).write.setURI([id, uri2]));
assert.equal(rSet.logs.length, 1); // MetadataUpdate
assert.equal(await c(duenio).read.tokenURI([id]), uri2);

// Quemar
await revierte(cliente, 'burn', [id], 'SoloAgente');
await esperar(await c(agente).write.burn([id]));
assert.equal(await c(duenio).read.exists([id]), false);
assert.equal(await c(duenio).read.balanceOf([cliente.address]), 0n);
await revierte(duenio, 'ownerOf', [id], 'NoExiste');
await revierte(duenio, 'tokenURI', [id], 'NoExiste');
await revierte(agente, 'burn', [id], 'NoExiste');
// Después de quemar se puede volver a emitir el mismo id (por ejemplo, una reserva reactivada)
await esperar(await c(agente).write.mint([otro.address, id, uri]));
assert.equal(await c(duenio).read.balanceOf([otro.address]), 1n);

// Cambiar de agente
await revierte(agente, 'setAgent', [otro.address], 'SoloDuenio');
await esperar(await c(duenio).write.setAgent([otro.address]));
await revierte(agente, 'mint', [cliente.address, id + 7n, uri], 'SoloAgente');
await esperar(await c(otro).write.mint([cliente.address, id + 7n, uri]));
console.log('✅ El contrato SenaTicket pasa todas las pruebas en una EVM local (ganache).');
await provider.disconnect();
