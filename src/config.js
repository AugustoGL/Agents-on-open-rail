// Lee la configuración del archivo .env y de config/negocio.json, y la valida.
import { readFileSync } from 'node:fs';
import { isAddress, getAddress } from 'viem';
import { normalizePrivateKey } from './keys.js';
import { DEFAULT_FACILITATOR_URL, DEFAULT_RPC_URL, FEE_CURRENCIES } from './constants.js';
import { validateBusiness, DEFAULT_CLOSE_TIME } from './settings.js';

const env = (k, d = undefined) => {
  const v = process.env[k];
  return v === undefined || v.trim() === '' ? d : v.trim();
};

/**
 * Valores iniciales del negocio (config/negocio.json). Solo se usan para llenar la base la primera vez:
 * después la configuración vive en SQLite y se edita desde el panel.
 */
export function loadBusiness(path = env('BUSINESS_CONFIG', new URL('../config/negocio.json', import.meta.url))) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  // La hora del cierre inicial puede venir de CIERRE_HORA (compatibilidad con versiones anteriores).
  raw.cierre = { ...raw.cierre, hora: raw.cierre?.hora ?? env('CIERRE_HORA', DEFAULT_CLOSE_TIME) };
  const v = validateBusiness(raw);
  if (!v.ok) throw new Error(`Configuración del negocio inválida (${path}): ${v.errors.map((e) => e.mensaje).join(' ')}`);
  return v.business;
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
    closeTime: env('CIERRE_HORA', DEFAULT_CLOSE_TIME),
    // Ticket NFT de la reserva: con NFT_CONTRACT se manda de verdad (por defecto a Celo Sepolia, una testnet);
    // con NFT_SIMULADO=true (solo en MODE=mock) se simula en memoria para ver el flujo sin cadena.
    nftContract: env('NFT_CONTRACT'),
    nftPrivateKey: env('NFT_PRIVATE_KEY'),
    nftChain: env('NFT_CHAIN', 'celoSepolia'),
    nftRpcUrl: env('NFT_RPC_URL'),
    nftSimulado: env('NFT_SIMULADO', 'false') === 'true',
    dashboardPassword: env('OWNER_DASHBOARD_PASSWORD'),
    trustProxy: env('TRUST_PROXY', 'false') === 'true',
    erc8004AgentId: env('ERC8004_AGENT_ID'),
    repoUrl: env('REPO_URL', 'https://github.com/AugustoGL/Agents-on-open-rail'),
    business: loadBusiness(),
  };
  if (cfg.nftContract) {
    if (!isAddress(cfg.nftContract)) throw new Error('NFT_CONTRACT no es una dirección válida.');
    if (!cfg.nftPrivateKey) throw new Error('Con NFT_CONTRACT hace falta NFT_PRIVATE_KEY (una clave de TESTNET dedicada al NFT, no la del agente).');
    cfg.nftPrivateKey = normalizePrivateKey(cfg.nftPrivateKey, 'NFT_PRIVATE_KEY');
  }
  if (cfg.nftSimulado && mode !== 'mock') throw new Error('NFT_SIMULADO solo se puede usar con MODE=mock.');
  if (cfg.dashboardPassword && cfg.dashboardPassword.length < 8) throw new Error('OWNER_DASHBOARD_PASSWORD tiene que tener al menos 8 caracteres.');

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
