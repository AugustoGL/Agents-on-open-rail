// Ver y cancelar reservas con la billetera: se prueba con una firma de verdad (sin gas, sin cadena).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createApp } from '../src/server.js';
import { arsToWei } from '../src/money.js';
import { makeAgent, slot, alice, bob, silent } from './helpers.js';

let ctx; let server; let base; let ahora = 1_000_000;
const yo = privateKeyToAccount(generatePrivateKey());
const otra = privateKeyToAccount(generatePrivateKey());

before(async () => {
  ctx = makeAgent();
  const app = createApp({ agent: ctx.agent, logger: silent, createLimit: { windowMs: 60_000, max: 500 }, walletOptions: { now: () => ahora, ttlDesafioMs: 60_000, ttlSesionMs: 120_000 } });
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((resolve) => server.close(resolve)));

const post = async (path, body) => { const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) }); return { status: r.status, body: await r.json() }; };
const pagar = async (customer, dia, hora, payer, recurso = 'Court 1') => {
  const { booking } = ctx.agent.reserve({ resource: recurso, startAt: slot(dia, hora), customer });
  ctx.chain.credit(booking.deposit_wei);
  await ctx.agent.onPaymentSettled({ bookingId: booking.id, payer, tx: `0x${'ab'.repeat(32)}${booking.id}`, amountWei: booking.deposit_wei });
  return ctx.store.getBooking(booking.id);
};
/** Conecta la billetera: pide el mensaje, lo firma y devuelve la respuesta del servidor. */
async function conectar(cuenta, { direccion = cuenta.address, firmante = cuenta } = {}) {
  const d = await post('/api/billetera/desafio', { direccion });
  assert.equal(d.status, 200, JSON.stringify(d.body));
  const firma = await firmante.signMessage({ message: d.body.mensaje });
  return { desafio: d.body, ...(await post('/api/billetera/reservas', { direccion, nonce: d.body.nonce, firma })) };
}

test('el mensaje a firmar dice qué se firma, para qué billetera, en qué sitio y cuándo vence', async () => {
  const d = await post('/api/billetera/desafio', { direccion: yo.address.toLowerCase() });
  assert.match(d.body.mensaje, /Seña · See my bookings/);
  assert.match(d.body.mensaje, /costs nothing and moves no money/);
  assert.ok(d.body.mensaje.includes(`Wallet: ${yo.address}`)); // la dirección queda normalizada
  assert.match(d.body.mensaje, /Site: 127\.0\.0\.1/);
  assert.ok(d.body.mensaje.includes(`Code: ${d.body.nonce}`));
  assert.match(d.body.nonce, /^[a-f0-9]{32}$/);
});

test('firmando se ven solo las reservas pagadas desde esa billetera', async () => {
  const mia1 = await pagar(alice, '2026-10-21', '20:00', yo.address);
  const mia2 = await pagar(bob, '2026-10-22', '18:30', yo.address, 'Court 2'); // otra persona del chat, misma billetera
  const ajena = await pagar(bob, '2026-10-23', '17:00', otra.address);
  ctx.agent.reserve({ resource: 'Court 1', startAt: slot('2026-10-24', '12:00'), customer: alice }); // sin pagar: todavía no tiene billetera

  const r = await conectar(yo);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.direccion, yo.address);
  assert.deepEqual(r.body.reservas.map((b) => b.id).sort(), [mia1.id, mia2.id].sort());
  assert.ok(!r.body.reservas.some((b) => b.id === ajena.id));
  assert.match(r.body.sesion, /^[a-f0-9]{48}$/);
  assert.equal(r.body.reservas[0].estado, 'confirmed');

  const otraVista = await conectar(otra);
  assert.deepEqual(otraVista.body.reservas.map((b) => b.id), [ajena.id]);
  const sinNada = await conectar(privateKeyToAccount(generatePrivateKey()));
  assert.deepEqual(sinNada.body.reservas, []);
});

test('la dirección en minúsculas o mayúsculas es la misma billetera', async () => {
  const r = await conectar(yo, { direccion: yo.address.toLowerCase() });
  assert.equal(r.status, 200);
  assert.ok(r.body.reservas.length >= 2);
});

test('no alcanza con escribir la dirección: sin firma, con firma ajena o con datos raros no se ve nada', async () => {
  // Firma de otra billetera
  const falsa = await conectar(yo, { firmante: otra });
  assert.equal(falsa.status, 401);
  assert.equal(falsa.body.codigo, 'firma');
  assert.equal(falsa.body.reservas, undefined);
  // Firma de un mensaje distinto (otra cosa que el servidor no pidió)
  const d = await post('/api/billetera/desafio', { direccion: yo.address });
  const otraCosa = await yo.signMessage({ message: 'Hola, esto no es lo que pidió Seña' });
  assert.equal((await post('/api/billetera/reservas', { direccion: yo.address, nonce: d.body.nonce, firma: otraCosa })).status, 401);
  // Sin firma, con firma mal formada, con código inventado, con dirección inválida
  const d2 = await post('/api/billetera/desafio', { direccion: yo.address });
  assert.equal((await post('/api/billetera/reservas', { direccion: yo.address, nonce: d2.body.nonce })).status, 400);
  assert.equal((await post('/api/billetera/reservas', { direccion: yo.address, nonce: d2.body.nonce, firma: '0x1234' })).status, 400);
  assert.equal((await post('/api/billetera/reservas', { direccion: yo.address, nonce: 'a'.repeat(32), firma: `0x${'1b'.repeat(65)}` })).status, 401);
  assert.equal((await post('/api/billetera/desafio', { direccion: '0xnoesunadireccion' })).status, 400);
  assert.equal((await post('/api/billetera/desafio', {})).status, 400);
});

test('el pedido de firma sirve una sola vez y vence', async () => {
  const d = await post('/api/billetera/desafio', { direccion: yo.address });
  const firma = await yo.signMessage({ message: d.body.mensaje });
  assert.equal((await post('/api/billetera/reservas', { direccion: yo.address, nonce: d.body.nonce, firma })).status, 200);
  assert.equal((await post('/api/billetera/reservas', { direccion: yo.address, nonce: d.body.nonce, firma })).status, 401); // reutilizada

  const d2 = await post('/api/billetera/desafio', { direccion: yo.address });
  const firma2 = await yo.signMessage({ message: d2.body.mensaje });
  ahora += 61_000; // pasó el minuto
  const vencido = await post('/api/billetera/reservas', { direccion: yo.address, nonce: d2.body.nonce, firma: firma2 });
  assert.equal(vencido.status, 401);
  assert.equal(vencido.body.codigo, 'desafio');

  // Un pedido para una billetera no se puede usar con otra dirección, aunque la firma sea válida.
  const d3 = await post('/api/billetera/desafio', { direccion: yo.address });
  const firma3 = await otra.signMessage({ message: d3.body.mensaje });
  assert.equal((await post('/api/billetera/reservas', { direccion: otra.address, nonce: d3.body.nonce, firma: firma3 })).status, 401);
});

test('con la sesión se puede ver la vista previa y cancelar: la seña vuelve a la billetera que pagó', async () => {
  const b = await pagar(alice, '2026-10-25', '20:00', yo.address);
  const { body } = await conectar(yo);
  const vista = await post(`/api/billetera/reservas/${b.id}/cancelar-vista`, { sesion: body.sesion });
  assert.equal(vista.status, 200);
  assert.equal(vista.body.devolucion, '$ 6,000');
  assert.equal(vista.body.regla, 'A_TIEMPO');
  assert.equal(ctx.store.getBooking(b.id).status, 'confirmed'); // la vista previa no cancela nada

  const r = await post(`/api/billetera/reservas/${b.id}/cancelar`, { sesion: body.sesion });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.devolucion, '$ 6,000');
  assert.equal(ctx.store.getBooking(b.id).status, 'cancelled');
  const refund = ctx.store.transfersByStatus('sent').find((t) => t.booking_id === b.id);
  assert.equal(refund.to_address, yo.address);
  assert.equal(BigInt(refund.amount_wei), arsToWei(6000));
  assert.ok(ctx.store.decisions({ bookingId: b.id }).some((d) => d.rule === 'A_TIEMPO'));

  const refrescada = await post('/api/billetera/mis-reservas', { sesion: body.sesion });
  assert.equal(refrescada.body.reservas.find((x) => x.id === b.id).estado, 'cancelled');
  assert.equal((await post(`/api/billetera/reservas/${b.id}/cancelar`, { sesion: body.sesion })).status, 409); // ya cancelada
});

test('una sesión no sirve para las reservas de otra billetera, y sin sesión o vencida se vuelve a firmar', async () => {
  const ajena = await pagar(bob, '2026-10-24', '17:00', otra.address, 'Court 2');
  const { body } = await conectar(yo);
  for (const ruta of ['cancelar-vista', 'cancelar']) {
    const r = await post(`/api/billetera/reservas/${ajena.id}/${ruta}`, { sesion: body.sesion });
    assert.equal(r.status, 404, ruta);
  }
  assert.equal((await post('/api/billetera/reservas/S-NOEXIS/cancelar', { sesion: body.sesion })).status, 404);
  assert.equal(ctx.store.getBooking(ajena.id).status, 'confirmed');

  assert.equal((await post(`/api/billetera/reservas/${ajena.id}/cancelar`, {})).status, 401);
  assert.equal((await post(`/api/billetera/reservas/${ajena.id}/cancelar`, { sesion: 'f'.repeat(48) })).status, 401);
  assert.equal((await post('/api/billetera/mis-reservas', { sesion: 'f'.repeat(48) })).status, 401);

  ahora += 121_000; // vence la sesión
  const vencida = await post('/api/billetera/mis-reservas', { sesion: body.sesion });
  assert.equal(vencida.status, 401);
  assert.equal(vencida.body.codigo, 'sin_sesion');
});

test('un agente de IA que pagó por x402 puede consultar sus reservas firmando con su clave', async () => {
  const agente = privateKeyToAccount(generatePrivateKey());
  const b = await pagar({ id: `api:${'1'.repeat(32)}`, name: 'Agente', channel: 'api' }, '2026-10-23', '12:00', agente.address, 'Court 2');
  const { body } = await conectar(agente);
  assert.deepEqual(body.reservas.map((x) => x.id), [b.id]);
  assert.match(body.reservas[0].pagoTx, /^0x/);
});
