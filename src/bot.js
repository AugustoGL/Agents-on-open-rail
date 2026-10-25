// Bot de Telegram: la cara del agente para clientes y para el dueño.
// Los clientes nunca ven palabras como "wallet" o "x402" salvo en el paso de pago.
import { Bot, InlineKeyboard } from 'grammy';
import { formatArs } from './money.js';
import { formatLocalDay, localToUtcMs } from './time.js';
import { AgendaError } from './agenda.js';
import { AGENDA_DOWN_MESSAGE } from './agent.js';

const HELP = [
  'Soy el agente de reservas. Esto es lo que puedo hacer:',
  '/reservar — ver días y turnos libres',
  '/mis_reservas — tus turnos y cómo cancelarlos',
  '/politica — cuánto se devuelve si cancelás',
  '/espera — tus listas de espera',
  'También podés escribirme normal, por ejemplo: "¿hay cancha mañana a las 21?"',
].join('\n');

const OWNER_HELP = [
  'Comandos del dueño:',
  '/hoy — turnos de hoy',
  '/decisiones — últimas decisiones del agente con su motivo',
  '/pendientes — transferencias que esperan tu aprobación',
  '/aprobar <n> · /rechazar <n>',
  '/saldo — saldo de la wallet y plata comprometida',
  '/cierre — hacer el cierre del día ahora',
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
  const R = agent.business.recursos;

  /** Telegram solo acepta botones con links https públicos. En local se manda el link como texto. */
  const payKeyboard = (b) => {
    const url = agent.payUrl(b);
    return /^https:\/\//.test(url) ? new InlineKeyboard().url(`Pagar seña ${formatArs(b.deposit_wei)}`, url) : undefined;
  };
  const payText = (b) => `Pagá la seña de ${formatArs(b.deposit_wei)} en wARS acá:\n${agent.payUrl(b)}\n(Tenés hasta ${agent.fmt(b.hold_expires_at)}.)`;

  const replyBooking = async (ctx, b, header) => {
    const kb = payKeyboard(b);
    await ctx.reply(`${header}\n${agent.describe(b)}\n\n${payText(b)}`, kb ? { reply_markup: kb } : {});
  };

  // --- Clientes ---------------------------------------------------------------------
  bot.command('start', async (ctx) => {
    const b = agent.business;
    await ctx.reply(
      `¡Hola! Soy el agente de reservas de ${b.nombre}${b.esDemostracion ? ' (comercio de demostración)' : ''}.\n` +
      `Cada turno dura ${b.duracionMinutos} minutos y se confirma con una seña de ${formatArs(agent.depositWei())}, que se paga en pesos digitales (wARS).\n\n${HELP}`,
      { reply_markup: new InlineKeyboard().text('Reservar', 'menu:reservar').text('Mis reservas', 'menu:mis') },
    );
    if (isOwner(ctx)) await ctx.reply(OWNER_HELP);
  });
  bot.command(['ayuda', 'help'], (ctx) => ctx.reply(isOwner(ctx) ? `${HELP}\n\n${OWNER_HELP}` : HELP));
  bot.command('quiensoy', (ctx) => ctx.reply(`Tu chat id es ${ctx.chat.id}. Si sos el dueño, ponelo en OWNER_CHAT_ID del archivo .env.`));

  const showDays = async (ctx) => {
    const days = agent.bookableDays();
    if (days.length === 0) return ctx.reply('No hay turnos para reservar en los próximos días.');
    const kb = new InlineKeyboard();
    days.forEach((d, i) => { kb.text(formatLocalDay(localToUtcMs(d, '12:00', agent.offset), agent.offset), `d:${d}`); if (i % 3 === 2) kb.row(); });
    return ctx.reply('¿Qué día querés jugar?', { reply_markup: kb });
  };

  /** Turnos de un día. Si el calendario del comercio no responde, avisa y devuelve null. */
  const slotsOf = async (ctx, date) => {
    try {
      return await agent.listSlotsChecked({ dateStr: date });
    } catch (err) {
      if (!(err instanceof AgendaError)) throw err;
      logger.warn?.(`[bot] calendario no disponible: ${err.message}`);
      await ctx.reply(AGENDA_DOWN_MESSAGE);
      return null;
    }
  };

  const showSlots = async (ctx, date, { only } = {}) => {
    const all = await slotsOf(ctx, date);
    if (!all) return undefined;
    const slots = all.filter((s) => !only || only(s));
    if (slots.length === 0) return ctx.reply('No hay turnos ese día. Probá con otro: /reservar');
    const kb = new InlineKeyboard();
    slots.forEach((s, i) => {
      const ri = R.indexOf(s.resource);
      kb.text(s.free ? `${s.time} · ${s.resource}` : `⏳ ${s.time} · ${s.resource}`, `${s.free ? 'r' : 'w'}:${ri}:${s.startAt}`);
      if (i % 2 === 1) kb.row();
    });
    const libres = slots.filter((s) => s.free).length;
    return ctx.reply(
      `Turnos del ${formatLocalDay(localToUtcMs(date, '12:00', agent.offset), agent.offset)} — ${libres} libres. ` +
      'Tocá uno para reservarlo. Los que tienen ⏳ están ocupados: tocándolos te anotás en la lista de espera.',
      { reply_markup: kb },
    );
  };

  const reserveSlot = async (ctx, resource, startAt) => {
    const r = await agent.reserveChecked({ resource, startAt, customer: customerOf(ctx) });
    if (r.ok) return replyBooking(ctx, r.booking, '📌 Te guardé el turno.');
    if (r.code === 'ocupado') {
      return ctx.reply(r.reason, { reply_markup: new InlineKeyboard().text('Anotarme en la lista de espera', `w:${R.indexOf(resource)}:${startAt}`) });
    }
    return ctx.reply(r.reason);
  };

  const showMine = async (ctx) => {
    const c = customerOf(ctx);
    const rows = agent.store.bookingsForCustomer(c.id, { onlyUpcomingFrom: agent.now() });
    if (rows.length === 0) return ctx.reply('No tenés turnos reservados. /reservar');
    for (const b of rows) {
      const kb = new InlineKeyboard().text('Cancelar', `c:${b.id}`);
      const url = agent.payUrl(b);
      if (b.status === 'held' && /^https:\/\//.test(url)) kb.url('Pagar seña', url);
      await ctx.reply(agent.describe(b) + (b.status === 'held' && !/^https:\/\//.test(url) ? `\nPagar: ${url}` : ''), { reply_markup: kb });
    }
    return undefined;
  };

  const previewCancel = async (ctx, id) => {
    const p = agent.previewCancel({ bookingId: id, customerId: customerOf(ctx).id });
    if (!p.ok) return ctx.reply(p.reason);
    return ctx.reply(
      `¿Cancelar ${agent.describe(p.booking)}?\n\n${p.reason}\nDevolución: ${formatArs(p.refundWei)}.`,
      { reply_markup: new InlineKeyboard().text('Sí, cancelar', `cx:${id}`).text('No', 'nada') },
    );
  };

  const politica = () => {
    const p = agent.business.politica;
    return [
      `Seña: ${formatArs(agent.depositWei())} por turno, en pesos digitales (wARS).`,
      `• Cancelás con ${p.devolucionTotalHorasAntes} h o más: te devuelvo toda la seña.`,
      `• Entre ${p.devolucionParcialHorasAntes} y ${p.devolucionTotalHorasAntes} h antes: te devuelvo el ${p.devolucionParcialPorcentaje}%.`,
      `• Con menos de ${p.devolucionParcialHorasAntes} h: la seña queda para el complejo.`,
      p.devolverSiSeRevende ? '• Si tu turno se vuelve a vender, te devuelvo lo que se había retenido.' : null,
      `• Si no pagás en ${agent.business.reservaSinPagarMinutos} minutos, el turno se libera.`,
      'Las devoluciones van a la misma wallet desde la que pagaste.',
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
    if (rows.length === 0) return ctx.reply('No estás en ninguna lista de espera.');
    return ctx.reply(['Tus listas de espera:', ...rows.map((w) => `• ${w.resource}, ${agent.fmt(w.start_at)} (${w.status === 'offered' ? 'te lo ofrecí, pagá para confirmarlo' : `puesto ${agent.store.waitlistPosition(w)}`})`)].join('\n'));
  });

  bot.callbackQuery('menu:reservar', async (ctx) => { await ctx.answerCallbackQuery(); return showDays(ctx); });
  bot.callbackQuery('menu:mis', async (ctx) => { await ctx.answerCallbackQuery(); return showMine(ctx); });
  bot.callbackQuery('nada', (ctx) => ctx.answerCallbackQuery('Listo, no cancelé nada.'));
  bot.callbackQuery(/^d:(\d{4}-\d{2}-\d{2})$/, async (ctx) => { await ctx.answerCallbackQuery(); return showSlots(ctx, ctx.match[1]); });
  bot.callbackQuery(/^r:(\d+):(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    return reserveSlot(ctx, R[Number(ctx.match[1])], Number(ctx.match[2]));
  });
  bot.callbackQuery(/^w:(\d+):(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const r = await agent.joinWaitlistChecked({ resource: R[Number(ctx.match[1])], startAt: Number(ctx.match[2]), customer: customerOf(ctx) });
    if (!r.ok) return ctx.reply(r.reason);
    return ctx.reply(`Listo, quedaste ${r.position === 1 ? 'primero' : `en el puesto ${r.position}`} en la lista de espera. Si se libera, te lo guardo ${agent.business.politica.ofertaListaEsperaMinutos} minutos y te aviso acá.`);
  });
  bot.callbackQuery(/^c:(S-[A-Z0-9]{6})$/, async (ctx) => { await ctx.answerCallbackQuery(); return previewCancel(ctx, ctx.match[1]); });
  bot.callbackQuery(/^cx:(S-[A-Z0-9]{6})$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const r = await agent.cancel({ bookingId: ctx.match[1], customerId: customerOf(ctx).id });
    if (!r.ok) return ctx.reply(r.reason);
    return ctx.reply(`Cancelado. ${r.reason}${r.refundWei > 0n ? '\nTe aviso cuando salga la devolución.' : ''}`);
  });

  // --- Dueño ------------------------------------------------------------------------
  const ownerOnly = (fn) => async (ctx) => (isOwner(ctx) ? fn(ctx) : ctx.reply('Ese comando es solo para el dueño.'));
  bot.command('hoy', ownerOnly((ctx) => ctx.reply(agent.todaySummary())));
  bot.command('decisiones', ownerOnly((ctx) => {
    const rows = agent.store.decisions({ limit: 10 });
    if (rows.length === 0) return ctx.reply('Todavía no hay decisiones.');
    return ctx.reply(rows.reverse().map((d) => `${agent.fmt(d.at)} · ${d.booking_id ?? '—'} · ${d.rule}\n${d.reason}${d.tx ? `\ntx ${d.tx}` : ''}`).join('\n\n'));
  }));
  bot.command('pendientes', ownerOnly((ctx) => {
    const rows = [...agent.store.transfersByStatus('needs_owner'), ...agent.store.transfersByStatus('failed'), ...agent.store.transfersByStatus('unknown')];
    if (rows.length === 0) return ctx.reply('No hay transferencias pendientes.');
    return ctx.reply(rows.map((t) => `#${t.id} · ${t.kind === 'refund' ? 'devolución' : 'retiro'} · ${formatArs(t.amount_wei)} → ${t.to_address} · ${t.status}${t.note ? `\n${t.note}` : ''}`).join('\n\n'));
  }));
  bot.command('aprobar', ownerOnly(async (ctx) => {
    const r = await agent.approveTransfer(ctx.match?.trim());
    return ctx.reply(r.ok ? `Transferencia #${r.transfer.id}: ${r.transfer.status}${r.transfer.tx ? ` (tx ${r.transfer.tx})` : ''}.` : r.reason);
  }));
  bot.command('rechazar', ownerOnly(async (ctx) => {
    const r = await agent.rejectTransfer(ctx.match?.trim());
    return ctx.reply(r.ok ? 'Rechazada. No se manda nada.' : r.reason);
  }));
  bot.command('saldo', ownerOnly(async (ctx) => {
    const [wars, celo] = await Promise.all([agent.chain.balanceWei(), agent.chain.celoBalanceWei?.() ?? 0n]);
    const c = agent.committedWei();
    return ctx.reply([
      `Wallet del agente: ${agent.chain.address}`,
      `Saldo wARS: ${formatArs(wars)}`,
      `CELO para gas: ${(Number(celo) / 1e18).toFixed(4)}`,
      `Señas de turnos futuros: ${formatArs(c.futureDeposits)}`,
      `Retenido por cancelaciones (se puede revender): ${formatArs(c.retained)}`,
      `Transferencias por salir: ${formatArs(c.owedTransfers)}`,
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
          const all = await slotsOf(ctx, intent.fecha);
          if (!all) return undefined;
          const match = all.filter((s) => s.startAt === startAt && (!intent.recurso || s.resource === intent.recurso));
          const free = match.filter((s) => s.free);
          if (intent.accion === 'reservar' && free.length === 1 && intent.recurso) return reserveSlot(ctx, free[0].resource, startAt);
          if (match.length > 0) return showSlots(ctx, intent.fecha, { only: (s) => s.startAt === startAt });
          await ctx.reply(`A las ${intent.hora} no hay turnos en la grilla. Te muestro los de ese día:`);
        }
        return showSlots(ctx, intent.fecha);
      }
      case 'mis_reservas': return showMine(ctx);
      case 'cancelar': return intent.reservaId ? previewCancel(ctx, intent.reservaId) : showMine(ctx);
      case 'lista_espera': return ctx.reply('Para anotarte en la lista de espera, elegí un turno ocupado (⏳) en /reservar.');
      case 'politica': return ctx.reply(politica());
      case 'ayuda': return ctx.reply(intent.respuesta ? `${intent.respuesta}\n\n${HELP}` : HELP);
      default: return ctx.reply(intent.respuesta ?? `No te entendí del todo. ${HELP}`);
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
      if (!owner) { logger.info?.(`[dueño] ${text}`); return; }
      await bot.api.sendMessage(owner, text);
    },
  };

  return { bot, notifier };
}

/** Avisos por consola cuando no hay bot (modo local). */
export function consoleNotifier(logger = console) {
  return {
    async toCustomer(customerId, text) { logger.info?.(`[aviso a ${customerId}] ${text}`); },
    async toOwner(text) { logger.info?.(`[aviso al dueño] ${text}`); },
  };
}
