// Cobro de señas con x402 en wARS, liquidado por el facilitador de Celo.
// El cliente firma una autorización Permit2 (sin gas); el facilitador la manda a la
// cadena y la plata va directo de la wallet del cliente a la del agente (payTo).
import { HTTPFacilitatorClient, x402ResourceServer } from '@x402/core/server';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { PERMIT2_ADDRESS, permit2WitnessTypes, x402ExactPermit2ProxyAddress } from '@x402/evm';
import { declareEip2612GasSponsoringExtension, declareBuilderCodeExtension, BUILDER_CODE } from '@x402/extensions';
import { getAddress, verifyTypedData } from 'viem';
import { randomBytes } from 'node:crypto';
import { CELO_NETWORK, CELO_CHAIN_ID, WARS } from './constants.js';

export const PAY_ROUTE = 'POST /api/reservas/:id/pagar';
export const PAY_PATH = /^\/api\/reservas\/([^/]+)\/pagar$/;
const MAX_TIMEOUT_SECONDS = 300;

/** Precio en wARS para x402 (monto exacto en unidades mínimas + dominio EIP-712 del token). */
export function warsPrice(amountWei) {
  return {
    asset: WARS.address,
    amount: BigInt(amountWei).toString(),
    extra: { name: WARS.eip712Name, version: WARS.eip712Version, assetTransferMethod: WARS.assetTransferMethod },
  };
}

export function createFacilitatorClient({ url, apiKey, timeoutMs = 60_000 }) {
  return new HTTPFacilitatorClient({
    url,
    timeoutMs,
    // /settle exige la API key; la mandamos en todas para que /verify cuente igual.
    createAuthHeaders: async () => {
      const h = apiKey ? { 'X-API-Key': apiKey } : {};
      return { verify: h, settle: h, supported: h };
    },
  });
}

/**
 * Arma el servidor x402: precio dinámico según la reserva, chequeos antes de cobrar
 * y confirmación de la reserva cuando el facilitador liquida.
 */
export function createPaymentServer({ agent, facilitator, payTo, builderCode, logger = console }) {
  const server = new x402ResourceServer(facilitator);
  server.register(CELO_NETWORK, new ExactEvmScheme());

  const bookingIdFrom = (ctx) => {
    const path = ctx?.transportContext?.request?.path ?? ctx?.request?.path ?? ctx?.path ?? '';
    return PAY_PATH.exec(path)?.[1] ?? null;
  };

  // Antes de liquidar: si la reserva dejó de ser pagable, no se cobra.
  server.onBeforeSettle(async (ctx) => {
    const id = bookingIdFrom(ctx);
    const check = id ? agent.checkPayable(id) : { ok: false, reason: 'Ruta sin reserva.' };
    if (!check.ok && !agent.canAcceptLatePayment(id)) return { abort: true, reason: check.reason };
    if (check.booking && BigInt(ctx.requirements.amount) !== BigInt(check.booking.deposit_wei)) {
      return { abort: true, reason: 'El monto no coincide con la seña.' };
    }
    return undefined;
  });

  // Después de liquidar: confirmar la reserva con el hash de la cadena.
  server.onAfterSettle(async (ctx) => {
    const id = bookingIdFrom(ctx);
    try {
      await agent.onPaymentSettled({
        bookingId: id,
        payer: ctx.result.payer ?? ctx.paymentPayload?.payload?.permit2Authorization?.from,
        tx: ctx.result.transaction,
        amountWei: ctx.requirements.amount,
      });
    } catch (err) {
      logger.error?.(`[x402] no se pudo registrar el cobro de ${id}: ${err.stack ?? err.message}`);
    }
  });

  server.onSettleFailure(async (ctx) => {
    logger.warn?.(`[x402] falló la liquidación de ${bookingIdFrom(ctx)}: ${ctx.error?.message}`);
  });

  const extensions = { ...declareEip2612GasSponsoringExtension() };
  if (builderCode) extensions[BUILDER_CODE] = declareBuilderCodeExtension(builderCode);

  const routes = {
    [PAY_ROUTE]: {
      accepts: {
        scheme: 'exact',
        network: CELO_NETWORK,
        payTo: getAddress(payTo),
        maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
        price: async (ctx) => {
          const id = PAY_PATH.exec(ctx.path)?.[1];
          const check = agent.checkPayable(id);
          // El chequeo previo del servidor ya filtró esto; si igual llega, se cobra 0 y se rechaza en onBeforeSettle.
          return warsPrice(check.booking?.deposit_wei ?? 0n);
        },
      },
      description: 'Seña de un turno (wARS, Celo)',
      mimeType: 'application/json',
      serviceName: agent.business.nombre,
      extensions,
    },
  };
  return { server, routes };
}

/**
 * Facilitador de mentira para probar sin plata: chequea la firma Permit2 de verdad
 * (con la misma estructura que usa el facilitador real) pero no toca la cadena.
 */
export class MockFacilitator {
  constructor({ chain, logger = console } = {}) {
    this.chain = chain;
    this.logger = logger;
    this.settled = [];
    this.seenNonces = new Set();
  }

  async getSupported() {
    return {
      kinds: [{
        x402Version: 2, scheme: 'exact', network: CELO_NETWORK,
        extra: {
          extensions: ['eip2612GasSponsoring'],
          supportedAssets: [{ asset: WARS.address, symbol: 'wARS', decimals: 18, name: WARS.eip712Name, version: WARS.eip712Version, assetTransferMethod: 'permit2' }],
        },
      }],
      extensions: ['eip2612GasSponsoring'],
      signers: { [CELO_NETWORK]: ['0x0d74D5Cefd2e7F24E623330ebE3d8D4cB45fFB48'] },
    };
  }

  async verify(paymentPayload, requirements) {
    const p = paymentPayload?.payload;
    const auth = p?.permit2Authorization;
    const fail = (invalidReason, invalidMessage) => ({ isValid: false, invalidReason, invalidMessage });
    if (!auth || !p.signature) return fail('invalid_payload', 'Falta la autorización Permit2.');
    if (getAddress(auth.permitted.token) !== getAddress(requirements.asset)) return fail('asset_mismatch', 'Token incorrecto.');
    if (BigInt(auth.permitted.amount) !== BigInt(requirements.amount)) return fail('amount_mismatch', 'Monto incorrecto.');
    if (getAddress(auth.witness.to) !== getAddress(requirements.payTo)) return fail('payto_mismatch', 'Destino incorrecto.');
    if (getAddress(auth.spender) !== getAddress(x402ExactPermit2ProxyAddress)) return fail('spender_mismatch', 'Spender incorrecto.');
    if (Number(auth.deadline) < Math.floor(Date.now() / 1000)) return fail('expired', 'Autorización vencida.');
    const valid = await verifyTypedData({
      address: auth.from,
      domain: { name: 'Permit2', chainId: CELO_CHAIN_ID, verifyingContract: PERMIT2_ADDRESS },
      types: permit2WitnessTypes,
      primaryType: 'PermitWitnessTransferFrom',
      message: {
        permitted: { token: getAddress(auth.permitted.token), amount: BigInt(auth.permitted.amount) },
        spender: getAddress(auth.spender),
        nonce: BigInt(auth.nonce),
        deadline: BigInt(auth.deadline),
        witness: { to: getAddress(auth.witness.to), validAfter: BigInt(auth.witness.validAfter) },
      },
      signature: p.signature,
    });
    if (!valid) return fail('invalid_signature', 'La firma Permit2 no es válida.');
    if (this.seenNonces.has(auth.nonce)) return fail('nonce_used', 'Esa autorización ya se usó.');
    return { isValid: true, payer: auth.from };
  }

  async settle(paymentPayload, requirements) {
    const v = await this.verify(paymentPayload, requirements);
    if (!v.isValid) {
      return { success: false, errorReason: v.invalidReason, errorMessage: v.invalidMessage, transaction: '', network: requirements.network };
    }
    this.seenNonces.add(paymentPayload.payload.permit2Authorization.nonce);
    const transaction = `0x${randomBytes(32).toString('hex')}`;
    this.chain?.credit?.(requirements.amount);
    this.settled.push({ payer: v.payer, amount: requirements.amount, transaction });
    this.logger.info?.(`[facilitador simulado] liquidado ${requirements.amount} wei de wARS de ${v.payer} (${transaction})`);
    return { success: true, payer: v.payer, transaction, network: requirements.network };
  }
}
