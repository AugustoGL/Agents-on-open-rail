# Guion v2 — más corto y más técnico

El video actual dura 2:36. Esta versión apunta a **~1:50** (con los textos marcados como opcionales, ~2:05) y dice cosas más concretas: cómo se usa la rampa de Ripio, qué es el NFT y para qué sirve, y el stack que pide el hackathon.

Cómo usarlo: generá **un audio por bloque** en ElevenLabs con la **misma voz y los mismos ajustes** de la versión 1 (Stability ~45 %, Similarity ~75 %, Style ~10 %, Speaker boost) y guardalos en `video/elevenlabs-v2/Bloque1.mp3` … `Bloque8.mp3`. Con eso armo la animación y la mezcla (el render es el mismo, `npm run video`).

Reglas del texto para la voz: "Seña" se escribe **Sen-ya** y "wARS" **w-A-R-S**, como antes. No pegues las partes entre corchetes ni la columna "ES".

---

## Bloques (texto para ElevenLabs)

### 1 · Gancho (~10 s)
> This agent handles real money, and it doesn't improvise a single cent. Every refund follows a written rule, not a mood. It's called Sen-ya.

**ES:** Este agente maneja plata de verdad y no improvisa ni un centavo. Cada devolución sigue una regla escrita, no un humor. Se llama Seña.

**Imagen:** la moneda `$` que se dibuja; "REAL MONEY" / "WRITTEN RULE, NOT A MOOD" (la carita tachada).

### 2 · El problema (~10 s)
> A booking deposit is a fight waiting to happen: full refund, half, or nothing, and nobody remembers what was agreed. So the agent applies one rule to everyone.

**ES:** Una seña es una pelea esperando a pasar: devolución total, la mitad o nada, y nadie recuerda qué se acordó. Por eso el agente aplica una sola regla a todos.

**Imagen:** cliente y local, los tres "?" (100 %, 50 %, 0 %) y el sello "NO RULE".

### 3 · Cobro y rampa de Ripio (~22 s) — *lo técnico nuevo*
> People book on Telegram, on the web, or through an API. The deposit is charged in w-A-R-S, Ripio's digital Argentine peso on Celo, over x402 and Permit2: the customer signs, the facilitator settles. No w-A-R-S yet? The payment page opens Ripio's on-ramp with your wallet already filled in. Pay in pesos, and w-A-R-S lands in your wallet.

**ES:** Se reserva por Telegram, por la web o por API. La seña se cobra en wARS, el peso argentino digital de Ripio en Celo, con x402 y Permit2: el cliente firma y el facilitador liquida. ¿Todavía no tenés wARS? La página de pago abre la rampa de Ripio con tu billetera ya cargada. Pagás en pesos y los wARS llegan a tu billetera.

**Imagen:** tres íconos (Telegram, Web, API) → el agente; una moneda "wARS"; después un flujo de tres pasos: `PESOS` → `RIPIO ON-RAMP (AR · Celo · wARS · your wallet)` → `WALLET`.

**Verificado en el código:** el enlace de la página de pago es `ramp.ripio.com/?country=AR&chain=42220&token=WARS&address=<tu billetera>` (`web/pay.js`, función `rampa`).

### 4 · La regla (~18 s)
> Cancel more than 24 hours ahead and you get everything back. Between 24 and 6 hours, half. Under 6 hours, the deposit stays with the venue. Unless the slot is resold: then you get it back anyway. Nobody decides that exception. The waitlist does.

**ES:** Si cancelás con más de 24 horas, te devuelven todo. Entre 24 y 6 horas, la mitad. Con menos de 6, la seña queda para el local. Salvo que el turno se revenda: ahí te la devuelven igual. Esa excepción no la decide nadie. La decide la lista de espera.

**Imagen:** la línea de tiempo y el número grande (100 % → 50 % → 0 % → 100 %), el arco azul de la reventa y la fila de la lista de espera.

### 5 · Frenos y auditoría (~10 s; ~14 s con la línea opcional)
> Up to twenty thousand pesos, the agent refunds on its own. Above that, it asks the owner. [OPCIONAL: Every refund is idempotent, so a retry never pays twice.] And every decision is public, with the rule that applied.

**ES:** Hasta veinte mil pesos, el agente devuelve solo. Por arriba, le pregunta al dueño. *(Opcional: cada devolución es idempotente: un reintento nunca paga dos veces.)* Y cada decisión es pública, con la regla que se aplicó.

**Imagen:** la barra con el tope de $ 20,000 y el dueño que aprueba; el registro público de decisiones.

### 6 · El NFT y la billetera (~16 s; ~20 s con la línea opcional) — *lo técnico nuevo*
> Once you pay, your wallet receives a non-transferable NFT ticket: an ERC-721 with ERC-5192, with your slot on it. Connect that wallet, sign a free message, and you see and cancel your bookings from any device. [OPCIONAL: Cancel, and the ticket is burned. Play, and it's marked played.]

**ES:** Cuando pagás, tu billetera recibe un ticket NFT intransferible: un ERC-721 con ERC-5192, con tu turno. Conectás esa billetera, firmás un mensaje gratis y ves y cancelás tus reservas desde cualquier dispositivo. *(Opcional: si cancelás, el ticket se quema; si jugás, queda marcado como jugado.)*

**Imagen:** la tarjeta del ticket (la misma imagen que genera el contrato: "SEÑA · BOOKING", cancha, hora, "CONFIRMED") entrando a una billetera; un candado (intransferible); el botón "See my bookings with my wallet" con la firma.

**Importante (para que no sea mentira):** el NFT es la **credencial visible** de la reserva; lo que da acceso para ver y cancelar es **firmar un mensaje con la billetera que pagó**. El guion lo dice así.

### 7 · El stack del hackathon (~10 s; ~13 s con la línea opcional)
> It's built on Celo: x402 payments, an ERC-8004 identity for the agent, and an ERC-8021 attribution tag on every transaction it sends. [OPCIONAL: Fees can be paid in stablecoins through fee abstraction.]

**ES:** Está hecho sobre Celo: pagos con x402, una identidad ERC-8004 para el agente y una etiqueta de atribución ERC-8021 en cada transacción que envía. *(Opcional: las comisiones se pueden pagar en stablecoins con fee abstraction.)*

**Imagen:** una fila de insignias: `x402` · `Permit2` · `wARS (Ripio)` · `ERC-8004` · `ERC-8021` · `ERC-721 + ERC-5192` · `Celo`.

**Línea de prueba (SOLO cuando sea verdad):** *"And it's live on Celo mainnet: [N] real payments and refunds, verified on chain."* Se agrega después de los pagos reales con tag (`MIS-DEBERES-3.md`, punto 4).

### 8 · Cierre (~12 s)
> An agent that handles money is only worth trusting if you can see why it did what it did. Would you leave your deposit with an agent? All the info is in the README.

**ES:** Un agente que maneja plata solo merece confianza si podés ver por qué hizo lo que hizo. ¿Le dejarías tu seña a un agente? En el README está toda la info.

**Imagen:** el ojo, la pregunta y la tarjeta README.md (como antes).

---

## Duración estimada

| | Sin opcionales | Con opcionales |
|---|---|---|
| Voz | ~1:45 | ~2:05 |
| Video (con las transiciones) | ~1:50 | ~2:10 |

(Antes: 2:36.) La estimación sale de ~2,6 palabras por segundo, que es lo que midieron tus audios. Si al generar un bloque sobra, **sacá una frase opcional**, no aceleres la voz.

## Qué cubre del hackathon (Stable Agents: LatAm)

| Criterio | Dónde lo dice el video |
|---|---|
| 1. Funciona en mainnet con un wFIAT real | Línea de prueba del bloque 7 (**solo cuando sea verdad**) |
| 2. Uso real de wFIAT y del stack de Celo | Bloques 3 y 7: wARS, x402, Permit2, ERC-8004, ERC-8021, fee abstraction, NFT |
| 3. Autonomía y utilidad del agente | Bloques 1, 2, 4 y 5: reglas propias, topes, aprobación del dueño, registro público |
| 4. UX que una persona usa | Bloques 3 y 6: pagar sin saber de cripto (rampa de Ripio, firma gratis, reservas desde cualquier dispositivo) |
| 5. Impacto para LatAm | Bloques 1 y 3: peso argentino digital, comercios con turnos (el comercio real lo suma el uso real) |

## Qué tiene que ser verdad antes de publicar esta versión

| Frase | Estado hoy | Qué hacer |
|---|---|---|
| "ERC-8004 identity for the agent" | El registro **todavía no se hizo** | `npm run register -- --send` (punto 4.3). Si no llegás, cambiá la frase a "ready for an ERC-8004 identity" o sacala |
| "ERC-8021 tag on every transaction" | El código lo pone en modo `live` con `ATTRIBUTION_TAG` | Confirmar con `npm run verify-tag -- 0x<hash>` después del primer pago real |
| "NFT ticket … burned / marked played" | Probado en Celo Sepolia (testnet) el 29/10 | Ya es verdad; decí "testnet" si te preguntan |
| "customer signs, facilitator settles" (x402 + Permit2) | Probado con facilitador simulado; el real depende del punto 4 | Confirmar con el primer pago real |
| "Ripio's on-ramp, pay in pesos" | El enlace sale del código; que Ripio acepte el pago desde tu banco es de Ripio | Probar el enlace una vez con tu billetera |
| "Live on Celo mainnet" | **Todavía no** | No lo digas hasta tener los hashes |
