# Seña — un agente que cobra y gestiona señas en pesos digitales

**Seña** es un agente para comercios que trabajan con turnos (canchas, peluquerías, consultorios). Cobra la seña en **wARS** (el peso argentino de Ripio) sobre **Celo** usando **x402**, y después decide solo qué hacer con la plata cuando alguien cancela: devuelve todo, devuelve una parte o la retiene, le ofrece el turno liberado a la lista de espera y, si el turno se vuelve a vender, le devuelve la seña al que canceló. Al final del día cierra la caja y le transfiere al dueño lo que ya no está comprometido.

> Hecho para **Agents on Open Rails** (Celo · Loops House), track **Stable Agents LatAm**. El negocio de este repo, "Pádel Demo", es un **comercio de demostración**: los turnos y precios son de ejemplo.

*English summary: Seña is an autonomous deposit agent for appointment-based businesses in Argentina. It collects booking deposits in wARS on Celo mainnet via x402 (Permit2, gasless for the customer), applies a deterministic cancellation policy, re-sells freed slots to a waitlist, refunds retained deposits when a slot is resold, and settles the day to the owner. Every transaction the agent sends carries its ERC-8021 attribution tag; its identity is registered under ERC-8004.*

## Por qué es un agente y no un bot

Un bot de reservas anota turnos. Seña **maneja plata ajena con reglas propias**, sin que el dueño intervenga:

| Situación | Qué decide el agente |
|---|---|
| Alguien cancela con más de 24 h | Devuelve el 100 % de la seña |
| Cancela entre 24 h y 6 h antes | Devuelve el 50 % y ofrece el turno a la lista de espera |
| Cancela con menos de 6 h | Retiene la seña y ofrece el turno; **si se revende, devuelve la seña** |
| Nadie paga en 15 minutos | Libera el turno |
| Pago que llega tarde o a un turno ya ocupado | Lo acepta si el turno sigue libre; si no, lo devuelve completo |
| Devolución grande o muchas en el día | No la manda: le pide aprobación al dueño |
| Cierre del día | Calcula lo comprometido en turnos futuros y retira solo lo libre |

Cada decisión queda registrada con su regla y su transacción (`/decisiones` en Telegram, `GET /api/decisiones`).

## Cómo lo usa una persona

1. Le escribe al bot de Telegram ("quiero cancha mañana a las 20" o `/reservar`).
2. Elige turno y recibe un link de pago.
3. Abre el link en MetaMask o MiniPay, firma (sin gas) y listo. Si no tiene wARS, la página la manda a cargar pesos con Ripio.
4. Para cancelar: `/cancelar`. El agente le dice antes cuánto le devuelve y por qué.

Otros agentes pueden reservar y pagar por API (x402 estándar): `POST /api/reservas` y después `POST /api/reservas/:id/pagar`.

## Stack de Celo que usa

- **wARS** (Ripio) como moneda de cobro, devolución y retiro — `0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D`.
- **x402 v2** con el facilitador de Celo (`api.x402.celo.org`), esquema `exact` con **Permit2**: el cliente no paga gas.
- **ERC-8021**: todas las transacciones que manda la wallet del agente (devoluciones, retiros, registro) llevan el tag, vía `@celo/attribution-tags`.
- **ERC-8004**: identidad del agente registrada desde su propia wallet (`agent.json`).
- **Fee abstraction (CIP-64)**: opcionalmente el agente paga su gas en USA₮/USDC en vez de CELO (`FEE_CURRENCY`).

## Arquitectura

```
Telegram (grammY) ─┐                 ┌─ x402 (cobro, Permit2) ── facilitador de Celo
Página /pagar ─────┼─► SenaAgent ────┤
API REST ──────────┘   (decisiones)  └─ wallet del agente ── devoluciones / retiro en wARS (con tag)
                          │
                       SQLite (reservas, lista de espera, decisiones, transferencias)
```

- `src/policy.js` — reglas puras y deterministas (cancelación, reventa, topes, retiro).
- `src/agent.js` — el agente: reservas, pagos, cancelaciones, lista de espera, cola de transferencias, cierre.
- `src/x402.js` — servidor de cobro x402 + facilitador simulado para pruebas.
- `src/chain.js` — envíos en Celo con tag de atribución.
- `src/bot.js` — Telegram para clientes y dueño. `src/nl.js` — interpreta texto libre (reglas + Claude opcional).
- `web/pay.js` — página de pago en el navegador.

**Seguridad de la plata:** las transferencias pasan por una cola idempotente (una clave por motivo, nunca se paga dos veces la misma devolución); si un envío queda en estado dudoso no se reintenta solo, se le avisa al dueño; hay topes por devolución y por día; el retiro nunca toca señas de turnos futuros.

## Correrlo

Requisitos: Node 22.5 o más nuevo.

```bash
npm install
npm test          # 48 pruebas: política, agente, HTTP con x402 real (facilitador simulado), bot, cadena
npm run demo      # la historia completa en modo simulado, sin plata
npm start         # servidor + bot (MODE=mock por defecto)
```

Para mainnet ver **[GUIA.md](GUIA.md)** (paso a paso en castellano).

## Límites declarados

- La rampa pesos → wARS es la de Ripio (link a `ramp.ripio.com`); el agente no toca cuentas bancarias.
- El primer pago de una wallet puede necesitar una aprobación de Permit2 con gas si wARS no soporta `permit` (EIP-2612); `npm run probe` lo verifica y la página lo ofrece cuando hace falta.
- La custodia es de una wallet caliente del agente con saldo chico y topes; el resto se retira al dueño cada noche.

Licencia MIT.
