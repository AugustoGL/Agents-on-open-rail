// Capturas de pantalla de TODA la interfaz, en celular (390x844) y escritorio (1280x800), claro y oscuro.
// Levanta Seña en modo prueba con datos de demostración (npm run seed) en una base en memoria, y maneja Chrome por
// DevTools: sin dependencias y sin tocar tu .env ni la cadena real. También simula una billetera (MetaMask) para
// mostrar los estados de la página de pago: sin conectar, red equivocada, sin saldo y firma rechazada.
//   npm run capturas                  -> docs/capturas/
//   OUT=/tmp/capturas npm run capturas
//   CHROME_BIN=/ruta/chromium npm run capturas
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { openDb } from '../src/db.js';
import { SenaAgent } from '../src/agent.js';
import { createMockChain } from '../src/chain.js';
import { createPaymentServer, MockFacilitator } from '../src/x402.js';
import { createApp } from '../src/server.js';
import { BusinessSettings } from '../src/settings.js';
import { loadBusiness } from '../src/config.js';
import { localDateStr, addDays } from '../src/time.js';
import { sembrar } from './seed-lib.mjs';
import { createSimulatedNft, tokenIdFor } from '../src/nft.js';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { launchChrome, instalarBilleteraFirmante } from './lib-cdp.mjs';

const OUT = process.env.OUT ?? fileURLToPath(new URL('../docs/capturas/', import.meta.url));
const CLAVE = 'clave-de-prueba-123';
const quiet = { info() {}, warn() {}, error: console.error };
const hex = (n) => randomBytes(n).toString('hex');

// --- Servidores: uno en modo prueba y otro que se hace pasar por "real" (solo para ver el estado "sin saldo") ---------
const store = openDb(':memory:');
const resumen = await sembrar({ store });
const business = new BusinessSettings(store).loadOrSeed(() => loadBusiness());
async function levantar(modo) {
  const chain = createMockChain({ logger: quiet });
  if (modo === 'real') chain.mode = 'live';
  const nft = modo === 'prueba' ? createSimulatedNft() : null; // el ticket NFT, simulado en memoria
  const agent = new SenaAgent({ store, business, chain, logger: quiet, payoutAddress: '0x000000000000000000000000000000000000dEaD', nft });
  const facilitator = new MockFacilitator({ chain, logger: quiet });
  const payments = createPaymentServer({ agent, facilitator, payTo: chain.address, builderCode: null, logger: quiet });
  const app = createApp({ agent, payments, logger: quiet, dashboardPassword: CLAVE, createLimit: { windowMs: 60_000, max: 10_000 }, panelOptions: { maxFailuresPerIp: 1000 } });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  agent.publicBaseUrl = base;
  return { agent, chain, server, base, nft };
}
const prueba = await levantar('prueba');
const real = await levantar('real');

// Un cliente de la web con reservas en varios estados, para "Mis reservas".
const hoy = localDateStr(Date.now(), prueba.agent.offset);
const token = `api:${hex(16)}`;
const yo = { id: token, name: 'Marta', channel: 'web' };
const hacer = (off, hora, recurso = 'Cancha 1', hold) => prueba.agent.reserve({ resource: recurso, startAt: prueba.agent.listSlots({ dateStr: addDays(hoy, off) }).find((s) => s.time === hora && s.resource === recurso).startAt, customer: yo, holdMinutes: hold }).booking;
const pagarFalso = async (b, payer = `0x${hex(20)}`) => { prueba.chain.credit(b.deposit_wei); await prueba.agent.onPaymentSettled({ bookingId: b.id, payer, tx: `0x${hex(32)}`, amountWei: b.deposit_wei }); };
// Una billetera de prueba que firma de verdad, con reservas pagadas desde ella (para "Ver mis reservas con mi billetera").
const firmante = privateKeyToAccount(generatePrivateKey());
const confirmada = hacer(3, '20:00', 'Cancha 2'); await pagarFalso(confirmada);
const sinPagar = hacer(3, '21:30', 'Cancha 1');
const pasada = hacer(3, '12:00', 'Cancha 1'); await pagarFalso(pasada); await prueba.agent.cancel({ bookingId: pasada.id, customerId: token });
const vencida = hacer(3, '17:00', 'Cancha 2', -1);
await prueba.agent.expireHolds(); // la reserva ya vencida pasa a "vencida" y deja de contar como pendiente
/** Una reserva nueva esperando el pago (de otra persona, para no pasar el límite de pendientes por cliente). */
let contador = 0;
const pendienteNueva = () => {
  const libre = [3, 1, 4, 5, 6].flatMap((off) => prueba.agent.listSlots({ dateStr: addDays(hoy, off), onlyFree: true }))[contador++];
  return prueba.agent.reserve({ resource: libre.resource, startAt: libre.startAt, customer: { id: `api:${hex(16)}`, name: 'Marta', channel: 'web' } }).booking;
};
let aPagar;
const pagadasConBilletera = [];
// Un ticket que todavía no salió (la cadena tardó) y otro que falló varias veces, para ver esos estados.
const nftEnviando = pendienteNueva(); const nftError = pendienteNueva();
prueba.nft.bloqueados.add(String(tokenIdFor(nftEnviando.id))); prueba.nft.bloqueados.add(String(tokenIdFor(nftError.id)));
await pagarFalso(nftEnviando); await pagarFalso(nftError);
for (let i = 0; i < 6; i++) await prueba.agent.processNft(); // los dos agotan los intentos...
prueba.agent.store.updateBooking(nftEnviando.id, { nft_attempts: 1, nft_error: null }, Date.now()); // ...y uno vuelve a "enviando"
prueba.agent.joinWaitlist({ resource: 'Cancha 2', startAt: prueba.agent.listSlots({ dateStr: addDays(hoy, 1) }).find((s) => s.time === '20:00' && s.resource === 'Cancha 2').startAt, customer: yo });
const idEnEspera = sinPagar.id;

// --- Billetera simulada --------------------------------------------------------------------------------------------
const billetera = ({ red = '0xa4ec', rechazaFirma = true, cuenta = '0x1234567890abcdef1234567890abcdef12345678' } = {}) => `
  window.ethereum = {
    isMetaMask: true,
    request: async ({ method }) => {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return ['${cuenta}'];
      if (method === 'eth_chainId') return '${red}';
      if (method === 'wallet_switchEthereumChain') throw Object.assign(new Error('User rejected the request.'), { code: 4001 });
      if (method === 'eth_signTypedData_v4') throw Object.assign(new Error('User rejected the request.'), { code: ${rechazaFirma ? 4001 : 4900} });
      throw new Error('Método no simulado: ' + method);
    },
    on() {}, removeListener() {},
  };`;

/** Responde por Celo (forno) con el saldo de wARS que se pida, sin salir a internet. */
async function simularRpc(page, saldoWei) {
  await page.cmd('Fetch.enable', { patterns: [{ urlPattern: 'https://forno.celo.org/*' }] });
  page.on(async (msg) => {
    if (msg.method !== 'Fetch.requestPaused') return;
    const { requestId, request } = msg.params;
    const cors = [{ name: 'access-control-allow-origin', value: '*' }, { name: 'access-control-allow-headers', value: '*' }, { name: 'access-control-allow-methods', value: 'POST, OPTIONS' }];
    if (process.env.RPC_DEBUG) console.log('RPC', request.method, (request.postData ?? '').slice(0, 140));
    if (request.method === 'OPTIONS') { await page.cmd('Fetch.fulfillRequest', { requestId, responseCode: 204, responseHeaders: cors }); return; }
    const reply = (c) => ({ jsonrpc: '2.0', id: c.id, result: c.method === 'eth_chainId' ? '0xa4ec' : c.method === 'eth_call' ? `0x${BigInt(saldoWei).toString(16).padStart(64, '0')}` : '0x0' });
    let body; try { const j = JSON.parse(request.postData ?? '{}'); body = Array.isArray(j) ? j.map(reply) : reply(j); } catch { body = {}; }
    await page.cmd('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [...cors, { name: 'content-type', value: 'application/json' }], body: Buffer.from(JSON.stringify(body)).toString('base64') });
  });
}

// --- Navegador ---------------------------------------------------------------------------------------------------------
const chrome = await launchChrome();
const VISTAS = [
  { dir: 'celular-claro-390x844', width: 390, height: 844, mobile: true, dark: false },
  { dir: 'escritorio-claro-1280x800', width: 1280, height: 800, mobile: false, dark: false },
  { dir: 'celular-oscuro-390x844', width: 390, height: 844, mobile: true, dark: true, solo: ['01-reservar', '05-mis-reservas', '10-pago-confirmado', '12-decisiones', '21-panel-hoy', '24-panel-calendario'] },
];
rmSync(OUT, { recursive: true, force: true });
for (const v of VISTAS) mkdirSync(join(OUT, v.dir), { recursive: true });
const problemas = [];
let total = 0;

async function pantalla(v, nombre, srv, { antes, preparar, esperar, maxHeight = 3600 } = {}) {
  if (v.solo && !v.solo.includes(nombre)) return;
  if (process.env.SOLO && !new RegExp(process.env.SOLO).test(nombre)) return;
  const page = await chrome.newPage({ width: v.width, height: v.height, mobile: v.mobile, dark: v.dark });
  try {
    if (preparar) await preparar(page);
    if (nombre === '20-panel-ingreso') { await page.cmd('Network.enable'); await page.cmd('Network.clearBrowserCookies'); }
    await page.goto(`${srv.base}/`);
    await page.evaluate(`localStorage.setItem('sena_token', ${JSON.stringify(token)}); localStorage.setItem('sena_nombre', 'Marta')`);
    await antes(page, srv);
    if (esperar) await page.waitFor(esperar, `listo ${nombre}`);
    await page.sleep(350);
    const desborde = await page.horizontalOverflow();
    if (desborde > 0) problemas.push(`${v.dir}/${nombre}: desborde horizontal de ${desborde}px`);
    for (const p of page.problems) if (!/favicon|404 \(Not Found\).*S-ZZZZZZ|status of 40[0129]/.test(p)) problemas.push(`${v.dir}/${nombre}: ${p}`);
    await page.screenshot(join(OUT, v.dir, `${nombre}.png`), { maxHeight });
    total++;
  } catch (err) {
    await page.screenshot(join(OUT, v.dir, `${nombre}-ERROR.png`), { maxHeight: 2400 }).catch(() => {});
    const texto = await page.evaluate('document.body.innerText').catch(() => '');
    problemas.push(`${v.dir}/${nombre}: ${err.message} | errores: ${JSON.stringify(page.problems)} | texto: ${String(texto).slice(0, 160).replace(/\n/g, ' / ')}`);
  } finally { await page.close(); }
}

const ir = (path) => async (page, srv) => { await page.goto(`${srv.base}${path}`); };
const clic = (page, sel) => page.evaluate(`document.querySelector(${JSON.stringify(sel)}).click()`);
const clicTexto = (page, texto) => page.evaluate(`(() => { const b = [...document.querySelectorAll('button, a')].find((x) => x.textContent.trim().includes(${JSON.stringify(texto)})); if (!b) throw new Error('No hay "${texto}"'); b.click(); })()`);
const valor = (page, sel, v) => page.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); })()`);
const hayTurnos = 'document.querySelectorAll(".turno").length > 0';

for (let i = 0; i < 3; i++) { const b = pendienteNueva(); await pagarFalso(b, firmante.address); pagadasConBilletera.push(b); }
await prueba.agent.cancel({ bookingId: pagadasConBilletera[2].id, by: 'wallet' }); // una ya cancelada, con su devolución

for (const v of VISTAS) {
  const P = prueba;
  aPagar = pendienteNueva();
  // ===== Cliente =====
  await pantalla(v, '01-reservar', P, { antes: ir('/'), esperar: hayTurnos });
  await pantalla(v, '02-reservar-formulario', P, { antes: async (pg) => { await pg.goto(`${P.base}/`); await pg.waitFor(hayTurnos, 'turnos'); await pg.evaluate('document.querySelector(".turno:not(.turno--ocupado):not(.turno--bloqueado)").click()'); await pg.sleep(500); await pg.evaluate('window.scrollTo(0, document.querySelector("#formulario").offsetTop - 70)'); }, maxHeight: 2400 });
  await pantalla(v, '03-lista-de-espera', P, { antes: async (pg) => {
    await pg.goto(`${P.base}/`); await pg.waitFor(hayTurnos, 'turnos');
    await pg.evaluate(`(() => { const d = document.querySelector('#dias .dia[data-day="${addDays(hoy, 1)}"]'); if (d) d.click(); })()`); await pg.sleep(900);
    await pg.waitFor('document.querySelector(".turno--ocupado")', 'un turno ocupado'); await pg.evaluate('document.querySelector(".turno--ocupado").click()'); await pg.sleep(400);
    await pg.evaluate('window.scrollTo(0, document.querySelector("#formulario").offsetTop - 70)');
  }, maxHeight: 2400 });
  await pantalla(v, '04-turnos-bloqueados', P, { antes: async (pg) => {
    await pg.goto(`${P.base}/`); await pg.waitFor(hayTurnos, 'turnos');
    await pg.evaluate(`(() => { const d = document.querySelector('#dias .dia[data-day="${addDays(hoy, 1)}"]'); if (d) d.click(); })()`); await pg.sleep(900);
  } });
  await pantalla(v, '05-mis-reservas', P, { antes: async (pg) => { await pg.goto(`${P.base}/`); await pg.waitFor('document.querySelector("#mis .tarjeta")', 'mis reservas'); await pg.evaluate('document.querySelector("#mis-reservas").scrollIntoView()'); } });
  await pantalla(v, '06-cancelar-con-vista-previa', P, { antes: async (pg) => {
    await pg.goto(`${P.base}/`); await pg.waitFor('document.querySelector("#mis .tarjeta")', 'mis reservas');
    await pg.evaluate('[...document.querySelectorAll("#mis button")].find((b) => b.textContent.trim() === "Cancelar").click()'); await pg.sleep(700);
    await pg.evaluate('document.querySelector("#mis-reservas").scrollIntoView()');
  } });
  const conFirmante = async (pg) => { await instalarBilleteraFirmante(pg, firmante); };
  const irAMias = async (pg) => { await pg.goto(`${P.base}/`); await pg.waitFor('document.querySelector("#billetera .tarjeta")', 'tarjeta de billetera'); };
  await pantalla(v, '05b-mis-reservas-conectar-billetera', P, { preparar: conFirmante, antes: async (pg) => { await irAMias(pg); await pg.evaluate('document.querySelector("#mis-reservas").scrollIntoView()'); } });
  await pantalla(v, '05c-mis-reservas-con-billetera', P, { preparar: conFirmante, antes: async (pg) => {
    await irAMias(pg); await pg.evaluate('document.querySelector("#conectar-billetera").click()');
    await pg.waitFor(`document.body.innerText.includes('Billetera conectada')`, 'billetera conectada');
    await pg.waitFor(`document.querySelectorAll('#mis .tarjeta').length >= 3`, 'reservas de la billetera'); await pg.evaluate('document.querySelector("#mis-reservas").scrollIntoView()');
  } });
  await pantalla(v, '05d-billetera-cancelar-vista-previa', P, { preparar: conFirmante, antes: async (pg) => {
    await irAMias(pg); await pg.evaluate('document.querySelector("#conectar-billetera").click()');
    await pg.waitFor(`document.body.innerText.includes('Billetera conectada')`, 'billetera conectada');
    const cancelarDeConfirmada = `[...document.querySelectorAll('#mis .tarjeta')].filter((c) => /Confirmada/.test(c.textContent)).map((c) => [...c.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Cancelar')).find(Boolean)`;
    await pg.waitFor(cancelarDeConfirmada, 'botón cancelar de una reserva confirmada');
    await pg.evaluate(`(${cancelarDeConfirmada}).click()`);
    await pg.waitFor(`document.body.innerText.includes('Si cancelás ahora')`, 'vista previa'); await pg.evaluate('document.querySelector("#mis-reservas").scrollIntoView()');
  } });
  await pantalla(v, '07-pago-sin-billetera', P, { antes: ir(`/pagar/${aPagar.id}`), esperar: 'document.querySelector(".cuenta")' });
  await pantalla(v, '08-pago-billetera-red-equivocada', P, { preparar: async (pg) => { await pg.cmd('Page.addScriptToEvaluateOnNewDocument', { source: billetera({ red: '0x1' }) }); await simularRpc(pg, 0n); },
    antes: async (pg, srv) => { await pg.goto(`${srv.base}/pagar/${aPagar.id}`); await pg.waitFor('document.querySelector(".cuenta")', 'pago'); await clicTexto(pg, 'Conectar mi billetera'); await pg.waitFor(`document.body.innerText.includes('otra red')`, 'aviso de red'); } });
  await pantalla(v, '09-pago-sin-saldo', real, { preparar: async (pg) => { await pg.cmd('Page.addScriptToEvaluateOnNewDocument', { source: billetera({}) }); await simularRpc(pg, 1_500n * 10n ** 18n); },
    antes: async (pg, srv) => { await pg.goto(`${srv.base}/pagar/${aPagar.id}`); await pg.waitFor('document.querySelector(".cuenta")', 'pago'); await clicTexto(pg, 'Conectar mi billetera'); await pg.waitFor(`document.body.innerText.includes('No te alcanza el saldo')`, 'aviso de saldo'); } });
  await pantalla(v, '09b-pago-firma-rechazada', P, { preparar: async (pg) => { await pg.cmd('Page.addScriptToEvaluateOnNewDocument', { source: billetera({}) }); await simularRpc(pg, 50_000n * 10n ** 18n); },
    antes: async (pg, srv) => { await pg.goto(`${srv.base}/pagar/${aPagar.id}`); await pg.waitFor('document.querySelector(".cuenta")', 'pago'); await clicTexto(pg, 'Conectar mi billetera'); await pg.waitFor(`document.body.innerText.includes('Pagar $')`, 'botón pagar'); await clicTexto(pg, 'Pagar $'); await pg.waitFor(`document.body.innerText.includes('No aceptaste en tu billetera')`, 'firma rechazada'); } });
  await pantalla(v, '10-pago-confirmado', P, { antes: ir(`/pagar/${confirmada.id}`), esperar: `document.body.innerText.includes('quedó confirmado')` });
  await pantalla(v, '10d-pago-ticket-enviando', P, { antes: async (pg, srv) => { prueba.agent.store.updateBooking(nftEnviando.id, { nft_attempts: 1, nft_error: null }, Date.now()); await pg.goto(`${srv.base}/pagar/${nftEnviando.id}`); }, esperar: `document.body.innerText.includes('Estamos mandando el ticket')` });
  await pantalla(v, '10e-pago-ticket-con-error', P, { antes: ir(`/pagar/${nftError.id}`), esperar: `document.body.innerText.includes('todavía no salió')` });
  await pantalla(v, '10b-pago-vencida', P, { antes: ir(`/pagar/${vencida.id}`), esperar: `document.body.innerText.includes('Se venció')` });
  await pantalla(v, '10c-pago-no-existe', P, { antes: ir('/pagar/S-ZZZZZZ'), esperar: `document.body.innerText.includes('No encontramos')` });
  await pantalla(v, '11-pago-en-proceso', P, { preparar: async (pg) => { await pg.cmd('Page.addScriptToEvaluateOnNewDocument', { source: billetera({}) }); await simularRpc(pg, 50_000n * 10n ** 18n); await pg.cmd('Page.addScriptToEvaluateOnNewDocument', { source: `window.__lento = true;` }); },
    antes: async (pg, srv) => { await pg.goto(`${srv.base}/pagar/${aPagar.id}`); await pg.waitFor('document.querySelector(".cuenta")', 'pago'); await pg.evaluate(`document.querySelector('#pago-prueba').click()`); await pg.sleep(30); } });
  aPagar = pendienteNueva();
  await pantalla(v, '12-decisiones', P, { antes: ir('/decisiones'), esperar: 'document.querySelectorAll(".decision").length > 3', maxHeight: 4200 });
  await pantalla(v, '13-decisiones-cancelaciones', P, { antes: async (pg, srv) => { await pg.goto(`${srv.base}/decisiones`); await pg.waitFor('document.querySelectorAll(".decision").length > 3', 'decisiones'); await clicTexto(pg, 'Cancelaciones'); await pg.sleep(300); }, maxHeight: 3200 });

  // ===== Panel =====
  const panel = (ruta, esperar, extra) => async (pg, srv) => {
    await pg.goto(`${srv.base}/panel`);
    await pg.waitFor('document.querySelector("#clave") || document.querySelector(".nav-inferior")', 'ingreso o panel');
    if (await pg.evaluate('Boolean(document.querySelector("#clave"))')) { await valor(pg, '#clave', CLAVE); await pg.evaluate('document.querySelector("form").requestSubmit()'); }
    await pg.waitFor('document.querySelector(".nav-inferior, .nav-superior")', 'panel');
    await pg.evaluate(`location.hash = '${ruta}'`);
    await pg.waitFor(esperar, `vista ${ruta}`); await pg.sleep(300);
    if (extra) await extra(pg);
  };
  await pantalla(v, '20-panel-ingreso', P, { antes: ir('/panel'), esperar: 'document.querySelector("#clave")' });
  await pantalla(v, '21-panel-hoy', P, { antes: panel('hoy', 'document.querySelector(".dato-valor") && document.querySelector(".decision")') });
  await pantalla(v, '22-panel-hoy-menu-mas', P, { antes: panel('hoy', 'document.querySelector(".dato-valor")', async (pg) => { await pg.evaluate('document.querySelector("#boton-mas").click()'); await pg.sleep(300); }) });
  await pantalla(v, '23-panel-calendario-dia', P, { antes: panel('calendario', 'document.querySelector(".cal-celda")') });
  await pantalla(v, '24-panel-calendario', P, { antes: panel('calendario', 'document.querySelector(".cal-celda")', async (pg) => { await clicTexto(pg, 'Semana'); await pg.waitFor('document.querySelector("table.cal-semana")', 'semana'); }) });
  await pantalla(v, '25-panel-reservas', P, { antes: panel('reservas', 'document.querySelector(".fila-lista")') });
  await pantalla(v, '26-panel-reserva-detalle', P, { antes: panel('reservas', 'document.querySelector(".fila-lista")', async (pg) => { await pg.evaluate('[...document.querySelectorAll(".fila-lista")].find((b) => /Confirmada/.test(b.textContent)).click()'); await pg.waitFor('document.querySelector(".modal")', 'detalle'); }) });
  await pantalla(v, '27-panel-pendientes', P, { antes: panel('pendientes', 'document.querySelector("section.tarjeta")') });
  await pantalla(v, '28-panel-bloqueos', P, { antes: panel('bloqueos', 'document.querySelector("form")') , maxHeight: 4200 });
  await pantalla(v, '29-panel-decisiones', P, { antes: panel('decisiones', 'document.querySelector(".decision")'), maxHeight: 4200 });
  await pantalla(v, '30-panel-configuracion', P, { antes: panel('config', 'document.querySelector("#c-precioTurnoArs")'), maxHeight: 5200 });
  await pantalla(v, '31-panel-configuracion-con-cambios', P, { antes: panel('config', 'document.querySelector("#c-precioTurnoArs")', async (pg) => { await valor(pg, '#c-precioTurnoArs', '5'); await pg.evaluate('document.querySelector("#guardar").click()'); await pg.waitFor('document.querySelector(".error-campo")', 'error de validación'); await pg.evaluate('document.querySelector("#c-precioTurnoArs").scrollIntoView({block:"center"})'); await pg.sleep(300); }), maxHeight: 1700 });
  await pantalla(v, '32-panel-cierre', P, { antes: panel('cierre', 'document.querySelector(".reporte")') });
}

await chrome.close();
await new Promise((r) => prueba.server.close(r));
await new Promise((r) => real.server.close(r));
console.log(`Capturas: ${total} archivos en ${OUT} (datos: ${resumen.reservas} reservas, ${resumen.decisiones} decisiones).`);
if (problemas.length) { console.log(`\nProblemas encontrados (${problemas.length}):`); for (const p of problemas) console.log(` - ${p}`); process.exitCode = 1; } else console.log('Sin desbordes horizontales ni errores de consola.');
void idEnEspera;
