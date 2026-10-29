// Bot de Telegram: la cara del agente para clientes y para el dueño.
// Los clientes nunca ven palabras como "wallet" o "x402" salvo en el paso de pago.
import { Bot, InlineKeyboard } from 'grammy';
import { formatArs } from './money.js';
import { formatLocalDay, localToUtcMs } from './time.js';

const HELP = [
  'I am the booking agent. Here is what I can do:',
  '/reservar — see days and free slots',
  '/mis_reservas — your slots and how to cancel them',
  '/politica — how much is refunded if you cancel',
  '/espera — your waitlists',
  'You can also just write to me, for example: "is there a court tomorrow at 21?"',
].join('\n');

const OWNER_HELP = [
  'Owner commands:',
  '/hoy — today\'s slots',
  '/decisiones — the latest agent decisions with their reason',
  '/pendientes — transfers waiting for your approval',
  '/aprobar <n> · /rechazar <n>',
  '/saldo — wallet balance and committed money',
  '/cierre — run the daily close now',
].join('\n');

export function createBot({ token, agent, ownerChatId, interpreter, botInfo, logger = console }) {
  const bot = new Bot(token, botInfo ? { botInfo } : undefined);
  const owner = ownerChatId ? String(ownerChatId) : null;
  const isOwner = (ctx) => owner && String(ctx.chat?.id) === owner;
  const customerOf = (ctx) => ({
    id: `tg:${ctx.chat.id}`,
    name: [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') || ctx.from?.username || 'Cliente',
    channel: 'telegram',
    chatId: String(ctx.chat.id),
  });
  // Las canchas pueden cambiar desde el panel: se leen siempre del negocio vigente (el orden de la lista nunca cambia).
  const resourceAt = (i) => agent.business.recursosTodos[i];
  const resourceIndex = (name) => agent.business.recursosTodos.indexOf(name);

  /** Telegram solo acepta botones con links https públicos. En local se manda el link como texto. */
  const payKeyboard = (b) => {
    const url = agent.payUrl(b);
    return /^https:\/\//.test(url) ? new InlineKeyboard().url(`Pay deposit ${formatArs(b.deposit_wei)}`, url) : undefined;
  };
  const payText = (b) => `Pay the deposit of ${formatArs(b.deposit_wei)} in wARS here:\n${agent.payUrl(b)}\n(You have until ${agent.fmt(b.hold_expires_at)}.)`;

  const replyBooking = async (ctx, b, header) => {
    const kb = payKeyboard(b);
    await ctx.reply(`${header}\n${agent.describe(b)}\n\n${payText(b)}`, kb ? { reply_markup: kb } : {});
  };

  // --- Clientes ---------------------------------------------------------------------
  bot.command('start', async (ctx) => {
    const b = agent.business;
    await ctx.reply(
      `Hi! I am the booking agent for ${b.nombre}${b.esDemostracion ? ' (demo venue)' : ''}.\n` +
      `Each slot lasts ${b.duracionMinutos} minutes and is confirmed with a deposit of ${formatArs(agent.depositWei())}, paid in digital pesos (wARS).\n\n${HELP}`,
      { reply_markup: new InlineKeyboard().text('Book', 'menu:reservar').text('My bookings', 'menu:mis') },
    );
    if (isOwner(ctx)) await ctx.reply(OWNER_HELP);
  });
  bot.command(['ayuda', 'help'], (ctx) => ctx.reply(isOwner(ctx) ? `${HELP}\n\n${OWNER_HELP}` : HELP));
  bot.command('quiensoy', (ctx) => ctx.reply(`Your chat id is ${ctx.chat.id}. If you are the owner, put it in OWNER_CHAT_ID in the .env file.`));

  const showDays = async (ctx) => {
    const days = agent.bookableDays();
    if (days.length === 0) return ctx.reply('There are no slots to book in the coming days.');
    const kb = new InlineKeyboard();
    days.forEach((d, i) => { kb.text(formatLocalDay(localToUtcMs(d, '12:00', agent.offset), agent.offset), `d:${d}`); if (i % 3 === 2) kb.row(); });
    return ctx.reply('Which day do you want to play?', { reply_markup: kb });
  };

  const showSlots = async (ctx, date, { only } = {}) => {
    const slots = agent.listSlots({ dateStr: date }).filter((s) => !s.blocked && (!only || only(s)));
    if (slots.length === 0) return ctx.reply('There are no slots that day. Try another: /reservar');
    const kb = new InlineKeyboard();
    slots.forEach((s, i) => {
      const ri = resourceIndex(s.resource);
      kb.text(s.free ? `${s.time} · ${s.resource}` : `⏳ ${s.time} · ${s.resource}`, `${s.free ? 'r' : 'w'}:${ri}:${s.startAt}`);
      if (i % 2 === 1) kb.row();
    });
    const libres = slots.filter((s) => s.free).length;
    return ctx.reply(
      `Slots for ${formatLocalDay(localToUtcMs(date, '12:00', agent.offset), agent.offset)} — ${libres} free. ` +
      'Tap one to book it. Those marked ⏳ are taken: tapping them adds you to the waitlist.',
      { reply_markup: kb },
    );
  };

  const reserveSlot = async (ctx, resource, startAt) => {
    const r = agent.reserve({ resource, startAt, customer: customerOf(ctx) });
    if (r.ok) return replyBooking(ctx, r.booking, '📌 I held the slot for you.');
    if (r.code === 'ocupado') {
      return ctx.reply(r.reason, { reply_markup: new InlineKeyboard().text('Join the waitlist', `w:${resourceIndex(resource)}:${startAt}`) });
    }
    return ctx.reply(r.reason);
  };

  const showMine = async (ctx) => {
    const c = customerOf(ctx);
    const rows = agent.store.bookingsForCustomer(c.id, { onlyUpcomingFrom: agent.now() });
    if (rows.length === 0) return ctx.reply('You have no booked slots. /reservar');
    for (const b of rows) {
      const kb = new InlineKeyboard().text('Cancel', `c:${b.id}`);
      const url = agent.payUrl(b);
      if (b.status === 'held' && /^https:\/\//.test(url)) kb.url('Pay deposit', url);
      await ctx.reply(agent.describe(b) + (b.status === 'held' && !/^https:\/\//.test(url) ? `\nPay: ${url}` : ''), { reply_markup: kb });
    }
    return undefined;
  };

  const previewCancel = async (ctx, id) => {
    const p = agent.previewCancel({ bookingId: id, customerId: customerOf(ctx).id });
    if (!p.ok) return ctx.reply(p.reason);
    return ctx.reply(
      `Cancel ${agent.describe(p.booking)}?\n\n${p.reason}\nRefund: ${formatArs(p.refundWei)}.`,
      { reply_markup: new InlineKeyboard().text('Yes, cancel', `cx:${id}`).text('No', 'nada') },
    );
  };

  const politica = () => {
    const p = agent.business.politica;
    return [
      `Deposit: ${formatArs(agent.depositWei())} per slot, in digital pesos (wARS).`,
      `• Cancel ${p.devolucionTotalHorasAntes} h or more ahead: I refund the whole deposit.`,
      `• Between ${p.devolucionParcialHorasAntes} and ${p.devolucionTotalHorasAntes} h ahead: I refund ${p.devolucionParcialPorcentaje}%.`,
      `• Under ${p.devolucionParcialHorasAntes} h: the deposit stays with the venue.`,
      p.devolverSiSeRevende ? '• If your slot is resold, I refund what was kept.' : null,
      `• If you do not pay within ${agent.business.reservaSinPagarMinutos} minutes, the slot is released.`,
      'Refunds go back to the same wallet you paid from.',
    ].filter(Boolean).join('\n');
  };

  bot.command(['reservar', 'turnos'], showDays);
  bot.command(['mis_reservas', 'misreservas'], showMine);
  bot.command('politica', (ctx) => ctx.reply(politica()));
  bot.command('cancelar', async (ctx) => {
    const id = ctx.match?.trim().toUpperCase();
    if (!id) return showMine(ctx);
    return previewCancel(ctx, id);
  });
  bot.command('espera', async (ctx) => {
    const rows = agent.store.waitlistForCustomer(customerOf(ctx).id);
    if (rows.length === 0) return ctx.reply('You are not on any waitlist.');
    return ctx.reply(['Your waitlists:', ...rows.map((w) => `• ${w.resource}, ${agent.fmt(w.start_at)} (${w.status === 'offered' ? 'I offered it to you, pay to confirm it' : `position ${agent.store.waitlistPosition(w)}`})`)].join('\n'));
  });

  bot.callbackQuery('menu:reservar', async (ctx) => { await ctx.answerCallbackQuery(); return showDays(ctx); });
  bot.callbackQuery('menu:mis', async (ctx) => { await ctx.answerCallbackQuery(); return showMine(ctx); });
  bot.callbackQuery('nada', (ctx) => ctx.answerCallbackQuery('Done, I cancelled nothing.'));
  bot.callbackQuery(/^d:(\d{4}-\d{2}-\d{2})$/, async (ctx) => { await ctx.answerCallbackQuery(); return showSlots(ctx, ctx.match[1]); });
  bot.callbackQuery(/^r:(\d+):(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    return reserveSlot(ctx, resourceAt(Number(ctx.match[1])), Number(ctx.match[2]));
  });
  bot.callbackQuery(/^w:(\d+):(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const r = agent.joinWaitlist({ resource: resourceAt(Number(ctx.match[1])), startAt: Number(ctx.match[2]), customer: customerOf(ctx) });
    if (!r.ok) return ctx.reply(r.reason);
    return ctx.reply(`Done, you are ${r.position === 1 ? 'first' : `number ${r.position}`} on the waitlist. If it frees up, I will hold it for ${agent.business.politica.ofertaListaEsperaMinutos} minutes and tell you here.`);
  });
  bot.callbackQuery(/^c:(S-[A-Z0-9]{6})$/, async (ctx) => { await ctx.answerCallbackQuery(); return previewCancel(ctx, ctx.match[1]); });
  bot.callbackQuery(/^cx:(S-[A-Z0-9]{6})$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const r = await agent.cancel({ bookingId: ctx.match[1], customerId: customerOf(ctx).id });
    if (!r.ok) return ctx.reply(r.reason);
    return ctx.reply(`Cancelled. ${r.reason}${r.refundWei > 0n ? '\nI will tell you when the refund goes out.' : ''}`);
  });

  // --- Dueño ------------------------------------------------------------------------
  const ownerOnly = (fn) => async (ctx) => (isOwner(ctx) ? fn(ctx) : ctx.reply('That command is for the owner only.'));
  bot.command('hoy', ownerOnly((ctx) => ctx.reply(agent.todaySummary())));
  bot.command('decisiones', ownerOnly((ctx) => {
    const rows = agent.store.decisions({ limit: 10 });
    if (rows.length === 0) return ctx.reply('There are no decisions yet.');
    return ctx.reply(rows.reverse().map((d) => `${agent.fmt(d.at)} · ${d.booking_id ?? '—'} · ${d.rule}\n${d.reason}${d.tx ? `\ntx ${d.tx}` : ''}`).join('\n\n'));
  }));
  bot.command('pendientes', ownerOnly((ctx) => {
    const rows = [...agent.store.transfersByStatus('needs_owner'), ...agent.store.transfersByStatus('failed'), ...agent.store.transfersByStatus('unknown')];
    if (rows.length === 0) return ctx.reply('There are no pending transfers.');
    return ctx.reply(rows.map((t) => `#${t.id} · ${t.kind === 'refund' ? 'refund' : 'withdrawal'} · ${formatArs(t.amount_wei)} → ${t.to_address} · ${t.status}${t.note ? `\n${t.note}` : ''}`).join('\n\n'));
  }));
  bot.command('aprobar', ownerOnly(async (ctx) => {
    const r = await agent.approveTransfer(ctx.match?.trim());
    return ctx.reply(r.ok ? `Transfer #${r.transfer.id}: ${r.transfer.status}${r.transfer.tx ? ` (tx ${r.transfer.tx})` : ''}.` : r.reason);
  }));
  bot.command('rechazar', ownerOnly(async (ctx) => {
    const r = await agent.rejectTransfer(ctx.match?.trim());
    return ctx.reply(r.ok ? 'Rejected. Nothing is sent.' : r.reason);
  }));
  bot.command('saldo', ownerOnly(async (ctx) => {
    const [wars, celo] = await Promise.all([agent.chain.balanceWei(), agent.chain.celoBalanceWei?.() ?? 0n]);
    const c = agent.committedWei();
    return ctx.reply([
      `Agent wallet: ${agent.chain.address}`,
      `wARS balance: ${formatArs(wars)}`,
      `CELO for gas: ${(Number(celo) / 1e18).toFixed(4)}`,
      `Deposits for future slots: ${formatArs(c.futureDeposits)}`,
      `Kept from cancellations (can be resold): ${formatArs(c.retained)}`,
      `Transfers about to go out: ${formatArs(c.owedTransfers)}`,
    ].join('\n'));
  }));
  bot.command('cierre', ownerOnly(async (ctx) => {
    const { report } = await agent.dailyClose();
    if (!owner) await ctx.reply(report);
  }));

  // --- Texto libre --------------------------------------------------------------------
  bot.on('message:text', async (ctx) => {
    const intent = interpreter
      ? await interpreter(ctx.message.text, { now: agent.now(), offset: agent.offset, business: agent.business })
      : { accion: 'ayuda' };
    switch (intent.accion) {
      case 'reservar':
      case 'ver_turnos': {
        if (!intent.fecha) return showDays(ctx);
        if (intent.hora) {
          const startAt = localToUtcMs(intent.fecha, intent.hora, agent.offset);
          const match = agent.listSlots({ dateStr: intent.fecha }).filter((s) => !s.blocked && s.startAt === startAt && (!intent.recurso || s.resource === intent.recurso));
          const free = match.filter((s) => s.free);
          if (intent.accion === 'reservar' && free.length === 1 && intent.recurso) return reserveSlot(ctx, free[0].resource, startAt);
          if (match.length > 0) return showSlots(ctx, intent.fecha, { only: (s) => s.startAt === startAt });
          await ctx.reply(`There are no slots at ${intent.hora} on the grid. Here are the ones for that day:`);
        }
        return showSlots(ctx, intent.fecha);
      }
      case 'mis_reservas': return showMine(ctx);
      case 'cancelar': return intent.reservaId ? previewCancel(ctx, intent.reservaId) : showMine(ctx);
      case 'lista_espera': return ctx.reply('To join the waitlist, pick a taken slot (⏳) in /reservar.');
      case 'politica': return ctx.reply(politica());
      case 'ayuda': return ctx.reply(intent.respuesta ? `${intent.respuesta}\n\n${HELP}` : HELP);
      default: return ctx.reply(intent.respuesta ?? `I did not quite understand. ${HELP}`);
    }
  });

  bot.catch((err) => logger.error?.(`[bot] ${err.error?.stack ?? err.message}`));

  const notifier = {
    async toCustomer(customerId, text, opts = {}) {
      if (!String(customerId).startsWith('tg:')) return;
      const kb = opts.pay && opts.booking ? payKeyboard(opts.booking) : undefined;
      await bot.api.sendMessage(customerId.slice(3), text, kb ? { reply_markup: kb } : {});
    },
    async toOwner(text) {
      if (!owner) { logger.info?.(`[owner] ${text}`); return; }
      await bot.api.sendMessage(owner, text);
    },
  };

  return { bot, notifier };
}

/** Avisos por consola cuando no hay bot (modo local). */
export function consoleNotifier(logger = console) {
  return {
    async toCustomer(customerId, text) { logger.info?.(`[notice to ${customerId}] ${text}`); },
    async toOwner(text) { logger.info?.(`[owner notice] ${text}`); },
  };
}
