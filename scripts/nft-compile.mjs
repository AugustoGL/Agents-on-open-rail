// Compila contracts/SenaTicket.sol y guarda el resultado (ABI + bytecode) en contracts/SenaTicket.json.
// El resultado ya viene compilado en el repo: esto solo hace falta si cambiás el contrato.
//   npm install --no-save solc@0.8.24     (no toca package.json)
//   npm run nft:compile
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

let solc;
try {
  solc = (await import(process.env.SOLC_MODULE ?? 'solc')).default;
} catch {
  console.error('Falta el compilador. Instalalo sin tocar package.json: npm install --no-save solc@0.8.24');
  process.exit(1);
}
const fuente = readFileSync(new URL('../contracts/SenaTicket.sol', import.meta.url), 'utf8');
const entrada = {
  language: 'Solidity',
  sources: { 'SenaTicket.sol': { content: fuente } },
  // "paris": sin PUSH0, funciona en Celo, Celo Sepolia y Ethereum Sepolia.
  settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } },
};
const salida = JSON.parse(solc.compile(JSON.stringify(entrada)));
const errores = (salida.errors ?? []).filter((e) => e.severity === 'error');
for (const e of salida.errors ?? []) console.error(e.formattedMessage);
if (errores.length) process.exit(1);
const c = salida.contracts['SenaTicket.sol'].SenaTicket;
const artefacto = {
  contrato: 'SenaTicket',
  compilador: `solc ${solc.version()}`,
  evmVersion: 'paris',
  optimizador: { enabled: true, runs: 200 },
  fuenteSha256: createHash('sha256').update(fuente).digest('hex'),
  abi: c.abi,
  bytecode: `0x${c.evm.bytecode.object}`,
};
writeFileSync(new URL('../contracts/SenaTicket.json', import.meta.url), `${JSON.stringify(artefacto, null, 2)}\n`);
console.log(`Listo: contracts/SenaTicket.json (${(artefacto.bytecode.length - 2) / 2} bytes de bytecode, ${artefacto.compilador}).`);
