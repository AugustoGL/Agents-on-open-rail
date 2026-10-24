// MetaMask exporta la clave privada sin "0x". Aceptamos las dos formas.
export function normalizePrivateKey(raw, name = 'AGENT_PRIVATE_KEY') {
  if (raw == null || String(raw).trim() === '') return undefined;
  let k = String(raw).trim().replace(/^["']|["']$/g, '');
  if (/^[0-9a-fA-F]{64}$/.test(k)) k = `0x${k}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(k)) throw new Error(`${name} tiene que ser 64 caracteres hexadecimales (con o sin 0x adelante).`);
  return k;
}
