// Prueba de punta a punta del cobro x402: servidor real, cliente x402 real que firma
// Permit2 con una wallet de prueba, y un facilitador simulado que verifica la firma.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { decodePaymentRequiredHeader } from '@x402/core/http';
import { createApp } from '../src/server.js';
import { createPaymentServer, MockFacilitator } from '../src/x402.js';
import { createPayingFetch, readPaymentResponse } from '../src/buyer.js';
import { arsToWei } from '../src/money.js';
import { WARS } from '../src/constants.js';
import { makeAgent, silent } from './helpers.js';

let ctx; let httpServer; let base; let facilitator;

before(async () => {
  ctx = makeAgent();
  facilitator = new MockFacilitator({ chain: ctx.chain, logger: silent });
  const payments = createPaymentServer({ agent: ctx.agent, facilitator, payTo: ctx.chain.address, builderCode: 'celo_aa27de260db7', logger: silent });
  const app = createApp({ agent: ctx.agent, payments, logger: silent });
  await new Promise((resolve) => { httpServer = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${httpServer.address().port}`;
  ctx.agent.publicBaseUrl = base;
});

after(() => new Promise((resolve) => httpServer.close(resolve)));

const post = (path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body ?? {}) });

async function reserve(hora = '20:00', fecha = '2026-10-21', recurso = 'Court 1') {
  const res = await post('/api/reservas', { recurso, fecha, hora, cliente: { nombre: 'Agente de prueba' } });
  return { status: res.status, body: await res.json() };
}

test('info del negocio y turnos libres', async () => {
  const info = await (await fetch(`${base}/api/negocio`)).json();
  assert.equal(info.sena, '$ 6,000');
  assert.equal(info.moneda.direccion, WARS.address);
  // Sin configurar, la web no muestra botón de Telegram ni regala la clave del panel.
  assert.equal(info.telegram, null);
  assert.equal(info.claveDemoPanel, null);
  const turnos = await (await fetch(`${base}/api/turnos?fecha=2026-10-21`)).json();
  assert.equal(turnos.turnos.length, 14);
});

test('sin pago responde 402 con el precio exacto en wARS por Permit2', async () => {
  const { body } = await reserve('17:00');
  const res = await post(`/api/reservas/${body.reserva.id}/pagar`);
  assert.equal(res.status, 402);
  const pr = decodePaymentRequiredHeader(res.headers.get('payment-required'));
  const [req] = pr.accepts;
  assert.equal(req.network, 'eip155:42220');
  assert.equal(req.asset.toLowerCase(), WARS.address.toLowerCase());
  assert.equal(req.amount, arsToWei(6000).toString());
  assert.equal(req.payTo.toLowerCase(), ctx.chain.address.toLowerCase());
  assert.equal(req.extra.assetTransferMethod, 'permit2');
  assert.equal(req.extra.name, 'Peso Argentino');
  assert.ok(pr.extensions.eip2612GasSponsoring);
  assert.equal(pr.extensions['builder-code'].info.a, 'celo_aa27de260db7');
});

test('un agente comprador paga con x402 y el turno queda confirmado', async () => {
  const { body } = await reserve('20:00');
  const id = body.reserva.id;
  const buyer = privateKeyToAccount(generatePrivateKey());
  const payingFetch = createPayingFetch({ signer: buyer, maxPerPaymentWei: arsToWei(10000) });
  const res = await payingFetch(`${base}/api/reservas/${id}/pagar`, { method: 'POST' });
  assert.equal(res.status, 200, await res.clone().text());
  const receipt = readPaymentResponse(res);
  assert.ok(receipt?.success);
  assert.match(receipt.transaction, /^0x[0-9a-f]{64}$/);

  const b = ctx.store.getBooking(id);
  assert.equal(b.status, 'confirmed');
  assert.equal(b.payer, buyer.address);
  assert.equal(b.pay_tx, receipt.transaction);
  assert.equal(facilitator.settled.length, 1);

  // Pagar de nuevo la misma reserva: 409 antes de firmar nada.
  const again = await payingFetch(`${base}/api/reservas/${id}/pagar`, { method: 'POST' });
  assert.equal(again.status, 409);
  assert.equal(facilitator.settled.length, 1);
});

test('el comprador no paga si la seña supera su tope', async () => {
  const { body } = await reserve('21:30');
  const buyer = privateKeyToAccount(generatePrivateKey());
  const payingFetch = createPayingFetch({ signer: buyer, maxPerPaymentWei: arsToWei(1000) });
  await assert.rejects(payingFetch(`${base}/api/reservas/${body.reserva.id}/pagar`, { method: 'POST' }));
  assert.equal(ctx.store.getBooking(body.reserva.id).status, 'held');
});

test('reservas inexistentes o vencidas no piden pago', async () => {
  assert.equal((await post('/api/reservas/S-NOEXISTE/pagar')).status, 404);
  const { body } = await reserve('12:00');
  ctx.clock.advance(16 * 60_000);
  await ctx.agent.expireHolds();
  const res = await post(`/api/reservas/${body.reserva.id}/pagar`);
  assert.equal(res.status, 410);
  ctx.clock.advance(-16 * 60_000);
});

test('turno ocupado devuelve 409 y se puede cancelar con el token del cliente', async () => {
  const first = await reserve('18:30', '2026-10-22');
  const second = await reserve('18:30', '2026-10-22');
  assert.equal(second.status, 409);
  const res = await post(`/api/reservas/${first.body.reserva.id}/cancelar`, { clienteToken: first.body.clienteToken });
  assert.equal(res.status, 200);
  const bad = await post(`/api/reservas/${first.body.reserva.id}/cancelar`, { clienteToken: 'api:otro' });
  assert.equal(bad.status, 409);
});

test('registro ERC-8004 y registro público de decisiones', async () => {
  const reg = await (await fetch(`${base}/.well-known/agent-registration.json`)).json();
  assert.equal(reg.type, 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1');
  assert.equal(reg.x402Support, true);
  const { decisiones } = await (await fetch(`${base}/api/decisiones`)).json();
  assert.ok(decisiones.some((d) => d.regla === 'SENA_COBRADA' && d.tx));
  assert.ok(decisiones.every((d) => !/Agente de prueba/.test(d.motivo)));
});
