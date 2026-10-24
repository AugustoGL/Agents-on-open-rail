// Muestra la dirección pública de la wallet del agente (nunca la clave).
//   npm run address
import { agentAccount } from './lib.mjs';

console.log('Dirección del agente:', agentAccount().address);
