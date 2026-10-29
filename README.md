# Seña — un agente que cobra y gestiona señas en pesos digitales

**Seña** es un agente para comercios que trabajan con turnos (canchas, peluquerías, consultorios). Cobra la seña en **wARS** (el peso argentino de Ripio) sobre **Celo** usando **x402**, aplica una política de cancelación y reubica turnos con lista de espera. Cuando alguien cancela decide solo qué hacer con la plata: devuelve todo, devuelve una parte o la retiene, le ofrece el turno liberado a la lista de espera y, si el turno se vuelve a vender, le devuelve la seña al que canceló. Al final del día cierra la caja y le transfiere al dueño lo que ya no está comprometido.

**Se reserva por Telegram, por la web o por API**, y el comercio maneja todo desde un **panel**. El calendario es propio (una grilla en SQLite que el dueño configura).

> Hecho para **Agents on Open Rails** (Celo · Loops House), track **Stable Agents LatAm**. El negocio de este repo, "Pádel Demo", es un **comercio de demostración**: los turnos y precios son de ejemplo. **Agentes de otros participantes pueden reservar y pagar por API** (x402 estándar).

*English summary: Seña is an autonomous deposit agent for appointment-based businesses in Argentina. It collects booking deposits in wARS on Celo mainnet via x402 (Permit2, gasless for the payer), applies a deterministic cancellation policy, re-sells freed slots to a waitlist, refunds retained deposits when a slot is resold, and settles the day to the owner. Customers book through Telegram, a web page or the API; the owner runs the business from a password-protected dashboard (editable settings stored in SQLite, blocks for holidays/maintenance, manual refunds, approvals). Every transaction the agent sends carries its ERC-8021 attribution tag; its identity is registered under ERC-8004. Once paid, the reservation is also tied to the payer's wallet: the customer can sign a gasless message to see and cancel their bookings from any device, and the agent mints an untransferable ERC-721 ticket (ERC-5192, `contracts/SenaTicket.sol`) to the paying wallet — burned on cancellation, marked as played afterwards — on Celo Sepolia by default. The demo business is a demonstration shop, and other participants' agents can book through the API.*

## Por qué es un agente y no un bot

Un bot de reservas anota turnos. Seña **maneja plata ajena con reglas propias**, sin que el dueño intervenga:

| Situación | Qué decide el agente |
|---|---|
| Alguien cancela con más de 24 h | Devuelve el 100 % de la seña |
| Cancela entre 24 h y 6 h antes | Devuelve el 50 % y ofrece el turno a la lista de espera |
| Cancela con menos de 6 h | Retiene la seña y ofrece el turno; **si se revende, devuelve la seña** |
| Nadie paga en 15 minutos | Libera el turno |
| Pago que llega tarde o a un turno ya ocupado | Lo acepta si el turno sigue libre; si no, lo devuelve completo |
| El comercio bloquea un turno con reservas pagadas | Avisa al dueño y, si él lo pide, cancela y devuelve toda la seña |
| Devolución grande o muchas en el día | No la manda: le pide aprobación al dueño |
| Cierre del día | Calcula lo comprometido en turnos futuros y retira solo lo libre |

(Los números son los de `config/negocio.json`; el dueño los cambia desde el panel y **valen para reservas nuevas**: cada reserva conserva la seña y la política con las que se pagó.)

Cada decisión queda registrada con su regla y su transacción: `/decisiones` (página pública, sin datos personales), el panel y `GET /api/decisiones`.

## Cómo reservan los clientes

- **Web (`/`)**: se elige día y turno, se reserva con nombre (y contacto opcional) y se pasa a la página de pago `/pagar/:id`. "My bookings" works with un token guardado en el navegador: ahí se ve el estado, se cancela (mostrando antes cuánto devuelve y por qué) y se pide lista de espera en un turno ocupado.
- **Telegram**: "quiero cancha mañana a las 20" o `/reservar`; el link de pago llega por el chat.
- **API / otros agentes**: `GET /api/turnos` → `POST /api/reservas` → `POST /api/reservas/:id/pagar` (responde `402` con el precio en wARS; el agente firma la autorización Permit2 y reintenta) → `POST /api/reservas/:id/cancelar`.

Para pagar con una persona: abre el link en MetaMask o MiniPay y firma (sin gas). Si no tiene wARS, la página la manda a cargar pesos con Ripio. Las tres vías comparten las mismas reglas.

## Tu reserva en tu billetera

La billetera que pagó la seña es la dueña de la reserva. Hay dos formas de verlo, y las dos son opcionales:

| | Qué es | Cuesta | Dónde |
|---|---|---|---|
| **See my bookings with my wallet** | La persona firma un mensaje de un solo uso y se le muestran todas las reservas pagadas desde esa dirección, en cualquier dispositivo. Puede ver qué devolvería la política y cancelar: la seña vuelve a la misma billetera. Un agente de IA que pagó por x402 puede hacer lo mismo. | Nada (firmar no cuesta gas) | `/` → "Mis reservas" |
| **Ticket NFT** | Al confirmarse el pago, el agente le manda un NFT **intransferible** con la imagen y los datos del turno. | Gas del agente (centavos; en testnet, nada) | La billetera, el explorador, `/pagar/:id` |

**Cómo se firma:** conectar la billetera no alcanza, porque las direcciones son públicas. El servidor da un mensaje con un código de un solo uso, la billetera, el sitio y un vencimiento de 5 minutos; con la firma válida abre una sesión corta (15 minutos). Solo billeteras comunes (EOA: MetaMask, MiniPay). Las reservas sin pagar todavía no tienen billetera.

**El ticket NFT** (`contracts/SenaTicket.sol`, ERC-721 + ERC-5192):

| Momento | Qué pasa con el ticket |
|---|---|
| Se confirma el pago | Se emite a la billetera que pagó (o a la que se eligió en el pago de prueba) |
| Se cancela la reserva | Se quema: la billetera solo muestra reservas vigentes |
| Se juega el turno | Se marca "jugada" y queda de recuerdo |
| La cadena falla | La reserva queda confirmada igual; el ticket se reintenta solo (5 veces) y después el dueño puede reintentar desde el panel |

- **Intransferible:** el ticket es de quien pagó, así que la devolución nunca es ambigua. Solo el agente emite, actualiza y quema.
- **Sin duplicados:** el id sale del código de la reserva; emitir dos veces la misma falla en el contrato, así que reintentar es seguro.
- **Sin servidor:** la imagen y los datos viajan dentro del contrato (`tokenURI`), así que se ven en la billetera aunque Seña esté apagada.
- **Dónde:** Celo Sepolia (testnet) por defecto; `NFT_CHAIN=sepolia` o `celo`. En Celo mainnet cada ticket es una transacción del agente con su tag ERC-8021.
- **Apagado por defecto:** sin `NFT_CONTRACT` no hay NFT; con `NFT_SIMULADO=true` (solo `MODE=mock`) se simula en memoria y la pantalla lo dice.
- **Privacidad:** queda público en la cadena que una billetera reservó tal cancha a tal hora (sin nombres).

Despliegue y uso: GUIA, sección 14.

## La interfaz

Pensada primero para el celular (390 px), con modo claro y oscuro automático, botones de 48 px o más, foco visible y contraste AA verificado por test. Un solo sistema de diseño (`public/css/sena.css`) y una guía que muestra todos los componentes: **`/guia-estilos`**.

- **Web de reservas (`/`)**: tira de días, turnos agrupados por hora con las canchas, formulario corto y pago. El token (wARS) va en letra chica: "$ 6,000 *in wARS*".
- **Pago (`/pagar/:id`)**: resumen, cuenta regresiva, conectar billetera y pagar, ayuda para quien no tiene wARS y todos los estados (sin billetera, red equivocada, sin saldo, firma rechazada, vencida, ya pagada). En **MODO PRUEBA** hay un botón "Pay as a test" que recorre el pago completo sin billetera (usa el mismo camino x402; no existe con la cadena real).
- **See my bookings with my wallet** y **ticket NFT**: ver la sección anterior. La confirmación del pago muestra la imagen del ticket, su estado y "Add to my wallet".
- **Registro público (`/decisiones`)**: lo que decide el agente, en inglés, con la regla aplicada y la transacción; con números del agente y sin datos personales.
- **Panel (`/panel`)**: menú inferior en el celular y barra lateral en pantallas grandes.

## Panel del comercio / venue dashboard (`/panel`)

Se entra con la clave `OWNER_DASHBOARD_PASSWORD` del `.env` (sin ella el panel queda deshabilitado y lo dice). Secciones: **Today** (señas, devoluciones, saldo y lo comprometido), **Calendar** (día y semana por cancha: libre, esperando pago, confirmado, bloqueado), **Bookings** (filtros y cancelación con vista previa de lo que devolvería la política), **Blocks** (turno, cancha o día entero con motivo; si hay reservas pagadas adentro, avisa y ofrece cancelarlas con devolución total), **Decisiones**, **Pending** (aprobar o rechazar transferencias), **Settings** y **Daily close**.

La **configuración del negocio vive en la base** (`config/negocio.json` solo da los valores iniciales, una vez): nombre, canchas (agregar, renombrar, desactivar), horarios por día y por cancha, duración, anticipación, precio, % de seña, tiempo para pagar, política de cancelación, topes de devolución y hora del cierre. Todo se valida al guardar y cada cambio se registra (quién, cuándo, antes y después). **La dirección de retiro, las claves, `PAY_TO` y el modo no se pueden cambiar desde el panel**: solo por `.env`.

Seguridad del panel: clave comparada en tiempo constante, límite de intentos, cookie `httpOnly` + `SameSite=Strict` (+ `Secure` con https), token CSRF en toda acción que cambia datos, chequeo de `Origin` y política de seguridad de contenido estricta. Las páginas arman todo con el DOM (nada de `innerHTML` con datos).

## Stack de Celo que usa

- **wARS** (Ripio) como moneda de cobro, devolución y retiro — `0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D`.
- **x402 v2** con el facilitador de Celo (`api.x402.celo.org`), esquema `exact` con **Permit2**: el cliente no paga gas.
- **ERC-8021**: todas las transacciones que manda la wallet del agente (devoluciones, retiros, registro) llevan el tag, vía `@celo/attribution-tags`.
- **ERC-8004**: identidad del agente registrada desde su propia wallet (`agent.json`).
- **ERC-721 + ERC-5192**: el ticket NFT intransferible de cada reserva (`contracts/SenaTicket.sol`), en Celo Sepolia por defecto.
- **Fee abstraction (CIP-64)**: opcionalmente el agente paga su gas en USA₮/USDC en vez de CELO (`FEE_CURRENCY`).

## Arquitectura

```
Telegram (grammY) ─┐                 ┌─ x402 (cobro, Permit2) ── facilitador de Celo
Web  /  ───────────┤                 │
API REST ──────────┼─► SenaAgent ────┤
Panel /panel ──────┘   (decisiones)  ├─ wallet del agente ── devoluciones / retiro en wARS (con tag)
                          │          └─ SenaTicket (NFT) ── un ticket por reserva (Celo Sepolia / mainnet)
                          │
                       SQLite (reservas, lista de espera, decisiones, transferencias, ajustes, bloqueos)
```

- `src/policy.js` — reglas puras y deterministas (cancelación, reventa, topes, retiro).
- `src/agent.js` — el agente: reservas, pagos, cancelaciones, lista de espera, bloqueos, cola de transferencias, cierre.
- `src/settings.js` — configuración del negocio: validación, registro de cambios, horarios por día y cancha.
- `contracts/SenaTicket.sol` (+ `SenaTicket.json` compilado) y `src/nft.js` — el ticket NFT: contrato, contenido del ticket y clientes (real y simulado).
- `src/panel.js` — panel del comercio (sesión, CSRF, límite de intentos); las rutas llaman a los métodos del agente, sin lógica de plata propia.
- `src/server.js` — API HTTP y páginas. `src/x402.js` — cobro x402 + facilitador simulado para pruebas. `src/chain.js` — envíos en Celo con tag.
- `src/bot.js` — Telegram. `src/nl.js` — interpreta texto libre (reglas + Claude opcional).
- `public/` — web de reservas, registro público, panel y estilos (JS plano, sin build); `public/css/sena.css` es el sistema de diseño. `web/pay.js` — página de pago (se compila con esbuild).

**Seguridad de la plata:** las transferencias pasan por una cola idempotente (una clave por motivo, nunca se paga dos veces la misma devolución); si un envío queda en estado dudoso no se reintenta solo, se le avisa al dueño; hay topes por devolución y por día; el retiro nunca toca señas de turnos futuros.

## Correrlo

Requisitos: Node 22.5 o más nuevo.

```bash
npm install
npm test          # 139 pruebas: política, agente, configuración y bloqueos, panel, web, diseño (contraste AA), HTTP con x402 real (facilitador simulado), bot, cadena
npm run e2e       # prueba en un navegador real (Chrome): reserva web, pago de prueba, cancelación y panel. Sin plata
npm run seed      # (solo MODE=mock) carga reservas ficticias en todos los estados y decisiones variadas: `npm run seed -- --reset` para rehacerlas
npm run capturas  # capturas de cada pantalla en celular y escritorio -> docs/capturas/
npm run nft:clave # genera una clave de testnet para el NFT; después npm run nft:deploy y npm run nft:probar (ver GUIA, sección 14)
npm run demo      # la historia completa en modo simulado, sin plata
npm start         # servidor + bot (MODE=mock por defecto)
```

Para mainnet ver **[docs/GUIA.md](docs/GUIA.md)** (paso a paso en castellano).

## Límites declarados

- El comercio de la demo es de demostración; los turnos y precios son de ejemplo.
- El calendario es propio (la grilla de Seña); no se sincroniza con otras agendas.
- "My bookings" on the web se guarda en el navegador: si se borra o se cambia de dispositivo, se pierde el acceso (las reservas siguen existiendo y se pueden gestionar desde el panel). Los clientes de la web no reciben avisos: see the status in "My bookings".
- La rampa pesos → wARS es la de Ripio (link a `ramp.ripio.com`); el agente no toca cuentas bancarias.
- El primer pago de una wallet puede necesitar una aprobación de Permit2 con gas si wARS no soporta `permit` (EIP-2612); `npm run probe` lo verifica y la página lo ofrece cuando hace falta.
- El ticket NFT se despliega por defecto en una **testnet** (Celo Sepolia): sirve para mostrar el flujo, pero la puntuación del hackathon cuenta solo la actividad en Celo mainnet. Para que cada ticket sea una transacción del agente en mainnet hay que desplegar con `NFT_CHAIN=celo` (ver GUIA, sección 14).
- "Ver mis reservas con la billetera" funciona con billeteras comunes (EOA); las billeteras de contrato no están soportadas todavía.
- La custodia es de una wallet caliente del agente con saldo chico y topes; el resto se retira al dueño cada noche.

## Idioma

La **interfaz** (web de reservas, pago, panel, registro público y la guía de estilos), los **mensajes del agente** (motivos de cada decisión, avisos) y las **respuestas del bot de Telegram** están en **inglés**. El bot entiende mensajes en **español o inglés** ("¿hay cancha mañana a las 21?", "is there a court tomorrow at 9 pm?"). Estos documentos están en español. Los nombres de las canchas, el comercio y los motivos de bloqueo los escribe el comercio en el idioma que quiera.

## Video

`video/` tiene el explainer en formato short vertical (voz en inglés, subtítulos en inglés y español, paleta del panel). Las voces están en `video/elevenlabs/`, la animación en `video/render/` y las instrucciones de estilo en `video/INSTRUCCIONES-VIDEO.md`. Para regenerarlo hace falta `ffmpeg` (variable `FFMPEG=/ruta/ffmpeg` si no está en el PATH) y Chrome:

```
npm run video      # deja el mp4 en video/out/
```

## Documentos

- **[docs/GUIA.md](docs/GUIA.md)** — paso a paso para correrlo, llevarlo a mainnet y desplegar el NFT.
- **[MIS-DEBERES.md](MIS-DEBERES.md)** — lo que solo puede hacer el dueño del proyecto (claves, plata, gente), en orden y con los comandos.
- **[video/INSTRUCCIONES-VIDEO.md](video/INSTRUCCIONES-VIDEO.md)** — cómo está hecho el video y qué decir en cada escena.
- **[ENTREGA](docs/ENTREGA.md)** — todo lo que hay que entregar: textos para el formulario, evidencia, guion del video y chequeo final.
- **`docs/capturas/`** — cada pantalla en celular y escritorio, claro y oscuro.

Licencia MIT.
