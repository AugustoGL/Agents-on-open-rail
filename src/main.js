// Arranca todo: base de datos, cadena, servidor x402, bot de Telegram y tareas periódicas.
//   npm start            (MODE=mock: sin plata real, para probar)
//   MODE=live npm start  (Celo mainnet, plata real)
import { loadConfig } from './config.js';
import { BusinessSettings } from './settings.js';
import { openDb } from './db.js';
import { createLiveChain, createMockChain } from './chain.js';
import { createNftClient, createSimulatedNft } from './nft.js';
import { SenaAgent } from './agent.js';
import { createFacilitatorClient, createPaymentServer, MockFacilitator } from './x402.js';
import { createApp } from './server.js';
import { createBot, consoleNotifier } from './bot.js';
import { createInterpreter, createClaudeInterpreter } from './nl.js';
import { localDateStr, localTimeStr } from './time.js';
import { formatArs } from './money.js';

const logger = {
  info: (...a) => console.log(new Date().toISOString(), ...a),
  warn: (...a) => console.warn(new Date().toISOString(), ...a),
  error: (...a) => console.error(new Date().toISOString(), ...a),
};

async function main() {
  const cfg = loadConfig();
  const store = openDb(cfg.dbPath);

  const chain = cfg.mode === 'live'
    ? createLiveChain({ privateKey: cfg.agentPrivateKey, rpcUrl: cfg.rpcUrl, tag: cfg.attributionTag, feeCurrency: cfg.feeCurrency, logger })
    : createMockChain({ logger });

  // La configuración del negocio vive en la base (se edita desde /panel). config/negocio.json solo la llena la primera vez.
  const settings = new BusinessSettings(store);
  const business = settings.loadOrSeed(cfg.business);
  // Ticket NFT (opcional): real con NFT_CONTRACT, simulado con NFT_SIMULADO, o apagado.
  const nft = cfg.nftContract
    ? createNftClient({ contract: cfg.nftContract, privateKey: cfg.nftPrivateKey, red: cfg.nftChain, rpcUrl: cfg.nftRpcUrl, tag: cfg.attributionTag, logger })
    : cfg.nftSimulado ? createSimulatedNft({ red: cfg.nftChain }) : null;
  const agent = new SenaAgent({
    store, business, chain, notifier: consoleNotifier(logger), logger, settings, nft,
    publicBaseUrl: cfg.publicBaseUrl, payoutAddress: cfg.payoutAddress,
  });

  // Si el proceso se cortó en medio de una transferencia, no se sabe si salió: queda para revisar.
  for (const t of store.transfersByStatus('sending')) {
    store.updateTransfer(t.id, { status: 'unknown', error: 'El proceso se cortó mientras se mandaba.' }, Date.now());
    logger.warn(`[inicio] transferencia #${t.id} quedó en estado incierto: revisala en el explorador.`);
  }

  const facilitator = cfg.mode === 'live'
    ? createFacilitatorClient({ url: cfg.facilitatorUrl, apiKey: cfg.x402ApiKey })
    : new MockFacilitator({ chain, logger });
  const payments = createPaymentServer({
    agent, facilitator, payTo: cfg.payTo ?? chain.address,
    builderCode: cfg.builderCodeInX402 ? cfg.attributionTag ?? null : null, logger,
  });
  const app = createApp({
    agent, payments, logger, registration: { agentId: cfg.erc8004AgentId, repoUrl: cfg.repoUrl },
    dashboardPassword: cfg.dashboardPassword, trustProxy: cfg.trustProxy,
    telegramUsername: cfg.telegramUsername,
    demoPanelPassword: cfg.demoPanelPublico && cfg.mode === 'mock' ? cfg.dashboardPassword : null,
  });
  const server = app.listen(cfg.port, cfg.host, () => {
    logger.info(`Seña escuchando en ${cfg.publicBaseUrl} (${cfg.host}:${cfg.port}) · modo ${cfg.mode} · wallet ${chain.address}`);
    logger.info(`Negocio: ${agent.business.nombre} · seña ${formatArs(agent.depositWei())} · cobra en ${cfg.payTo ?? chain.address}`);
    logger.info(nft ? `Ticket NFT: ${nft.redNombre}${nft.simulated ? '' : ` · contrato ${nft.contract}`}` : 'Ticket NFT: apagado (ver NFT_CONTRACT en .env.example).');
    logger.info(cfg.dashboardPassword ? `Panel del comercio: ${cfg.publicBaseUrl}/panel` : 'Panel del comercio deshabilitado: falta OWNER_DASHBOARD_PASSWORD en .env.');
  });

  let bot = null;
  if (cfg.telegramToken) {
    const claude = cfg.anthropicApiKey ? createClaudeInterpreter({ apiKey: cfg.anthropicApiKey, model: cfg.anthropicModel }) : null;
    const created = createBot({ token: cfg.telegramToken, agent, ownerChatId: cfg.ownerChatId, interpreter: createInterpreter({ claude, logger }), logger });
    bot = created.bot;
    agent.notifier = created.notifier;
    await bot.api.setMyCommands([
      { command: 'reservar', description: 'Ver turnos libres y reservar' },
      { command: 'mis_reservas', description: 'Tus turnos y cancelaciones' },
      { command: 'politica', description: 'Qué se devuelve si cancelás' },
      { command: 'espera', description: 'Tus listas de espera' },
      { command: 'ayuda', description: 'Qué puedo hacer' },
    ]).catch((err) => logger.warn(`[bot] no se pudieron publicar los comandos: ${err.message}`));
    bot.start({ onStart: (me) => logger.info(`Bot de Telegram activo: @${me.username}${claude ? ' (con Claude)' : ''}`) })
      .catch((err) => logger.error(`[bot] se detuvo: ${err.message}`));
  } else {
    logger.info('Sin TELEGRAM_BOT_TOKEN: el bot está apagado, los avisos van a la consola.');
  }

  // Tareas periódicas: vencimientos, turnos jugados y cierre del día.
  // Si el cierre falla (por ejemplo el RPC no responde) se reintenta cada 5 minutos.
  // El retiro tiene clave idempotente por día, así que reintentar nunca paga dos veces.
  let lastClose = null;
  let lastCloseAttempt = 0;
  const shortErr = (err) => err?.shortMessage ?? err?.message ?? String(err);
  const tick = async () => {
    try {
      await agent.expireHolds();
      agent.completeFinished();
      await agent.processNft(); // emite, quema o actualiza los tickets que falten (y reintenta los que fallaron)
    } catch (err) {
      logger.error(`[tareas] ${shortErr(err)}`);
    }
    const now = Date.now();
    const today = localDateStr(now, agent.offset);
    if (localTimeStr(now, agent.offset) >= (agent.business.cierre?.hora ?? cfg.closeTime) && lastClose !== today && now - lastCloseAttempt > 5 * 60_000) {
      lastCloseAttempt = now;
      try {
        await agent.dailyClose({ dateStr: today });
        lastClose = today;
      } catch (err) {
        logger.error(`[cierre] falló, reintento en 5 minutos: ${shortErr(err)}`);
      }
    }
  };
  const timer = setInterval(tick, 30_000);
  tick();

  const shutdown = async (signal) => {
    logger.info(`Cerrando (${signal})...`);
    clearInterval(timer);
    await bot?.stop().catch(() => {});
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(`No se pudo arrancar: ${err.message}`);
  process.exit(1);
});
