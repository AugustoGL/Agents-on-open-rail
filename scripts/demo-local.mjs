// Demo completa SIN plata real: levanta el servidor con un facilitador y una cadena simulados,
// y dos agentes compradores pagan de verdad con x402 (firmas Permit2 reales, liquidación simulada).
// Muestra cada decisión del agente con su motivo.
//   npm run demo
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { openDb } from '../src/db.js';
import { SenaAgent } from '../src/agent.js';
import { createMockChain } from '../src/chain.js';
import { createPaymentServer, MockFacilitator } from '../src/x402.js';
import { createApp } from '../src/server.js';
import { createPayingFetch, readPaymentResponse } from '../src/buyer.js';
import { loadBusiness } from '../src/config.js';
import { arsToWei, formatArs } from '../src/money.js';
import { localToUtcMs, localDateStr, addDays } from '../src/time.js';

const quiet = { info() {}, warn: console.warn, error: console.error };
const business = loadBusiness();
const offset = business.utcOffsetMinutos;
let now = Date.now();
const clock = { now: () => now };
const chain = createMockChain({ logger: quiet });
const store = openDb(':memory:');
const notifier = {
  async toCustomer(id, text) { console.log(`   📱 a ${id}: ${text.split('\n')[0]}`); },
  async toOwner(text) { console.log(`   👤 al dueño: ${text.split('\n')[0]}`); },
};
const agent = new SenaAgent({ store, business, chain, clock, notifier, logger: quiet, payoutAddress: '0x000000000000000000000000000000000000dEaD' });
const facilitator = new MockFacilitator({ chain, logger: quiet });
const payments = createPaymentServer({ agent, facilitator, payTo: chain.address, builderCode: 'celo_aa27de260db7', logger: quiet });
const app = createApp({ agent, payments, logger: quiet });
const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const base = `http://127.0.0.1:${server.address().port}`;
agent.publicBaseUrl = base;

const step = (t) => console.log(`\n▶ ${t}`);
const decisionsSince = (id) => store.decisions({ limit: 100 }).filter((d) => d.id > id).reverse();
let lastDecision = 0;
const showDecisions = () => {
  for (const d of decisionsSince(lastDecision)) console.log(`   🧠 ${d.rule}: ${d.reason}${d.tx ? ` [tx ${d.tx.slice(0, 12)}…]` : ''}`);
  lastDecision = store.decisions({ limit: 1 })[0]?.id ?? lastDecision;
};
const post = async (path, body) => {
  const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
async function payAs(name, account, booking) {
  const payingFetch = createPayingFetch({ signer: account, maxPerPaymentWei: arsToWei(10000) });
  const res = await payingFetch(booking.pagarEn, { method: 'POST' });
  const receipt = readPaymentResponse(res);
  console.log(`   💸 ${name} pagó ${booking.sena.texto} por x402 (firma Permit2 de ${account.address.slice(0, 8)}…) → ${res.status} ${receipt?.transaction?.slice(0, 12) ?? ''}…`);
}

const day = addDays(localDateStr(now, offset), 2);
const hora = business.horarios.at(-2);
const startAt = localToUtcMs(day, hora, offset);
const alicia = privateKeyToAccount(generatePrivateKey());
const beto = privateKeyToAccount(generatePrivateKey());

console.log(`Demo de Seña · ${business.nombre} · seña ${formatArs(agent.depositWei())} · wallet del agente ${chain.address}`);

step(`El agente de Alicia reserva ${business.recursos[0]} el ${day} a las ${hora} y paga la seña`);
const a = await post('/api/reservas', { recurso: business.recursos[0], fecha: day, hora, cliente: { nombre: 'Alicia' } });
await payAs('Alicia', alicia, a.body.reserva);
showDecisions();

step('Beto quiere el mismo turno: está ocupado, así que se anota en la lista de espera');
const b = await post('/api/reservas', { recurso: business.recursos[0], fecha: day, hora, cliente: { nombre: 'Beto' } });
console.log(`   ${b.status}: ${b.body.error}`);
const betoToken = 'api:' + 'b'.repeat(32);
const w = await post(`/api/reservas/${a.body.reserva.id}/lista-espera`, { clienteToken: betoToken });
console.log(`   Beto quedó en el puesto ${w.body.puesto}`);
showDecisions();

step('Faltan 3 horas y Alicia cancela: la política dice que la seña queda para el complejo...');
now = startAt - 3 * 3_600_000;
const c = await post(`/api/reservas/${a.body.reserva.id}/cancelar`, { clienteToken: a.body.clienteToken });
console.log(`   ${c.body.regla}: devolución ${c.body.devolucion}`);
showDecisions();

step('...pero el agente le ofrece el turno a Beto, que paga. Como el turno se revendió, le devuelve la seña a Alicia');
const offer = store.activeBookingForSlot(business.recursos[0], startAt);
const offerView = (await (await fetch(`${base}/api/reservas/${offer.id}`)).json()).reserva;
await payAs('Beto', beto, offerView);
showDecisions();

step('Alguien reserva otro turno y no paga: a los 15 minutos el agente lo libera');
const otherHora = business.horarios.at(-1);
await post('/api/reservas', { recurso: business.recursos[1], fecha: day, hora: otherHora, cliente: { nombre: 'Carla' } });
now += 16 * 60_000;
await agent.expireHolds();
showDecisions();

step('Se juega el turno y llega el cierre del día');
now = startAt + 2 * 3_600_000;
agent.completeFinished();
const { report } = await agent.dailyClose({ dateStr: day });
showDecisions();
console.log(`\n${report}`);
console.log(`\nTransferencias que mandó la wallet del agente (en mainnet llevarían el tag): ${chain.state.sent.length}`);
for (const t of chain.state.sent) console.log(`   ${formatArs(t.amountWei)} → ${t.to}`);
server.close();
