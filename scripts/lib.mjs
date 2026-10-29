// Cosas compartidas por los scripts.
import { createPublicClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { celo } from 'viem/chains';
import { DEFAULT_RPC_URL } from '../src/constants.js';
import { normalizePrivateKey } from '../src/keys.js';

export function requireEnv(name, hint = '') {
  const v = process.env[name]?.trim();
  if (!v) {
    console.error(`Falta ${name} en el archivo .env. ${hint}`);
    process.exit(1);
  }
  return v;
}

export function readKey(name, hint = '') {
  try {
    return normalizePrivateKey(requireEnv(name, hint), name);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

export function agentAccount() {
  return privateKeyToAccount(readKey('AGENT_PRIVATE_KEY', 'Seguí docs/GUIA.md, paso 3.'));
}

export function publicClient() {
  return createPublicClient({ chain: celo, transport: http(process.env.RPC_URL?.trim() || DEFAULT_RPC_URL) });
}

export const flag = (name) => process.argv.includes(`--${name}`);
export const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
