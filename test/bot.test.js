// Prueba del bot sin conectarse a Telegram: se interceptan las llamadas a la API.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBot } from '../src/bot.js';
import { createInterpreter, parseIntentHeuristic, createClaudeInterpreter } from '../src/nl.js';
import { makeAgent, slot, business, OFFSET } from './helpers.js';

const OWNER = 999;
const BOT_INFO = { id: 1, is_bot: true, first_name: 'Seña', username: 'sena_bot', can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false, can_connect_to_business: false, has_main_web_app: false };

function harness({ publicBaseUrl = 'https://sena.example' } = {}) {
  const ctx = makeAgent();
  ctx.agent.publicBaseUrl = publicBaseUrl;
  const { bot, notifier } = createBot({ token: 'TEST', agent: ctx.agent, ownerChatId: OWNER, interpreter: createInterpreter(), botInfo: BOT_INFO, logger: { error: (e) => { throw new Error(e); }, info() {}, warn() {} } });
  ctx.agent.notifier = notifier;
  const calls = [];
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload });
    const result = method === 'sendMessage' ? { message_id: calls.length, date: 0, chat: { id: payload.chat_id, type: 'private' }, text: payload.text } : true;
    return { ok: true, result };
  });
  let uid = 1;
  const user = (id) => ({ id, is_bot: false, first_name: id === OWNER ? 'Dueño' : `Cliente${id}` });
  const chat = (id) => ({ id, type: 'private', first_name: 'x' });
  const send = (chatId, text) => {
    const entities = text.startsWith('/') ? [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }] : undefined;
    return bot.handleUpdate({ update_id: uid++, message: { message_id: uid, date: 0, chat: chat(chatId), from: user(chatId), text, entities } });
  };
  const press = (chatId, data) => bot.handleUpdate({
    update_id: uid++,
    callback_query: { id: String(uid), from: user(chatId), chat_instance: 'c', data, message: { message_id: 1, date: 0, chat: chat(chatId), from: BOT_INFO, text: 'x' } },
  });
  const messages = (chatId) => calls.filter((c) => c.method === 'sendMessage' && String(c.payload.chat_id) === String(chatId));
  const buttons = (msg) => (msg.payload.reply_markup?.inline_keyboard ?? []).flat();
  return { ...ctx, bot, calls, send, press, messages, buttons };
}

test('el flujo de reserva por botones termina con un link de pago', async () => {
  const h = harness();
  await h.send(10, '/start');
  assert.match(h.messages(10)[0].payload.text, /deposit of \$ 6,000/);
  await h.press(10, 'menu:reservar');
  const days = h.buttons(h.messages(10).at(-1));
  assert.ok(days.length >= 7);
  await h.press(10, 'd:2026-10-21');
  const slotsMsg = h.messages(10).at(-1);
  const pick = h.buttons(slotsMsg).find((b) => b.text === '20:00 · Court 1');
  assert.ok(pick);
  await h.press(10, pick.callback_data);
  const done = h.messages(10).at(-1);
  assert.match(done.payload.text, /I held the slot/);
  const payBtn = h.buttons(done).find((b) => b.url);
  assert.match(payBtn.url, /^https:\/\/sena\.example\/pagar\/S-/);
  assert.equal(h.store.activeBookingForSlot('Court 1', slot('2026-10-21', '20:00')).customer_id, 'tg:10');
});

test('en local el link va como texto porque Telegram no acepta botones http', async () => {
  const h = harness({ publicBaseUrl: 'http://localhost:8402' });
  await h.press(10, `r:0:${slot('2026-10-21', '20:00')}`);
  const msg = h.messages(10).at(-1);
  assert.match(msg.payload.text, /http:\/\/localhost:8402\/pagar\/S-/);
  assert.equal(msg.payload.reply_markup, undefined);
});

test('un turno ocupado ofrece la lista de espera y avisa cuando se libera', async () => {
  const h = harness();
  const start = slot('2026-10-21', '20:00');
  await h.press(10, `r:0:${start}`);
  await h.press(20, `r:0:${start}`);
  const busy = h.messages(20).at(-1);
  assert.match(busy.payload.text, /already taken/);
  await h.press(20, h.buttons(busy)[0].callback_data);
  assert.match(h.messages(20).at(-1).payload.text, /first/);

  // El primero cancela antes de pagar: el turno pasa al de la lista y le llega el aviso con botón.
  const id = h.store.activeBookingForSlot('Court 1', start).id;
  await h.press(10, `c:${id}`);
  assert.match(h.messages(10).at(-1).payload.text, /no cost/);
  await h.press(10, `cx:${id}`);
  const offer = h.messages(20).find((m) => /is free/.test(m.payload.text));
  assert.ok(offer);
  assert.ok(h.buttons(offer).some((b) => b.url));
});

test('el texto libre se entiende: "hay cancha mañana a las 20?"', async () => {
  const h = harness();
  await h.send(10, '¿hay cancha mañana a las 20?');
  const msg = h.messages(10).at(-1);
  const labels = h.buttons(msg).map((b) => b.text);
  assert.deepEqual(labels, ['20:00 · Court 1', '20:00 · Court 2']);
});

test('los comandos del dueño solo funcionan para el dueño', async () => {
  const h = harness();
  await h.send(10, '/hoy');
  assert.match(h.messages(10).at(-1).payload.text, /owner only/);
  await h.send(OWNER, '/hoy');
  assert.match(h.messages(OWNER).at(-1).payload.text, /No slots|Today's slots/);
  await h.send(OWNER, '/saldo');
  assert.match(h.messages(OWNER).at(-1).payload.text, /wARS balance/);
  await h.send(OWNER, '/pendientes');
  assert.match(h.messages(OWNER).at(-1).payload.text, /no pending transfers/);
});

test('interpretación por reglas', () => {
  const ctx = { now: slot('2026-10-19', '10:00'), offset: OFFSET, business };
  assert.deepEqual(
    (({ accion, fecha, hora }) => ({ accion, fecha, hora }))(parseIntentHeuristic('Quiero reservar el jueves a las 21:30', ctx)),
    { accion: 'reservar', fecha: '2026-10-22', hora: '21:30' },
  );
  assert.equal(parseIntentHeuristic('cancelá la S-ABC234 porfa', ctx).accion, 'cancelar');
  assert.equal(parseIntentHeuristic('cancelá la S-ABC234 porfa', ctx).reservaId, 'S-ABC234');
  assert.equal(parseIntentHeuristic('no voy a poder ir', ctx).accion, 'mis_reservas');
  assert.equal(parseIntentHeuristic('cuánto me devuelven si cancelo?', ctx).accion, 'mis_reservas');
  assert.equal(parseIntentHeuristic('cuánto sale?', ctx).accion, 'politica');
  assert.equal(parseIntentHeuristic('hola!', ctx).accion, 'ayuda');
  assert.equal(parseIntentHeuristic('mañana 9 de la noche cancha 2', ctx).hora, '21:00');
  assert.equal(parseIntentHeuristic('mañana 9 de la noche cancha 2', ctx).recurso, 'Court 2');
  assert.equal(parseIntentHeuristic('el 25/10 a las 18:30', ctx).fecha, '2026-10-25');
  assert.equal(parseIntentHeuristic('qué onda el clima', ctx).accion, 'otro');
  // Inglés
  const en = (x) => parseIntentHeuristic(x, ctx);
  assert.equal(en('tomorrow 9 pm court 2').hora, '21:00');
  assert.equal(en('tomorrow 9 pm court 2').fecha, parseIntentHeuristic('mañana 9 de la noche cancha 2', ctx).fecha);
  assert.equal(en('tomorrow 9 pm court 2').recurso, 'Court 2');
  assert.equal(en('is there a court tomorrow at 9 pm?').accion, 'reservar');
  assert.equal(en('is anything free on friday?').fecha, parseIntentHeuristic('viernes', ctx).fecha);
  assert.equal(en('please cancel S-ABC234').accion, 'cancelar');
  assert.equal(en('please cancel S-ABC234').reservaId, 'S-ABC234');
  assert.equal(en('I can\'t make it').accion, 'mis_reservas');
  assert.equal(en('show my bookings').accion, 'mis_reservas');
  assert.equal(en('put me on the waitlist').accion, 'lista_espera');
  assert.equal(en('how much is the deposit?').accion, 'politica');
  assert.equal(en('what is the refund policy').accion, 'politica');
  assert.equal(en('hello!').accion, 'ayuda');
  assert.equal(en('what about the weather').accion, 'otro');
});

test('el intérprete con Claude arma bien el pedido y valida la respuesta', async () => {
  let sent;
  const fakeFetch = async (url, init) => {
    sent = { url, init, body: JSON.parse(init.body) };
    return { ok: true, json: async () => ({ content: [{ type: 'tool_use', name: 'interpretar_pedido', input: { accion: 'reservar', fecha: '2026-10-22', hora: '21:30', recurso: 'Court 9', reservaId: 'robado' } }] }) };
  };
  const claude = createClaudeInterpreter({ apiKey: 'k', fetchImpl: fakeFetch });
  const interpret = createInterpreter({ claude });
  const ctx = { now: slot('2026-10-19', '10:00'), offset: OFFSET, business };
  const out = await interpret('che tirame algo para el finde que viene después del laburo', ctx);
  assert.equal(sent.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(sent.init.headers['anthropic-version'], '2023-06-01');
  assert.equal(sent.body.tool_choice.name, 'interpretar_pedido');
  assert.equal(out.accion, 'reservar');
  assert.equal(out.recurso, null, 'un recurso que no existe se descarta');
  assert.equal(out.reservaId, null, 'un id con formato raro se descarta');
  // Si Claude falla, se usan las reglas.
  const broken = createInterpreter({ claude: async () => { throw new Error('caído'); }, logger: { warn() {} } });
  assert.equal((await broken('che tirame algo', ctx)).fuente, 'reglas');
});
