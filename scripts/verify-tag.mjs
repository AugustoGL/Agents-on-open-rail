// Verifica que una transacción tenga el tag de atribución.
//   npm run verify-tag -- 0xHASH
import { verifyTx } from '@celo/attribution-tags';
import { publicClient } from './lib.mjs';

const hash = process.argv.slice(2).find((a) => /^0x[0-9a-fA-F]{64}$/.test(a));
if (!hash) {
  console.error('Uso: npm run verify-tag -- 0x<hash de 64 caracteres>');
  process.exit(1);
}
const result = await verifyTx({ client: publicClient(), hash });
if (!result) {
  console.log('Esa transacción NO tiene tag ERC-8021.');
  process.exit(2);
}
console.log('Códigos en la transacción:', result.codes.join(', '));
const expected = process.env.ATTRIBUTION_TAG?.trim();
if (expected) console.log(result.codes.includes(expected) ? `✅ Incluye tu tag ${expected}` : `❌ No incluye tu tag ${expected}`);
