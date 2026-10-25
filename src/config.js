// Lee la configuración del archivo .env y de config/negocio.json, y la valida.
import { readFileSync } from 'node:fs';
import { isAddress, getAddress } from 'viem';
import { normalizePrivateKey } from './keys.js';
import { DEFAULT_FACILITATOR_URL, DEFAULT_RPC_URL, FEE_CURRENCIES } from './constants.js';

const env = (k, d = undefined) => {
  const v = process.env[k];
  return v === undefined || v.trim() === '' ? d : v.trim();
};

export function loadBusiness(path = env('BUSINESS_CONFIG', new URL('../config/negocio.json', import.meta.url))) {
  const b = JSON.parse(readFileSync(path, 'utf8'));
  const need = ['nombre', 'utcOffsetMinutos', 'recursos', 'horarios', 'duracionMinutos', 'precioTurnoArs', 'senaPorcentaje', 'politica', 'limites'];
  for (const k of need) if (b[k] === undefined) throw new Error(`Falta "${k}" en la configuración del negocio.`);
  if (!b.horarios.every((h) => /^\d{2}:\d{2}$/.test(h))) throw new Error('Los horarios tienen que ser HH:MM.');
  return b;
}

export function loadConfig() {
  const mode = env('MODE', 'mock');
  if (!['mock', 'live'].includes(mode)) throw new Error('MODE tiene que ser "mock" o "live".');
  const feeRaw = env('FEE_CURRENCY');
  const feeCurrency = feeRaw ? (FEE_CURRENCIES[feeRaw.toUpperCase()] ?? feeRaw) : undefined;
  if (feeCurrency && !isAddress(feeCurrency)) throw new Error('FEE_CURRENCY tiene que ser USDC, USDT, USAT o una dirección de adaptador.');
  const payout = env('OWNER_PAYOUT_ADDRESS');
  if (payout && !isAddress(payout)) throw new Error('OWNER_PAYOUT_ADDRESS no es una dirección válida.');
  const payTo = env('PAY_TO');
  if (payTo && !isAddress(payTo)) throw new Error('PAY_TO no es una dirección válida.');

  const cfg = {
    mode,
    port: Number(env('PORT', '8402')),
    publicBaseUrl: env('PUBLIC_BASE_URL', `http://localhost:${env('PORT', '8402')}`),
    dbPath: env('DB_PATH', mode === 'live' ? 'data/sena.db' : 'data/sena-demo.db'),
    agentPrivateKey: normalizePrivateKey(env('AGENT_PRIVATE_KEY')),
    attributionTag: env('ATTRIBUTION_TAG'),
    rpcUrl: env('RPC_URL', DEFAULT_RPC_URL),
    feeCurrency,
    facilitatorUrl: env('X402_FACILITATOR_URL', DEFAULT_FACILITATOR_URL),
    x402ApiKey: env('X402_API_KEY'),
    builderCodeInX402: env('X402_BUILDER_CODE', 'true') === 'true',
    payTo: payTo ? getAddress(payTo) : undefined,
    payoutAddress: payout ? getAddress(payout) : null,
    telegramToken: env('TELEGRAM_BOT_TOKEN'),
    ownerChatId: env('OWNER_CHAT_ID'),
    anthropicApiKey: env('ANTHROPIC_API_KEY'),
    anthropicModel: env('ANTHROPIC_MODEL', 'claude-haiku-5-5'),
    closeTime: env('CIERRE_HORA', '23:30'),
    erc8004AgentId: env('ERC8004_AGENT_ID'),
    // Agenda en Google Calendar: si falta alguna de las dos variables se usa la grilla propia (modo por defecto).
    googleServiceAccountPath: env('GOOGLE_SERVICE_ACCOUNT_JSON_PATH'),
    googleCalendarId: env('GOOGLE_CALENDAR_ID'),
    repoUrl: env('REPO_URL', 'https://github.com/AugustoGL/Agents-on-open-rail'),
    business: loadBusiness(),
  };

  if (mode === 'live') {
    const missing = [];
    if (!cfg.agentPrivateKey) missing.push('AGENT_PRIVATE_KEY');
    if (!cfg.attributionTag) missing.push('ATTRIBUTION_TAG');
    if (!cfg.x402ApiKey) missing.push('X402_API_KEY');
    if (missing.length) throw new Error(`En MODE=live faltan: ${missing.join(', ')}. Mirá .env.example.`);
    if (!/^celo_[a-z0-9]{12}$/.test(cfg.attributionTag)) throw new Error('ATTRIBUTION_TAG tiene que tener el formato celo_ + 12 caracteres.');
  }
  if (!/^\d{2}:\d{2}$/.test(cfg.closeTime)) throw new Error('CIERRE_HORA tiene que ser HH:MM.');
  return cfg;
}
