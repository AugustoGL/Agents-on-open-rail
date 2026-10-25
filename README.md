# Seña — la puerta x402 para que el agente de un cliente reserve y pague en un comercio

**Seña** es el cajero que le falta al comercio que ya tiene su sistema de turnos (canchas, peluquerías, consultorios) para recibir reservas de agentes de IA. Un agente reserva un turno, paga la seña en **wARS** (el peso argentino de Ripio) sobre **Celo** con **x402**, y el turno queda anotado en la agenda que el comercio ya usa. Después Seña decide sola qué hacer con la plata cuando alguien cancela: devuelve todo, devuelve una parte o la retiene, le ofrece el turno a la lista de espera y, si se revende, le devuelve la seña al que canceló. Al final del día cierra la caja y le transfiere al dueño lo que ya no está comprometido.

**Complementa, no suplanta:** Seña no reemplaza la agenda del comercio. Lee su calendario para saber qué horarios están libres, cobra la seña y escribe el turno ahí. Si el comercio todavía no tiene un sistema de turnos, trae una grilla propia (modo por defecto) para arrancar.

> Hecho para **Agents on Open Rails** (Celo · Loops House), track **Stable Agents LatAm**. El comercio de este repo, "Pádel Demo", es un **comercio de demostración**: los turnos y precios son de ejemplo. **Agentes de otros participantes pueden reservar y pagar por API** (ver abajo).

*English summary: Seña is the x402 door that lets a customer's AI agent book and pay at a business that already runs its own appointment system. It collects the booking deposit in wARS (Ripio's Argentine peso stablecoin) on Celo mainnet via x402 (Permit2, gasless for the payer), writes the confirmed slot into the business's own calendar (Google Calendar connector; the built-in SQLite grid is the default), applies a deterministic cancellation policy, re-sells freed slots to a waitlist, refunds retained deposits when a slot is resold, and settles the day to the owner. If the calendar can't be read, nothing is confirmed or charged. Every transaction the agent sends carries its ERC-8021 attribution tag; its identity is registered under ERC-8004. The demo business is a demonstration shop; other participants' agents can book through the API.*

## Por qué es un agente y no un bot

Un bot de reservas anota turnos. Seña **maneja plata ajena con reglas propias**, sin que el dueño intervenga:

| Situación | Qué decide el agente |
|---|---|
| Alguien cancela con más de 24 h | Devuelve el 100 % de la seña |
| Cancela entre 24 h y 6 h antes | Devuelve el 50 % y ofrece el turno a la lista de espera |
| Cancela con menos de 6 h | Retiene la seña y ofrece el turno; **si se revende, devuelve la seña** |
| Nadie paga en 15 minutos | Libera el turno |
| Pago que llega tarde o a un turno ya ocupado | Lo acepta si el turno sigue libre; si no, lo devuelve completo |
| El comercio ocupó el turno en su calendario mientras se pagaba | No cobra; el cliente elige otro |
| No se puede leer o escribir el calendario | No confirma ni cobra; si el pago ya salió, lo devuelve completo |
| Devolución grande o muchas en el día | No la manda: le pide aprobación al dueño |
| Cierre del día | Calcula lo comprometido en turnos futuros y retira solo lo libre |

Cada decisión queda registrada con su regla y su transacción (`/decisiones` en Telegram, `GET /api/decisiones`).

## Cómo lo usa un agente (o una persona)

**Un agente de IA** (el caso principal) reserva y paga por API con x402 estándar:

1. `GET /api/turnos` — horarios libres (ya descontado lo que ocupa el calendario del comercio).
2. `POST /api/reservas` — guarda el turno unos minutos.
3. `POST /api/reservas/:id/pagar` — responde `402` con el precio en wARS; el agente firma la autorización Permit2 y reintenta. Sin gas para el pagador.
4. `POST /api/reservas/:id/cancelar` — con el token que devolvió la reserva; el agente dice cuánto devuelve y por qué.

**Una persona** puede hacer lo mismo desde Telegram (`/reservar`, o "quiero cancha mañana a las 20"), abrir el link de pago en MetaMask o MiniPay y firmar sin gas. Si no tiene wARS, la página la manda a cargar pesos con Ripio.

## Agenda del comercio

Seña separa "de dónde salen los horarios" del resto del agente (`src/agenda.js`). Hay dos fuentes:

- **Grilla propia (por defecto):** canchas y horarios en `config/negocio.json`, reservas en SQLite. Sirve para probar y para un comercio sin sistema de turnos.
- **Google Calendar:** el comercio sigue usando su calendario. Seña lee los eventos para saber qué está libre, y al confirmarse el pago crea el evento con el id de la reserva; al cancelar lo borra. Se activa con `GOOGLE_SERVICE_ACCOUNT_JSON_PATH` y `GOOGLE_CALENDAR_ID` (ver [GUIA.md](GUIA.md), sección 12).

Si Google falla, Seña **falla de forma segura**: no muestra horarios, no reserva y no cobra. Esta etapa solo conecta Google Calendar; otros sistemas de turnos pueden sumarse implementando la misma interfaz.

## Stack de Celo que usa

- **wARS** (Ripio) como moneda de cobro, devolución y retiro — `0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D`.
- **x402 v2** con el facilitador de Celo (`api.x402.celo.org`), esquema `exact` con **Permit2**: el cliente no paga gas.
- **ERC-8021**: todas las transacciones que manda la wallet del agente (devoluciones, retiros, registro) llevan el tag, vía `@celo/attribution-tags`.
- **ERC-8004**: identidad del agente registrada desde su propia wallet (`agent.json`).
- **Fee abstraction (CIP-64)**: opcionalmente el agente paga su gas en USA₮/USDC en vez de CELO (`FEE_CURRENCY`).

## Arquitectura

```
Agente del cliente ─ API REST ─┐                  ┌─ x402 (cobro, Permit2) ── facilitador de Celo
Telegram (grammY) ─────────────┼─► SenaAgent ─────┤
Página /pagar ─────────────────┘   (decisiones)   └─ wallet del agente ── devoluciones / retiro en wARS (con tag)
                                      │
                       ┌──────────────┴───────────────┐
                 Agenda del comercio              SQLite (reservas, lista
                 (Google Calendar o grilla propia)  de espera, decisiones, transferencias)
```

- `src/policy.js` — reglas puras y deterministas (cancelación, reventa, topes, retiro).
- `src/agent.js` — el agente: reservas, pagos, cancelaciones, lista de espera, cola de transferencias, cierre.
- `src/agenda.js`, `src/google-calendar.js` — fuentes de agenda (grilla propia y Google Calendar con cuenta de servicio).
- `src/x402.js` — servidor de cobro x402 + facilitador simulado para pruebas.
- `src/chain.js` — envíos en Celo con tag de atribución.
- `src/bot.js` — Telegram para clientes y dueño. `src/nl.js` — interpreta texto libre (reglas + Claude opcional).
- `web/pay.js` — página de pago en el navegador.

**Seguridad de la plata:** las transferencias pasan por una cola idempotente (una clave por motivo, nunca se paga dos veces la misma devolución); si un envío queda en estado dudoso no se reintenta solo, se le avisa al dueño; hay topes por devolución y por día; el retiro nunca toca señas de turnos futuros; y nada se confirma ni se cobra si el calendario del comercio no se puede verificar.

## Correrlo

Requisitos: Node 22.5 o más nuevo.

```bash
npm install
npm test          # 70 pruebas: política, agente, HTTP con x402 real (facilitador simulado), bot, cadena, Google Calendar (falso, sin red)
npm run demo      # la historia completa en modo simulado, sin plata
npm start         # servidor + bot (MODE=mock por defecto)
```

Para mainnet ver **[GUIA.md](GUIA.md)** (paso a paso en castellano).

## Límites declarados

- El comercio de la demo es de demostración; no hay un comercio real detrás de los turnos de ejemplo.
- La integración de agenda cubre **Google Calendar** (y la grilla propia). Otros sistemas de turnos todavía no están conectados.
- **Futuro, no incluido:** reservar en cualquier sitio web de turnos que no hable x402. Hoy el comercio tiene que exponer esta puerta (o correr Seña delante de su agenda).
- Con Google Calendar, un solo calendario sirve a todas las canchas: cada evento nombra la cancha en el título o en el lugar (`Cancha 1 - Pérez`); un evento que no nombra ninguna ocupa todas. La lista de espera solo funciona para turnos tomados por Seña, no para los que el comercio ocupó a mano.
- La rampa pesos → wARS es la de Ripio (link a `ramp.ripio.com`); el agente no toca cuentas bancarias.
- El primer pago de una wallet puede necesitar una aprobación de Permit2 con gas si wARS no soporta `permit` (EIP-2612); `npm run probe` lo verifica y la página lo ofrece cuando hace falta.
- La custodia es de una wallet caliente del agente con saldo chico y topes; el resto se retira al dueño cada noche.

Licencia MIT.
