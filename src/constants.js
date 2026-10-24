// Direcciones y datos fijos de Celo mainnet. Verificados el 2026-10-19 contra:
// - https://api.x402.celo.org/supported  (wARS por permit2, 18 decimales, dominio "Peso Argentino" v1)
// - https://docs.celo.org/build/tools/contracts/fee-currencies  (adaptadores de gas)
// - https://docs.celo.org/build/agents/8004  (registro ERC-8004)

export const CELO_CHAIN_ID = 42220;
export const CELO_NETWORK = 'eip155:42220'; // formato CAIP-2 que usa x402

export const WARS = Object.freeze({
  symbol: 'wARS',
  address: '0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D',
  decimals: 18,
  // Dominio EIP-712 del token, tal como lo publica el facilitador de Celo.
  eip712Name: 'Peso Argentino',
  eip712Version: '1',
  assetTransferMethod: 'permit2',
});

// Para pagar gas con estos tokens hay que pasar la dirección del ADAPTADOR, no la del token.
export const FEE_CURRENCIES = Object.freeze({
  USDC: '0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B',
  USDT: '0x0E2A3e05bc9A16F5292A6170456A710cb89C6f72',
  USAT: '0x0357EE22278c922e1D36cFe6b899269b161880C4',
});

export const TOKENS = Object.freeze({
  wARS: { address: WARS.address, decimals: 18 },
  USDC: { address: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C', decimals: 6 },
  USDT: { address: '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e', decimals: 6 },
  USAT: { address: '0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771', decimals: 6 },
});

export const ERC8004_IDENTITY_REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';

export const DEFAULT_FACILITATOR_URL = 'https://api.x402.celo.org';
export const DEFAULT_RPC_URL = 'https://forno.celo.org';
export const EXPLORER_TX = 'https://celoscan.io/tx/';
