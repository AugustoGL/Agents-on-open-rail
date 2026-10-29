// Verifica en la cadena quién tiene el ticket de una reserva y si coincide con lo que Seña registró. SOLO LEE: no usa ninguna clave.
//   npm run nft:verificar -- --reserva S-ABC123                    -> existe, de quién es, estado y datos del ticket
//   npm run nft:verificar -- --reserva S-ABC123 --wallet 0x...     -> además compara con la billetera que debería tenerlo
//   npm run nft:verificar -- --wallet 0x... [--db data/sena.db]    -> cuántos tickets tiene esa billetera y cuáles de sus reservas coinciden
// Ojo: el ticket NO da acceso a la reserva. Para ver y cancelar reservas se firma un mensaje ("See my bookings with my wallet").
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { getAddress, isAddress } from 'viem';
import { createNftReader, verificarTicket } from '../src/nft.js';

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const falta = (m) => { console.error(m); process.exit(1); };
const contrato = arg('contrato') ?? process.env.NFT_CONTRACT?.trim() ?? falta('Falta NFT_CONTRACT en el archivo .env (o pasá --contrato 0x...).');
const nft = createNftReader({ contract: contrato, red: arg('red') ?? process.env.NFT_CHAIN?.trim() ?? 'celoSepolia', rpcUrl: process.env.NFT_RPC_URL?.trim() || undefined });
const wallet = arg('wallet') ? (isAddress(arg('wallet')) ? getAddress(arg('wallet')) : falta('--wallet no es una dirección válida.')) : null;
const reserva = arg('reserva')?.toUpperCase();
if (!reserva && !wallet) falta('Indicá --reserva S-XXXXXX y/o --wallet 0x...');

const mostrar = (r) => {
  console.log(`${r.ok ? '✅' : '❌'} ${r.reserva} · token ${r.tokenId.slice(0, 12)}…`);
  if (r.existe) console.log(`   dueño ${r.dueno} · estado ${r.estado ?? '—'} · intransferible ${r.intransferible} · ${r.url}`);
  if (r.problema) console.log(`   ${r.problema}`);
};

console.log(`Red: ${nft.redNombre} · contrato ${nft.contract}`);
let fallos = 0;
if (reserva) {
  const r = await verificarTicket(nft, reserva, { esperadoA: wallet ?? undefined });
  mostrar(r); if (!r.ok) fallos += 1;
} else {
  console.log(`Tickets que tiene ${wallet} en este contrato: ${await nft.balanceOf(wallet)}`);
  const ruta = arg('db') ?? process.env.DB_PATH ?? 'data/sena.db';
  if (!existsSync(ruta)) console.log(`(No encuentro la base ${ruta}: no puedo relacionar los tickets con reservas. Pasá --db ruta.)`);
  else {
    const db = new DatabaseSync(ruta, { readOnly: true });
    const filas = db.prepare("SELECT id FROM bookings WHERE lower(coalesce(nft_to, payer)) = lower(?) AND nft_state IN ('minted','used') ORDER BY start_at").all(wallet);
    console.log(`Reservas de esa billetera con ticket emitido en la base: ${filas.length}`);
    for (const { id } of filas) { const r = await verificarTicket(nft, id, { esperadoA: wallet }); mostrar(r); if (!r.ok) fallos += 1; }
  }
}
process.exit(fallos ? 1 : 0);
