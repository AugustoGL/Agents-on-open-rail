import { readFileSync } from 'node:fs';
import { openDb } from '../src/db.js';
import { SenaAgent } from '../src/agent.js';
import { createMockChain } from '../src/chain.js';
import { localToUtcMs } from '../src/time.js';

export const business = JSON.parse(readFileSync(new URL('../config/negocio.json', import.meta.url), 'utf8'));
export const OFFSET = business.utcOffsetMinutos;
export const HOUR = 3_600_000;
export const MIN = 60_000;

export const silent = { info() {}, warn() {}, error() {}, log() {} };

export function fakeClock(startMs) {
  let t = startMs;
  return {
    now: () => t,
    set: (ms) => { t = ms; },
    advance: (ms) => { t += ms; },
  };
}

export function recordingNotifier() {
  const sent = [];
  return {
    sent,
    async toCustomer(customerId, text) { sent.push({ to: customerId, text }); },
    async toOwner(text) { sent.push({ to: 'owner', text }); },
    forCustomer: (id) => sent.filter((m) => m.to === id),
    forOwner: () => sent.filter((m) => m.to === 'owner'),
  };
}

/** Agente listo para probar: lunes 19/10/2026 10:00 hora de Córdoba. */
export function makeAgent({ nowLocal = ['2026-10-19', '10:00'], payoutAddress = '0x000000000000000000000000000000000000dEaD', balance = 0n } = {}) {
  const store = openDb(':memory:');
  const clock = fakeClock(localToUtcMs(nowLocal[0], nowLocal[1], OFFSET));
  const chain = createMockChain({ initialBalanceWei: balance, logger: silent });
  const notifier = recordingNotifier();
  const agent = new SenaAgent({ store, business, chain, clock, notifier, logger: silent, publicBaseUrl: 'http://test.local', payoutAddress });
  return { agent, store, clock, chain, notifier };
}

export const slot = (date, time) => localToUtcMs(date, time, OFFSET);
export const alice = { id: 'tg:1', name: 'Alicia', channel: 'telegram' };
export const bob = { id: 'tg:2', name: 'Beto', channel: 'telegram' };
export const carla = { id: 'tg:3', name: 'Carla', channel: 'telegram' };
export const PAYER_A = '0x1111111111111111111111111111111111111111';
export const PAYER_B = '0x2222222222222222222222222222222222222222';
