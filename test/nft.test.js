// Ticket NFT de la reserva: contenido, cola de emisión (idempotente y con reintentos), quema al cancelar y estado "jugada".
// El cliente es el simulado (en memoria); el contrato en sí se probó en una EVM local (contracts/probar/).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createApp } from '../src/server.js';
import { createSimulatedNft, tokenIdFor, ticketSvg, ticketMetadata, tokenUri, ARTEFACTO } from '../src/nft.js';
import { loadConfig } from '../src/config.js';
import { SenaAgent } from '../src/agent.js';
import { createPaymentServer, MockFacilitator } from '../src/x402.js';
import { makeAgent, slot, alice, bob, PAYER_A, PAYER_B, silent, HOUR } from './helpers.js';
import { openDb } from '../src/db.js';
import { createMockChain } from '../src/chain.js';
import { business } from './helpers.js';

const WED_20 = slot('2026-10-21', '20:00');
const leer = (uri) => JSON.parse(Buffer.from(uri.split(',')[1], 'base64').toString('utf8'));

/** Un agente con tickets NFT simulados. */
function conNft(fallas = {}) {
  const nft = createSimulatedNft({ fallas });
  const store = openDb(':memory:');
  const ctx = makeAgent();
  const agent = new SenaAgent({ store: ctx.store, business, chain: ctx.chain, clock: ctx.clock, notifier: ctx.notifier, logger: silent, publicBaseUrl: 'http://test.local', payoutAddress: '0x000000000000000000000000000000000000dEaD', nft });
  void store;
  return { ...ctx, agent, nft };
}
async function pagar(ctx, booking, payer = PAYER_A, tx = `0x${'cd'.repeat(32)}${booking.id}`) {
  ctx.chain.credit(booking.deposit_wei);
  return ctx.agent.onPaymentSettled({ bookingId: booking.id, payer, tx, amountWei: booking.deposit_wei });
}

// --- Contenido del ticket ---------------------------------------------------------------------------------

test('el id del ticket sale del código de la reserva', () => {
  assert.equal(tokenIdFor('S-ABC123'), tokenIdFor('S-ABC123'));
  assert.notEqual(tokenIdFor('S-ABC123'), tokenIdFor('S-ABC124'));
  assert.ok(tokenIdFor('S-ABC123') > 0n);
});

test('la imagen del ticket escapa lo que viene del comercio y cambia con el estado', () => {
  const svg = ticketSvg({ negocio: '<script>alert(1)</script> & "Club"', recurso: "Cancha <b>1</b>", cuando: 'jue 29/10 20:00', sena: '$ 6,000', codigo: 'S-ABC123' });
  assert.ok(!/<script|<b>/.test(svg));
  assert.match(svg, /&lt;script&gt;/);
  assert.match(svg, /CONFIRMED/);
  assert.match(ticketSvg({ negocio: 'x', recurso: 'y', cuando: 'z', sena: '$ 1', codigo: 'S-1', estado: 'jugada' }), /PLAYED/);
  assert.ok(svg.length < 2000, `el SVG pesa ${svg.length} bytes (más chico = menos gas)`);
});

test('los datos del ticket tienen el formato estándar y no llevan datos personales', () => {
  const m = ticketMetadata({ negocio: 'Pádel Demo', recurso: 'Court 1', cuando: 'jue 29/10 20:00', inicioMs: Date.UTC(2026, 9, 29, 23), sena: '$ 6,000', codigo: 'S-ABC123', urlBase: 'https://sena.example/' });
  assert.equal(m.name, 'Booking S-ABC123 · Court 1');
  assert.match(m.image, /^data:image\/svg\+xml;base64,/);
  assert.equal(m.external_url, 'https://sena.example/pagar/S-ABC123');
  assert.deepEqual(m.attributes.map((a) => a.trait_type), ['Venue', 'Court', 'Slot', 'Start', 'Deposit', 'Status']);
  assert.equal(m.attributes.find((a) => a.trait_type === 'Start').value, Math.floor(Date.UTC(2026, 9, 29, 23) / 1000));
  const uri = tokenUri(m);
  assert.deepEqual(leer(uri), m);
});

test('el contrato compilado coincide con su código fuente y tiene lo que usa el agente', () => {
  const fuente = readFileSync(new URL('../contracts/SenaTicket.sol', import.meta.url), 'utf8');
  assert.equal(ARTEFACTO.fuenteSha256, createHash('sha256').update(fuente).digest('hex'), 'cambió el contrato: corré npm run nft:compile');
  const funciones = ARTEFACTO.abi.filter((x) => x.type === 'function').map((x) => x.name);
  for (const f of ['mint', 'setURI', 'burn', 'exists', 'ownerOf', 'tokenURI', 'locked', 'supportsInterface', 'transferFrom', 'approve']) assert.ok(funciones.includes(f), f);
  assert.match(ARTEFACTO.bytecode, /^0x6080/);
});

// --- Flujo con el agente ----------------------------------------------------------------------------------------

test('al pagar se le manda el ticket a la billetera que pagó, una sola vez', async () => {
  const ctx = conNft();
  const { booking } = ctx.agent.reserve({ resource: 'Court 1', startAt: WED_20, customer: alice });
  const r = await pagar(ctx, booking);
  assert.equal(r.kind, 'confirmado');
  const id = tokenIdFor(booking.id);
  const t = ctx.nft.tokens.get(String(id));
  assert.equal(t.to, PAYER_A);
  assert.equal(leer(t.uri).name, `Booking ${booking.id} · Court 1`);
  const row = ctx.store.getBooking(booking.id);
  assert.equal(row.nft_state, 'minted');
  assert.equal(row.nft_action, null);
  assert.match(row.nft_tx, /^0x[0-9a-f]{64}$/);
  assert.equal(row.nft_token_id, String(id));
  assert.ok(ctx.store.decisions({ bookingId: booking.id }).some((d) => d.rule === 'NFT_ENVIADO' && d.tx === row.nft_tx));
  assert.ok(ctx.notifier.forCustomer(alice.id).some((m) => /is now in your wallet as an NFT/.test(m.text)));
  const info = ctx.agent.nftInfo(row);
  assert.equal(info.estado, 'enviado');
  assert.equal(info.billetera, PAYER_A);
  assert.equal(info.simulado, true);
  assert.equal(info.urlTx, null); // una transacción simulada no tiene página en el explorador
  // El mismo aviso de pago otra vez no emite otro ticket.
  assert.equal((await pagar(ctx, booking)).kind, 'repetido');
  await ctx.agent.processNft();
  assert.equal(ctx.nft.llamadas.filter(([a]) => a === 'mint').length, 1);
});

test('el ticket va a la billetera elegida si no es la que pagó (nft_to)', async () => {
  const ctx = conNft();
  const { booking } = ctx.agent.reserve({ resource: 'Court 1', startAt: WED_20, customer: alice });
  ctx.store.updateBooking(booking.id, { nft_to: PAYER_B }, ctx.agent.now());
  await pagar(ctx, booking, PAYER_A);
  assert.equal(ctx.nft.tokens.get(String(tokenIdFor(booking.id))).to, PAYER_B);
  assert.equal(ctx.store.getBooking(booking.id).payer, PAYER_A); // la devolución sigue yendo a quien pagó
});

test('cancelar quema el ticket; no queda nada en la billetera', async () => {
  const ctx = conNft();
  const { booking } = ctx.agent.reserve({ resource: 'Court 1', startAt: WED_20, customer: alice });
  await pagar(ctx, booking);
  const r = await ctx.agent.cancel({ bookingId: booking.id, customerId: alice.id });
  assert.ok(r.ok);
  assert.equal(ctx.nft.tokens.size, 0);
  const row = ctx.store.getBooking(booking.id);
  assert.equal(row.nft_state, 'burned');
  assert.equal(ctx.agent.nftInfo(row), null);
  assert.ok(ctx.store.decisions({ bookingId: booking.id }).some((d) => d.rule === 'NFT_QUEMADO'));
  // La seña se devolvió igual: el NFT no cambia nada del dinero.
  assert.ok(ctx.store.transfersByStatus('sent').some((t) => t.booking_id === booking.id));
});

test('cuando se juega el turno, el ticket pasa a "jugada" y queda de recuerdo', async () => {
  const ctx = conNft();
  const { booking } = ctx.agent.reserve({ resource: 'Court 1', startAt: WED_20, customer: alice });
  await pagar(ctx, booking);
  ctx.clock.set(WED_20 + 3 * HOUR);
  ctx.agent.completeFinished();
  await ctx.agent.processNft();
  const t = ctx.nft.tokens.get(String(tokenIdFor(booking.id)));
  assert.match(leer(t.uri).attributes.find((a) => a.trait_type === 'Status').value, /Played/);
  assert.equal(ctx.store.getBooking(booking.id).nft_state, 'used');
  assert.equal(ctx.agent.nftInfo(ctx.store.getBooking(booking.id)).estado, 'jugado');
  assert.ok(ctx.store.decisions({ bookingId: booking.id }).some((d) => d.rule === 'NFT_USADO'));
});

test('si la cadena falla, la reserva queda confirmada y el ticket se reintenta solo', async () => {
  const ctx = conNft({ mint: 2 });
  const { booking } = ctx.agent.reserve({ resource: 'Court 1', startAt: WED_20, customer: alice });
  const r = await pagar(ctx, booking);
  assert.equal(r.kind, 'confirmado');
  assert.equal(ctx.store.getBooking(booking.id).status, 'confirmed'); // la reserva no depende del NFT
  let row = ctx.store.getBooking(booking.id);
  assert.equal(row.nft_action, 'mint');
  assert.equal(row.nft_attempts, 1);
  assert.equal(ctx.agent.nftInfo(row).estado, 'enviando');
  await ctx.agent.processNft(); // segundo intento: falla
  assert.equal(ctx.store.getBooking(booking.id).nft_attempts, 2);
  await ctx.agent.processNft(); // tercer intento: sale
  row = ctx.store.getBooking(booking.id);
  assert.equal(row.nft_state, 'minted');
  assert.equal(row.nft_attempts, 0);
  assert.equal(row.nft_error, null);
  assert.equal(ctx.nft.tokens.size, 1);
});

test('si falla 5 veces se avisa al dueño y se puede reintentar desde el panel', async () => {
  const ctx = conNft({ mint: 99 });
  const { booking } = ctx.agent.reserve({ resource: 'Court 1', startAt: WED_20, customer: alice });
  await pagar(ctx, booking);
  for (let i = 0; i < 6; i++) await ctx.agent.processNft();
  const row = ctx.store.getBooking(booking.id);
  assert.equal(row.nft_attempts, 5); // dejó de reintentar solo
  assert.equal(ctx.agent.nftInfo(row).estado, 'error');
  assert.match(ctx.agent.nftInfo(row).error, /Simulated failure/);
  assert.ok(ctx.store.decisions({ bookingId: booking.id }).some((d) => d.rule === 'NFT_FALLO'));
  assert.ok(ctx.notifier.forOwner().some((m) => /NFT ticket/.test(m.text)));
  assert.equal(ctx.store.getBooking(booking.id).status, 'confirmed');
  ctx.nft.fallas.mint = 0; // la cadena vuelve
  const re = await ctx.agent.retryNft(booking.id);
  assert.ok(re.ok);
  assert.equal(re.nft.estado, 'enviado');
  assert.equal(ctx.nft.tokens.size, 1);
});

test('si se cancela antes de que salga el ticket, nunca se emite', async () => {
  const ctx = conNft({ mint: 99 });
  const { booking } = ctx.agent.reserve({ resource: 'Court 1', startAt: WED_20, customer: alice });
  await pagar(ctx, booking);
  await ctx.agent.cancel({ bookingId: booking.id, customerId: alice.id });
  ctx.nft.fallas.mint = 0;
  await ctx.agent.processNft();
  assert.equal(ctx.nft.tokens.size, 0);
  assert.equal(ctx.store.getBooking(booking.id).nft_action, null);
});

test('si el ticket ya existía en la cadena (un reintento después de un corte), no se emite de nuevo', async () => {
  const ctx = conNft();
  const { booking } = ctx.agent.reserve({ resource: 'Court 1', startAt: WED_20, customer: alice });
  ctx.nft.tokens.set(String(tokenIdFor(booking.id)), { to: PAYER_A, uri: 'data:,previo' }); // salió pero no se llegó a anotar
  await pagar(ctx, booking);
  assert.equal(ctx.nft.llamadas.filter(([a]) => a === 'mint').length, 0);
  assert.equal(ctx.store.getBooking(booking.id).nft_state, 'minted');
});

test('sin cliente de NFT todo sigue igual y no hay ticket', async () => {
  const ctx = makeAgent();
  const { booking } = ctx.agent.reserve({ resource: 'Court 1', startAt: WED_20, customer: alice });
  await pagar(ctx, booking);
  assert.equal(ctx.agent.nftInfo(ctx.store.getBooking(booking.id)), null);
  assert.equal(ctx.store.getBooking(booking.id).nft_action, null);
  assert.equal(await ctx.agent.processNft(), 0);
  assert.equal((await ctx.agent.retryNft(booking.id)).ok, false);
});

// --- Por HTTP -----------------------------------------------------------------------------------------------------

let server; let base; let ctxHttp;
before(async () => {
  ctxHttp = conNft();
  const facilitator = new MockFacilitator({ chain: ctxHttp.chain, logger: silent });
  const payments = createPaymentServer({ agent: ctxHttp.agent, facilitator, payTo: ctxHttp.chain.address, builderCode: null, logger: silent });
  const app = createApp({ agent: ctxHttp.agent, payments, logger: silent, dashboardPassword: 'TEST_ONLY_fake_password_123', createLimit: { windowMs: 60_000, max: 500 } });
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  ctxHttp.agent.publicBaseUrl = base;
});
after(() => new Promise((resolve) => server.close(resolve)));
const post = async (path, body) => { const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) }); return { status: r.status, body: await r.json() }; };

test('pago de prueba con billetera conectada: el ticket NFT va a esa billetera y se ve en la API', async () => {
  const r = await post('/api/reservas', { recurso: 'Court 1', fecha: '2026-10-22', hora: '17:00', cliente: { nombre: 'Marta', canal: 'web' } });
  const id = r.body.reserva.id;
  assert.equal(r.body.reserva.nft, null); // todavía no pagó
  const meta0 = await fetch(`${base}/api/reservas/${id}/nft`);
  assert.equal(meta0.status, 404);
  const destino = '0x1234567890abcdef1234567890abcdef12345678';
  const paid = await post(`/api/modo-prueba/pagar/${id}`, { billetera: destino });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  const reserva = (await (await fetch(`${base}/api/reservas/${id}`)).json()).reserva;
  assert.equal(reserva.nft.estado, 'enviado');
  assert.equal(reserva.nft.billetera.toLowerCase(), destino);
  assert.equal(reserva.nft.simulado, true);
  assert.equal(ctxHttp.nft.tokens.get(String(tokenIdFor(id))).to.toLowerCase(), destino);
  const meta = await (await fetch(`${base}/api/reservas/${id}/nft`)).json();
  assert.equal(meta.metadata.name, `Booking ${id} · Court 1`);
  assert.match(meta.metadata.image, /^data:image\/svg\+xml;base64,/);
  assert.ok(!JSON.stringify(meta).includes('Marta')); // el ticket no lleva nombres
  // Una dirección inválida se ignora: el ticket va a quien pagó.
  const r2 = await post('/api/reservas', { recurso: 'Court 2', fecha: '2026-10-22', hora: '17:00', cliente: { nombre: 'Beto', canal: 'web' } });
  await post(`/api/modo-prueba/pagar/${r2.body.reserva.id}`, { billetera: '0xnoesunadireccion' });
  assert.match(ctxHttp.nft.tokens.get(String(tokenIdFor(r2.body.reserva.id))).to, /^0x[0-9a-fA-F]{40}$/);
});

test('el panel ve el ticket de cada reserva y puede reintentarlo (con CSRF)', async () => {
  const login = await fetch(`${base}/panel/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clave: 'TEST_ONLY_fake_password_123' }) });
  const cookie = login.headers.getSetCookie()[0].split(';')[0];
  const { csrf } = await login.json();
  const lista = await (await fetch(`${base}/panel/api/reservas?estado=confirmed`, { headers: { cookie } })).json();
  assert.ok(lista.reservas.length >= 1);
  assert.equal(lista.reservas[0].nft.estado, 'enviado');
  const sinCsrf = await fetch(`${base}/panel/api/reservas/${lista.reservas[0].id}/nft/reintentar`, { method: 'POST', headers: { cookie } });
  assert.equal(sinCsrf.status, 403);
  const nada = await fetch(`${base}/panel/api/reservas/${lista.reservas[0].id}/nft/reintentar`, { method: 'POST', headers: { cookie, 'x-csrf-token': csrf } });
  assert.equal(nada.status, 409); // no hay nada pendiente: está enviado
});

// --- Configuración ------------------------------------------------------------------------------------------------

test('la configuración del NFT se valida', () => {
  const guardar = { ...process.env };
  const con = (env, fn) => { for (const k of Object.keys(process.env)) if (k.startsWith('NFT_') || k === 'MODE') delete process.env[k]; Object.assign(process.env, env); try { return fn(); } finally { for (const k of Object.keys(process.env)) if (!(k in guardar)) delete process.env[k]; Object.assign(process.env, guardar); } };
  assert.throws(() => con({ NFT_CONTRACT: '0x1234567890abcdef1234567890abcdef12345678' }, loadConfig), /NFT_PRIVATE_KEY/);
  assert.throws(() => con({ NFT_CONTRACT: 'no-es-una-direccion', NFT_PRIVATE_KEY: `0x${'11'.repeat(32)}` }, loadConfig), /NFT_CONTRACT/);
  assert.throws(() => con({ MODE: 'live', NFT_SIMULADO: 'true', AGENT_PRIVATE_KEY: `0x${'11'.repeat(32)}`, ATTRIBUTION_TAG: 'celo_aa27de260db7', X402_API_KEY: 'x' }, loadConfig), /NFT_SIMULADO solo/);
  const cfg = con({ NFT_CONTRACT: '0x1234567890abcdef1234567890abcdef12345678', NFT_PRIVATE_KEY: `11${'11'.repeat(31)}` }, loadConfig);
  assert.equal(cfg.nftChain, 'celoSepolia'); // por defecto, una testnet
  assert.match(cfg.nftPrivateKey, /^0x/);
});
