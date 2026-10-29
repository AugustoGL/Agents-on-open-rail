// Prueba de punta a punta en un navegador real (Chrome o Chromium), SIN plata y sin dependencias nuevas:
// levanta Seña en modo simulado (base en memoria, facilitador simulado) y maneja el navegador por el
// protocolo de DevTools. Recorre la reserva web (reservar -> pagar -> mis reservas -> cancelar) y el panel.
//   npm run e2e                      (usa "google-chrome"; con otro: CHROME_BIN=/ruta/chromium npm run e2e)
//   SHOTS=/tmp/capturas npm run e2e  (además guarda capturas de pantalla)
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db.js';
import { SenaAgent } from '../src/agent.js';
import { createMockChain } from '../src/chain.js';
import { createPaymentServer, MockFacilitator } from '../src/x402.js';
import { createApp } from '../src/server.js';
import { loadBusiness } from '../src/config.js';
import { arsToWei } from '../src/money.js';
import { localDateStr, addDays } from '../src/time.js';

const CLAVE = 'clave-de-prueba-123';
const CHROME = process.env.CHROME_BIN ?? 'google-chrome';
const SHOTS = process.env.SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

// --- Servidor -------------------------------------------------------------------------------------
const quiet = { info() {}, warn() {}, error: console.error };
const business = loadBusiness();
const chain = createMockChain({ logger: quiet });
const store = openDb(':memory:');
const agent = new SenaAgent({ store, business, chain, logger: quiet, payoutAddress: '0x000000000000000000000000000000000000dEaD' });
const facilitator = new MockFacilitator({ chain, logger: quiet });
const payments = createPaymentServer({ agent, facilitator, payTo: chain.address, builderCode: null, logger: quiet });
const app = createApp({ agent, payments, logger: quiet, dashboardPassword: CLAVE });
const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const base = `http://127.0.0.1:${server.address().port}`;
agent.publicBaseUrl = base;

// --- Navegador (DevTools Protocol) ----------------------------------------------------------------
const profile = mkdtempSync(join(tmpdir(), 'sena-e2e-'));
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1000,1400', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const wsUrl = await new Promise((resolve, reject) => {
  let buf = '';
  chrome.on('error', (e) => reject(new Error(`No pude abrir ${CHROME}: ${e.message}. Indicá otro con CHROME_BIN=/ruta/al/navegador`)));
  chrome.stderr.on('data', (d) => { buf += d; const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf); if (m) resolve(m[1]); });
  setTimeout(() => reject(new Error('Chrome no arrancó a tiempo')), 15000);
});
const ws = new WebSocket(wsUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let seq = 0; const pending = new Map(); const listeners = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { const { resolve, reject } = pending.get(msg.id); pending.delete(msg.id); if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result); }
  else listeners.forEach((fn) => fn(msg));
};
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params, sessionId })); });
const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
const cmd = (method, params) => send(method, params, sessionId);
await Promise.all([cmd('Page.enable'), cmd('Runtime.enable'), cmd('Log.enable')]);

const problems = [];
listeners.push((msg) => {
  if (msg.sessionId !== sessionId) return;
  if (msg.method === 'Runtime.exceptionThrown') problems.push(`excepción: ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`);
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error' && !/favicon|\/panel\/api\/(login|config)$/.test(msg.params.entry.url ?? '')) problems.push(`log: ${msg.params.entry.text} ${msg.params.entry.url ?? ''}`);
  if (msg.method === 'Page.javascriptDialogOpening') cmd('Page.handleJavaScriptDialog', { accept: true }); // los confirm() del panel
});

const evaluate = async (expression) => {
  const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`En la página: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
  return r.result.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(expression, what, timeout = 15000) {
  const t0 = Date.now();
  for (;;) {
    try { if (await evaluate(expression)) return; } catch { /* la página todavía carga */ }
    if (Date.now() - t0 > timeout) throw new Error(`Se esperaba: ${what}\nURL: ${await evaluate('location.href').catch(() => '?')}\nTexto de la página: ${(await evaluate('document.body.innerText').catch(() => '')).slice(0, 600)}\nMis reservas: ${await evaluate('document.querySelector("#mis")?.innerText').catch(() => '')}`);
    await sleep(100);
  }
}
const goto = async (path) => { await cmd('Page.navigate', { url: base + path }); await sleep(200); await waitFor("document.readyState === 'complete'", `cargar ${path}`); };
const text = () => evaluate("document.body.innerText.replace(/\\u00a0/g, ' ')");
const click = (selector) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error('No hay ${selector}'); el.click(); return true; })()`);
const clickButton = (label) => evaluate(`(() => { const el = [...document.querySelectorAll('button, a')].find((b) => b.textContent.trim() === ${JSON.stringify(label)}); if (!el) throw new Error('No hay botón "${label}"'); el.click(); return true; })()`);
const setValue = (selector, value) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error('No hay ${selector}'); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
const shot = async (name) => { if (!SHOTS) return; const { data } = await cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(data, 'base64')); };
const step = (t) => console.log(`▶ ${t}`);
const pageHasText = (s) => `document.body.innerText.replace(/\\u00a0/g, ' ').includes(${JSON.stringify(s)})`;

let failed = null;
try {
  // ===== Web del cliente =====
  step('La web carga con los carteles de demostración y modo prueba');
  await goto('/');
  await waitFor('document.querySelectorAll(".turno").length > 0', 'turnos en la página');
  const home = await text();
  assert.match(home, /Pádel Demo/);
  assert.match(home, /Demo venue/);
  assert.match(home, /TEST MODE/);
  await shot('web-inicio');

  step('Reservar: elegir turno, completar el nombre y pasar a la página de pago');
  // Un día lejano, para que la política devuelva todo (más de 24 h de anticipación).
  const farDay = addDays(localDateStr(agent.now(), agent.offset), 3);
  await click(`#dias .dia[data-day="${farDay}"]`);
  await waitFor(`document.querySelector("#turnos").dataset.day === ${JSON.stringify(farDay)} && document.querySelectorAll(".turno:not(.turno--ocupado):not(.turno--bloqueado)").length > 0`, 'turnos de ese día');
  await evaluate('document.querySelector(".turno:not(.turno--ocupado):not(.turno--bloqueado)").click()');
  await waitFor('!document.querySelector("#formulario").hidden', 'el formulario');
  assert.match(await text(), /Deposit\s*\$\s*6,000/);
  await clickButton('Book and pay the deposit');
  assert.match(await text(), /Enter your name/);
  await setValue('#f-nombre', 'Marta <b>Prueba</b>');
  await setValue('#f-contacto', '351 555-0000');
  await click('#f-ok');
  await waitFor('/^\\/pagar\\/S-[A-Z0-9]{6}$/.test(location.pathname)', 'ir a /pagar/:id');
  const bookingId = (await evaluate('location.pathname')).split('/').pop();
  await waitFor(pageHasText('You have'), 'la página de pago cargada');
  assert.match(await text(), /TEST MODE/);
  await shot('web-pago');

  step('Pagar de prueba desde la página de pago (mismo camino x402) y ver la confirmación');
  await waitFor(pageHasText('Pay as a test'), 'el botón de pago de prueba');
  await click('#pago-prueba');
  await waitFor(pageHasText('Your slot is confirmed'), 'la confirmación del pago');
  assert.match(await text(), /simulated/);
  assert.equal(store.getBooking(bookingId).status, 'confirmed');
  await shot('web-confirmacion');
  await goto('/');
  await waitFor(pageHasText('Confirmed'), 'la reserva confirmada en Mis reservas');
  assert.ok(!(await evaluate('document.querySelector("#mis").innerHTML.includes("<b>")')), 'el nombre se muestra como texto');
  await shot('web-mis-reservas');

  step('Cancelar mostrando antes cuánto devuelve y por qué');
  await clickButton('Cancel');
  await waitFor(pageHasText('we refund $ 6,000'), 'la vista previa de la devolución');
  assert.match(await text(), /whole deposit/);
  await clickButton('Yes, cancel my booking');
  await waitFor(pageHasText('Booking cancelled'), 'la reserva cancelada');
  assert.equal(store.getBooking(bookingId).status, 'cancelled');
  assert.equal(store.getCustomer(store.getBooking(bookingId).customer_id).contact, '351 555-0000');

  step('Un turno ocupado ofrece la lista de espera');
  const day = addDays(localDateStr(agent.now(), agent.offset), 1);
  const taken = agent.listSlots({ dateStr: day, onlyFree: true })[0];
  agent.reserve({ resource: taken.resource, startAt: taken.startAt, customer: { id: 'tg:1', name: 'Otro', channel: 'telegram' } });
  await goto('/');
  await click(`#dias .dia[data-day="${day}"]`);
  await waitFor(`document.querySelector("#turnos").dataset.day === ${JSON.stringify(day)} && document.querySelectorAll(".turno--ocupado").length > 0`, 'un turno ocupado');
  await click('.turno--ocupado');
  await waitFor('!document.querySelector("#formulario").hidden', 'el formulario de lista de espera');
  await setValue('#f-nombre', 'Marta');
  await click('#f-ok');
  await waitFor(pageHasText('Done, you are first on the waitlist'), 'la confirmación de lista de espera');
  await waitFor(pageHasText('Position 1'), 'la lista de espera en Mis reservas');

  step('El registro público de decisiones se ve sin datos personales');
  await goto('/decisiones');
  await waitFor('document.querySelectorAll(".decision").length > 0', 'decisiones del agente');
  assert.match(await text(), /What the agent decides on its own/);
  assert.match(await text(), /Collected a deposit/);
  const decisions = await text();
  assert.doesNotMatch(decisions, /Marta|Prueba|0x[a-fA-F0-9]{40}/);
  await shot('web-decisiones');

  // ===== Panel =====
  const confirmarVentana = async () => { await waitFor('document.querySelector("[data-confirmar]")', 'la ventana de confirmación'); await click('[data-confirmar]'); };

  step('El panel pide clave y no deja entrar con una mala');
  await goto('/panel');
  await waitFor(pageHasText('Dashboard password'), 'el ingreso');
  await setValue('#clave', 'mala');
  await evaluate('document.querySelector("form").requestSubmit()');
  await waitFor(pageHasText('The password is not correct'), 'el error de clave');
  await setValue('#clave', CLAVE);
  await evaluate('document.querySelector("form").requestSubmit()');
  await waitFor(pageHasText('Deposits collected today'), 'la pantalla Hoy');
  await shot('panel-hoy');

  step('Calendario: se ve cada turno con su estado y el detalle al tocar');
  const mine = agent.listSlots({ dateStr: day, onlyFree: true })[0];
  const b2 = agent.reserve({ resource: mine.resource, startAt: mine.startAt, customer: { id: `api:${'a'.repeat(32)}`, name: 'Beto <i>Pago</i>', channel: 'web', contact: '123' } }).booking;
  chain.credit(b2.deposit_wei);
  await agent.onPaymentSettled({ bookingId: b2.id, payer: '0x2222222222222222222222222222222222222222', tx: `0x${'ef'.repeat(32)}`, amountWei: b2.deposit_wei });
  await clickButton('Calendar');
  await waitFor('document.querySelectorAll(".cal-celda").length > 0', 'el calendario');
  await setValue('input[type="date"]', day);
  await waitFor('document.querySelector(".cal-celda.es-confirmada")', 'un turno confirmado');
  await shot('panel-calendario-dia');
  await click('.cal-celda.es-confirmada');
  await waitFor(pageHasText(`Booking ${b2.id}`), 'el detalle de la reserva');
  assert.match(await text(), /Beto <i>Pago<\/i>/); // se muestra como texto, no como HTML
  assert.match(await text(), /The venue cancels: full refund/);
  await shot('panel-reserva');
  await evaluate('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))');
  await waitFor('!document.querySelector(".modal")', 'cerrar el detalle con Escape');
  await clickButton('Week');
  await waitFor('document.querySelector("table.cal-semana")', 'la vista de semana');
  await shot('panel-calendario-semana');

  step('Configuración: un valor malo marca el campo; uno bueno se guarda y queda en el historial');
  await clickButton('Settings');
  await waitFor('document.querySelector("#c-precioTurnoArs")', 'el formulario de configuración');
  await setValue('#c-precioTurnoArs', '5');
  await waitFor(pageHasText('You have unsaved changes'), 'la barra para guardar');
  await clickButton('Save changes');
  await waitFor(pageHasText('must be between'), 'el error de rango');
  assert.equal(await evaluate('document.querySelector("#c-precioTurnoArs").getAttribute("aria-invalid")'), 'true');
  assert.equal(agent.business.precioTurnoArs, 24000);
  await setValue('#c-precioTurnoArs', '26000');
  await setValue('#c-nombre', 'Club Córdoba');
  await clickButton('Save changes');
  await waitFor(pageHasText('Saved.'), 'el aviso de guardado');
  assert.equal(agent.business.precioTurnoArs, 26000);
  assert.equal(agent.business.nombre, 'Club Córdoba');
  assert.match(await text(), /Deposit for each new slot: \$ 6,500/);
  assert.match(await text(), /panel \(/);
  assert.equal(BigInt(store.getBooking(b2.id).deposit_wei), arsToWei(6000)); // la reserva pagada no cambió
  await shot('panel-config');

  step('Bloqueos: bloquear un día con una reserva pagada avisa y permite devolver todo');
  await clickButton('Blocks');
  await waitFor('document.querySelector("#b-motivo")', 'el formulario de bloqueos');
  await setValue('#b-desde', day);
  await setValue('#b-motivo', 'Public holiday');
  await clickButton('Block');
  await waitFor(pageHasText('inside this block'), 'el aviso de reservas dentro del bloqueo');
  await shot('panel-bloqueos');
  await clickButton('Cancel those bookings and refund everything');
  await confirmarVentana();
  await waitFor(pageHasText('refund $ 6,000'), 'la cancelación con devolución');
  assert.equal(store.getBooking(b2.id).status, 'cancelled');
  assert.ok(store.decisions({ bookingId: b2.id }).some((d) => d.rule === 'CANCELADO_POR_COMERCIO'));

  step('Decisiones, pendientes y cierre del día');
  await clickButton('Agent decisions');
  await waitFor(pageHasText('CANCELADO_POR_COMERCIO'), 'la decisión en el registro del panel');
  await clickButton('Pending');
  await waitFor(pageHasText('All caught up'), 'pendientes vacíos');
  await clickButton('Daily close');
  await waitFor(pageHasText('Request a close now'), 'la pantalla de cierre');
  await clickButton('Request a close now');
  await confirmarVentana();
  await waitFor(pageHasText('Last close'), 'el reporte del cierre');
  await shot('panel-cierre');

  step('Salir cierra la sesión');
  await clickButton('Sign out');
  await waitFor(pageHasText('Dashboard password'), 'volver al ingreso');

  assert.deepEqual(problems, [], `Errores en la consola del navegador:\n${problems.join('\n')}`);
  console.log('\n✅ Todo bien: la web y el panel funcionan en un navegador real.');
} catch (err) {
  failed = err;
  console.error(`\n❌ ${err.message}`);
  if (problems.length) console.error(`Errores del navegador:\n${problems.join('\n')}`);
  await shot('error').catch(() => {});
} finally {
  const salio = new Promise((resolve) => { chrome.once('exit', resolve); setTimeout(resolve, 5000); });
  try { await send('Browser.close'); } catch { chrome.kill(); }
  await salio;
  await new Promise((r) => server.close(r));
  rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  process.exit(failed ? 1 : 0);
}
