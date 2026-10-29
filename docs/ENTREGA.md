# Entrega — Agents on Open Rails

Todo lo que hay que juntar y pegar para la entrega. Track: **Stable Agents: LatAm (Ripio × Celo Core Co.)**.

**Fecha límite: lunes 9 de noviembre de 2026, 9:00 (Abidjan) = 6:00 en Córdoba.** Enviá el domingo 8.

---

## 1. Qué se entrega (resumen)

| # | Entregable | Dónde | Estado |
|---|---|---|---|
| 1 | Código | Repo público de GitHub | ✅ commiteado — falta `git push` |
| 2 | Proyecto cargado en Loops House | `loops project create` / web (ver §8) | ⬜ |
| 3 | **Billetera del agente** (campo obligatorio `agent-wallet`) | Formulario | ⬜ confirmar con `npm run address` |
| 4 | Demo en vivo (URL fija) | Servidor propio | ⬜ ver `MIS-DEBERES.md` §3 |
| 5 | Video de la demo (2–3 min) | YouTube no listado u otro | ⬜ ver §5 |
| 6 | Identidad ERC-8004 registrada | Desde la billetera del agente | ⬜ `npm run register -- --send` |
| 7 | Transacciones en **Celo mainnet con tu tag** | Celoscan | ⬜ ver §4 |
| 8 | Usuarios reales (comercio + compradores) | Números y frases | ⬜ ver `MIS-DEBERES.md` §7 |
| 9 | Documentación | `README.md`, `docs/GUIA.md`, `docs/capturas/` | ✅ |
| 10 | Evaluación contra los criterios | `loops evaluate` | ⬜ ver §8 |

---

## 2. Textos para el formulario (copiá y pegá)

### Nombre
**Seña**

### Tagline (una línea)
- **ES:** Un agente que cobra señas en pesos digitales (wARS), decide solo qué hacer con cada cancelación y le deja la reserva a quien pagó.
- **EN:** An agent that collects booking deposits in Argentine pesos (wARS), decides on its own what to do with every cancellation, and hands the booking to whoever paid.

### Pitch (corto)
> En Argentina, un comercio con turnos (canchas, peluquerías, consultorios) pierde plata y tiempo con los que reservan y no aparecen, y cobrar una seña a mano es un lío. **Seña** es un agente que cobra la seña en **wARS** (el peso argentino de Ripio) por **x402** en **Celo**, aplica una política de cancelación con reglas fijas (devuelve todo, devuelve una parte o la retiene), le ofrece el turno liberado a la lista de espera, le devuelve la seña al que canceló si el turno se revende y cierra la caja cada noche. Se reserva por Telegram, por la web o por API, y la reserva queda en la billetera de quien pagó: la puede ver y cancelar firmando un mensaje sin gas, y recibe un NFT intransferible como ticket. El dueño lo maneja todo desde un panel y puede auditar cada decisión del agente.

### Descripción larga (ES)
> **El problema.** Un comercio que vive de turnos pierde ingresos con las ausencias y las cancelaciones de último momento. Pedir una seña ayuda, pero cobrarla, devolverla según las reglas y reasignar el turno es trabajo manual y genera discusiones.
>
> **Qué hace Seña.** Es un agente que maneja plata ajena con reglas deterministas y auditables, sin que el dueño intervenga:
> - Cobra la seña en wARS por x402 (Permit2: el cliente firma y no paga gas).
> - Aplica la política de cancelación del comercio: más de 24 h → devuelve todo; entre 6 y 24 h → devuelve una parte y ofrece el turno; menos de 6 h → retiene la seña y, **si el turno se revende, se la devuelve**.
> - Libera el turno si nadie paga a tiempo, ofrece los turnos liberados a la lista de espera y acepta los pagos tardíos solo si el turno sigue libre.
> - Ante una devolución grande o muchas en el día, **no manda la plata solo**: pide aprobación al dueño.
> - Al cerrar el día retira al dueño solo lo que ya no está comprometido en turnos futuros.
> - Cada decisión queda registrada con la regla aplicada y su transacción, en un registro público sin datos personales.
>
> **La reserva es de quien pagó.** Desde "My bookings" la persona firma un mensaje de un solo uso (sin gas) y ve y cancela las reservas pagadas con su billetera desde cualquier dispositivo; la seña vuelve a la misma billetera. Además el agente le manda un **NFT intransferible** (ERC-721 + ERC-5192) con los datos del turno: se quema al cancelar y pasa a "jugada" cuando se juega. Un agente de IA que pagó por x402 puede consultar sus reservas del mismo modo.
>
> **Para el comercio.** Un panel con el día, el calendario por cancha, las reservas, las devoluciones pendientes, los bloqueos (feriados, mantenimiento), el registro de decisiones y la configuración (precio, seña, horarios, política y topes), todo con historial de cambios. Los cambios valen para reservas nuevas: cada reserva conserva la seña y la política con las que se pagó.
>
> **Stack de Celo.** wARS (Ripio), x402 con el facilitador de Celo (Permit2), ERC-8021 (todas las transacciones del agente llevan el tag), ERC-8004 (identidad del agente), fee abstraction opcional y un ERC-721 intransferible propio.
>
> **Cómo se prueba.** Hay una demo con "Pay as a test" para recorrer todo sin billetera ni plata, un panel y un registro público de decisiones. Otros agentes pueden reservar y pagar por API (`GET /api/turnos` → `POST /api/reservas` → pago x402).

### Descripción corta (EN)
> Seña is an autonomous deposit agent for appointment-based businesses in Argentina. It collects booking deposits in wARS on Celo via x402 (Permit2, gasless for the payer), applies a deterministic cancellation policy (full refund, partial refund, or keep the deposit and refund it if the slot is resold), re-offers freed slots to a waitlist, escalates large refunds to the owner, and settles the day. Customers book via Telegram, web or API; the paying wallet owns the booking — it can see and cancel it by signing a gasless message and receives an untransferable ERC-721 ticket (burned on cancellation). Every agent transaction carries its ERC-8021 tag and the agent has an ERC-8004 identity. Every decision is logged publicly with the rule applied.

### English version of the form texts (copy & paste — the form is in English)

**Name:** Seña

**Tagline:** An agent that collects booking deposits in Argentine pesos (wARS), decides on its own what to do with every cancellation, and hands the booking to whoever paid.

**Short pitch:**
> In Argentina, businesses that run on appointments (sports courts, hair salons, clinics) lose money and time on no-shows, and collecting a deposit by hand is a mess. **Seña** is an agent that collects the deposit in **wARS** (Ripio's Argentine peso) over **x402** on **Celo**, applies a cancellation policy with fixed rules (full refund, partial refund, or keep it), offers the freed slot to a waitlist, **refunds the person who cancelled if the slot is resold**, and closes the books every night. Customers book on Telegram, on the web or through an API, and the booking belongs to the wallet that paid: it can see and cancel it by signing a gasless message, and it receives a non-transferable NFT as a ticket. The owner runs everything from a dashboard and can audit every decision the agent made.

**Long description:**
> **The problem.** A business that lives on appointments loses revenue to no-shows and last-minute cancellations. Asking for a deposit helps, but collecting it, refunding it by the rules and re-assigning the slot is manual work and causes arguments.
>
> **What Seña does.** It is an agent that handles other people's money with deterministic, auditable rules, without the owner stepping in:
> - Collects the deposit in wARS over x402 (Permit2: the customer signs and pays no gas).
> - Applies the venue's cancellation policy: more than 24 h ahead → full refund; between 6 and 24 h → partial refund and the slot is offered on; under 6 h → the deposit is kept and, **if the slot is resold, it is refunded**.
> - Releases the slot if nobody pays in time, offers freed slots to the waitlist, and accepts late payments only if the slot is still free.
> - On a large refund, or many in one day, it **does not send the money on its own**: it asks the owner for approval.
> - At the end of the day it withdraws to the owner only what is no longer committed to future slots.
> - Every decision is logged with the rule applied and its transaction, in a public log with no personal data.
>
> **The booking belongs to whoever paid.** From "My bookings" the person signs a one-time message (no gas) and sees and cancels the bookings paid from their wallet, on any device; the deposit goes back to the same wallet. The agent also sends a **non-transferable NFT** (ERC-721 + ERC-5192) with the slot details: it is burned on cancellation and changes to "played" when the slot is played. An AI agent that paid over x402 can look up its bookings the same way.
>
> **For the venue.** A dashboard with the day, a calendar per court, bookings, pending refunds, blocks (holidays, maintenance), the decision log and settings (price, deposit, hours, policy and limits), all with a change history. Changes apply to new bookings: each booking keeps the deposit and policy it was paid with.
>
> **Celo stack.** wARS (Ripio), x402 with the Celo facilitator (Permit2), ERC-8021 (every agent transaction carries the tag), ERC-8004 (agent identity), optional fee abstraction and our own non-transferable ERC-721.
>
> **How to try it.** The demo has a "Pay as a test" button to go through everything with no wallet and no money, plus a dashboard and a public decision log. Other agents can book and pay through the API (`GET /api/turnos` → `POST /api/reservas` → x402 payment).
>
> **Language.** The interface, the agent's messages and the Telegram replies are in English; the Telegram bot understands English and Spanish.

**How the jury tries it in 2 minutes:**
1. Open `<demo URL>` on a phone.
2. Pick a day and a slot, type your name and tap **"Book and pay the deposit"**.
3. On the payment page tap **"Pay as a test"** (no wallet or money needed in TEST MODE). If you connect your wallet first, the NFT ticket goes to it.
4. See the confirmation and the **ticket**. Go back to "My bookings", tap "Cancel" and check how much you get back.
5. Open `<URL>/decisiones`: everything the agent decided is there.
6. Venue dashboard: `<URL>/panel`, password `<demo password>`.
7. Another agent can book through the API: `GET <URL>/api/turnos`.

### Tecnologías
Node 22 · Express 5 · SQLite · x402 v2 (Celo facilitator, Permit2) · wARS (Ripio) · viem · ERC-8021 · ERC-8004 · ERC-721/ERC-5192 (Solidity) · grammY (Telegram) · HTML/CSS/JS plano.

### Links
- **Repo:** `https://github.com/AugustoGL/Agents-on-open-rail`
- **Demo (MODO PRUEBA):** `<URL fija de la demo>`
- **Instancia real:** `<URL fija real, si la hay>`
- **Registro público de decisiones:** `<URL>/decisiones`
- **Guía de estilos:** `<URL>/guia-estilos`
- **Video:** `<link>`
- **Identidad ERC-8004:** `https://8004scan.io/` → buscar el agentId `<N>`
- **Billetera del agente:** `<0x…>` en Celoscan
- **Contrato del NFT:** `<0x…>` en el explorador de la red elegida

---

## 3. Cómo cumple cada criterio (Stable Agents: LatAm — 20 puntos cada uno)

| Criterio | Qué mostrar | Evidencia a juntar | Estado |
|---|---|---|---|
| **1. Funciona en mainnet con un wFIAT real** | Cobros y devoluciones reales en wARS sobre Celo, verificados por el tag | Hashes de pago, devolución y retiro; `npm run verify-tag` de cada uno; `loops project get` con `celo.agentWallet`; ERC-8004 registrado | ⬜ **depende de tu salida a mainnet** |
| **2. Uso real de wFIAT y del stack de Celo** | wARS como moneda de cobro/devolución/retiro + x402 + ERC-8021 + ERC-8004 + fee abstraction + NFT propio | README (sección "Stack de Celo"), el contrato `SenaTicket.sol`, la identidad en 8004scan | 🟡 código listo; falta la prueba en mainnet |
| **3. Autonomía y utilidad del agente** | Decisiones sin intervención del dueño, con topes y aprobación; a quién le ahorra tiempo | `/decisiones` (con reglas y transacciones), el panel "Pending", la tabla de reglas del README, números de uso real | 🟡 listo; falta el dueño real y su frase |
| **4. UX que una persona usa** | Alguien nuevo en cripto completa el flujo; importes en pesos; la cadena fuera de la vista | Video; capturas en `docs/capturas/` (celular); `npm run e2e`; prueba con 3 personas que no conocen cripto | 🟡 diseñado y probado en navegador; falta la prueba con billetera real y gente |
| **5. Impacto para LatAm** | Para quién es, cuánto le ahorra y cómo crece más allá del hackathon | Comercio real con nombre, # de reservas y compradores (incluidos desconocidos), plan de crecimiento | ⬜ **depende del uso real** |

**Camino para crecer (para el criterio 5):** otros comercios con turnos (canchas, peluquerías, consultorios) usando la misma plantilla; la configuración ya es editable desde el panel y soporta varias canchas, horarios por día y bloqueos; el siguiente paso son más rubros y más monedas (wBRL, wMXN, wCOP, wPEN, wCLP) con el mismo agente.

---

## 4. Evidencia a juntar (completá la tabla)

Ejecutá estos comandos y pegá el resultado.

| Qué | Cómo | Resultado |
|---|---|---|
| Billetera del agente | `npm run address` | `0x…` |
| Saldos | `npm run balance` | |
| Chequeo de wARS/Permit2 | `npm run probe` | |
| Registro ERC-8004 | `npm run register -- --send` | agentId `…` · tx `0x…` |
| Pago real #1 (x402, wARS) | pagar desde otra billetera | tx `0x…` |
| Devolución #1 (con tag) | cancelar con >24 h | tx `0x…` · `npm run verify-tag -- 0x…` |
| Retiro diario | `/cierre` en Telegram o el panel "Daily close" | tx `0x…` |
| Tickets NFT | `npm run nft:probar -- --to 0xTuBilletera --quemar` | links del explorador |
| Tests | `npm test` | **139 pruebas pasando** |
| Prueba en navegador real | `npm run e2e` | ✅ |
| Capturas | `npm run capturas` | 74 archivos en `docs/capturas/` |

**Números de uso real (completar):** comercio: `<nombre>` · reservas: `<n>` · señas cobradas: `<$>` · devoluciones: `<$>` · compradores distintos: `<n>` (de ellos, que no conozco: `<n>`) · compradores que repitieron: `<n>`.

---

## 5. Guion del video (2 a 3 minutos)

Grabá en el **celular** (es donde se usa) con la demo en MODO PRUEBA, y mostrá los hashes reales de mainnet en Celoscan al final.

| Tiempo | Qué se ve | Qué decís |
|---|---|---|
| 0:00–0:15 | El comercio / el dueño | "Este es `<comercio>`. Pierden plata cuando alguien reserva y no viene. Seña cobra una seña en pesos digitales y se encarga solo." |
| 0:15–0:50 | Web: elegir día y turno → nombre → pagar. Mostrar el **monto en pesos**, la cuenta regresiva y "Pagá con tu billetera" | "Se reserva en tres toques. La seña es de $ 6.000: la persona paga en wARS, el peso argentino digital, sin comisión de red." |
| 0:50–1:10 | Confirmación + el ticket NFT | "Al pagar, la reserva queda en su billetera como un ticket intransferible." |
| 1:10–1:40 | "See my bookings with my wallet" (firma) → Cancelar con vista previa | "Desde cualquier celular firma un mensaje sin gas y ve sus reservas. Antes de cancelar, el agente le dice cuánto le devuelve y por qué." |
| 1:40–2:20 | **`/decisiones`**: una cancelación tardía, la reventa y la devolución | "Cada decisión queda registrada con la regla y su transacción. Acá canceló 3 horas antes: la seña queda, y cuando el turno se revendió, el agente se la devolvió solo." |
| 2:20–2:40 | Panel: Hoy, Pendientes (una devolución grande esperando) | "Las devoluciones grandes no las manda solo: le pide aprobación al dueño." |
| 2:40–3:00 | Celoscan: un pago y una devolución con el tag; 8004scan | "Todo esto está en Celo mainnet. Acá están las transacciones reales y la identidad del agente." |

Consejos: texto grande en pantalla, sin música fuerte, sin mostrar claves ni el `.env`, y **subtitulado** si podés.

---

## 6. Cómo prueba el jurado en 2 minutos (ponelo en el formulario)

1. Abrí `<URL de la demo>` en el celular.
2. Elegí un día y un turno, escribí tu nombre y tocá **"Book and pay the deposit"**.
3. En la página de pago, tocá **"Pay as a test"** (no hace falta billetera ni plata en MODO PRUEBA). Si conectás tu billetera antes, el ticket NFT llega a ella.
4. Mirá la confirmación y el **ticket**. Volvé a "My bookings", tocá "Cancel" y fijate cuánto te devuelve.
5. Abrí `<URL>/decisiones`: ahí está todo lo que decidió el agente.
6. Panel del comercio (venue dashboard): `<URL>/panel`, clave `<clave de la demo>`.
7. Otro agente puede reservar por API: `GET <URL>/api/turnos`.

---

## 7. Qué decimos y qué NO (para no exagerar)

Los jueces prueban la app. Cada cosa que afirmes tiene que poder verificarse.

**Podés afirmar (está hecho y probado):**
- Cobro por x402 con Permit2, política determinista de cancelación, reventa, lista de espera, topes y aprobación del dueño, cierre del día.
- Reserva por Telegram, web y API; panel; registro público de decisiones; configuración editable con historial; bloqueos.
- Ver y cancelar con la billetera (firma sin gas) y el ticket NFT (contrato probado en EVM local).
- 139 pruebas + prueba en navegador real.

**Afirmalo solo cuando lo tengas verificado:**
- "Funciona en mainnet con wARS real" → hasta tener los hashes y `verify-tag`, no lo digas.
- "Tiene usuarios reales" → con números y nombre del comercio. Si los primeros compradores son conocidos, escribilo: *"los primeros usuarios son personas que conozco; estamos sumando más"*.
- "El NFT está desplegado" → decí en qué red (Celo Sepolia es una **testnet**).

**No lo afirmes:**
- Que el retiro a pesos es automático: hoy es una transferencia a tu dirección de Ripio y el paso a pesos es manual por la rampa pública (no confirmé si la rampa acepta wARS en Celo).
- Que cumple con la regulación argentina: es una consulta pendiente.
- Que funciona con billeteras de contrato: el "ver mis reservas" soporta billeteras comunes.

**Límites declarados (ya están en el README):** comercio de demostración; calendario propio; "My bookings" del navegador se pierde si se borra (la billetera lo resuelve para reservas pagadas); la billetera del agente es caliente, con saldo chico y topes; el NFT por defecto está en testnet.

---

## 8. Comandos de Loops (borrador primero)

Reemplazá lo que está entre `< >`. **Nunca uses `--confirm` en el primer comando:** primero mirá el borrador.

```bash
loops auth status                                   # ¿hay sesión?
loops project get --event agents-on-open-rails      # ¿ya hay proyecto? ¿cuál es tu tag? (celo.attributionTag)
loops enroll --event agents-on-open-rails           # idempotente; pide nombre, ubicación y rango de edad si faltan
loops project fields --event agents-on-open-rails   # todos los campos que pide el evento y cuáles faltan
loops credits --event agents-on-open-rails          # créditos disponibles

# Borrador (no escribe nada):
loops project create --event agents-on-open-rails \
  --name "Seña" \
  --tagline "<tagline de §2>" \
  --pitch "<pitch de §2>" \
  --description "<descripción larga de §2>" \
  --repoUrl https://github.com/AugustoGL/Agents-on-open-rail \
  --demoUrl <URL de la demo> --videoUrl <link del video> \
  --bountyIds e541ed4a-0971-4db4-82d2-043add3b6c49 \
  --answer agent-wallet=<0x… de npm run address>

# Si el borrador está bien, repetí el mismo comando agregando --confirm
```

- **Premio del track:** 1º puesto `e541ed4a-0971-4db4-82d2-043add3b6c49` (US$ 1.500) y 2º puesto `58f7e28c-b2da-4425-89b7-6a7e0fa099ac` (US$ 500). Corré `loops project fields` para ver cuál te deja elegir el formulario.
- **Billetera del agente** (`agent-wallet`): es obligatoria y **solo la dirección pública**. La entrega no está completa hasta que `loops project get` muestre `project.celo.agentWallet`.
- **Después de enviar**, corré la evaluación y arreglá lo que marque:
  ```bash
  loops evaluate --event agents-on-open-rails --sponsor stable-agents-latam
  ```
- **Chequeo de Celo en la web de Loops** (https://www.loops.house/agents-on-open-rails/playground/submit): apretá **"Find it"** para que encuentre tu primera transacción con tag y verificá que figura la identidad ERC-8004.

---

## 9. Chequeo final (domingo 8, antes de enviar)

**Código**
- [ ] `git push` hecho; el repo es **público**; `.env` no está subido; sin claves en el historial.
- [ ] `npm test` → 139 pruebas pasando · `npm run build:web` ok · `npm run e2e` ok.
- [ ] `README.md` y `docs/GUIA.md` dicen lo mismo que la app (y los números de pruebas coinciden).

**En línea**
- [ ] La demo carga desde el celular **con datos móviles** (no solo tu wifi) y desde una ventana de incógnito.
- [ ] El panel entra con la clave y **la clave está rotada** (no es la de ngrok).
- [ ] El video se ve sin iniciar sesión.
- [ ] La instancia va a seguir corriendo **hasta que termine la evaluación**.

**Mainnet**
- [ ] Hashes de pago, devolución y retiro guardados; `verify-tag` ok en cada uno.
- [ ] ERC-8004 registrado y visible en 8004scan.
- [ ] `loops project get` muestra `project.celo.agentWallet` y el chequeo de Celo da ok.

**Entrega**
- [ ] Borrador revisado, enviado con `--confirm`, y `loops evaluate` corrido y leído.
- [ ] Los textos de §2 son verdaderos hoy (sin afirmar lo que no verificaste).
- [ ] Una captura del formulario enviado.

---

## 10. Anexo: mapa del repo para el jurado

| Qué | Dónde |
|---|---|
| Las reglas de plata (puras y deterministas) | `src/policy.js` |
| El agente (reservas, pagos, cancelaciones, lista de espera, cola de transferencias, NFT, cierre) | `src/agent.js` |
| Cobro x402 con Permit2 | `src/x402.js` |
| Envíos con el tag ERC-8021 | `src/chain.js` |
| Ver reservas con la billetera (firma) | `src/server.js` (`/api/billetera/*`) |
| Ticket NFT | `contracts/SenaTicket.sol` · `src/nft.js` |
| Panel del comercio | `src/panel.js` · `public/panel.js` |
| Registro público de decisiones | `public/decisiones.js` · `public/decisiones-vista.js` |
| Sistema de diseño | `public/css/sena.css` · `/guia-estilos` |
| Pruebas | `test/` (139) · `scripts/e2e-browser.mjs` |
| Capturas de cada pantalla | `docs/capturas/` |
