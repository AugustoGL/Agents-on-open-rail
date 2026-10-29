# Cómo hacer el Short de Seña en el formato de Stupy Doo

Este documento sale del análisis de los tres videos de referencia que están en esta carpeta
(balón de Sudáfrica, Torre de Pisa, la música de antes). Lo medí y lo transcribí; no es opinión.
La idea: que alguien que nunca vio tu proyecto lo entienda en ~2:30, se acuerde de una cosa
y vaya al README.

Restricciones que ya decidiste: **no se muestra nada real** (ni pantallas, ni Telegram, ni
la billetera: todo es animación/motion graphics) y **la última frase dice que en el README está toda la info**.

---------------------------------------------------------------------------

## 0. Resumen de una página (leer si no leés nada más)

1. Vertical 9:16, 1080×1920, 30 fps (los originales: 720p a 60 fps el del balón, 360p a 30 fps los otros).
2. Dura 2:15–2:50. Los de referencia: 2:17, 2:21, 2:59.
3. ~400 palabras de locución **en inglés**, con **subtítulos en inglés y español a la vez**; ritmo 150–200 palabras/min, **voz continua casi sin silencios**.
4. El título/primera frase es una **afirmación que contradice lo que la gente cree**, con un dato concreto.
5. Un **objeto héroe** (una moneda/seña) que aparece en la primera escena y se transforma
   en cada escena. Nunca hay "cortes": todo se transforma en lo siguiente.
6. Paleta **idéntica a la del dashboard** (`public/css/sena.css`). Alternancia **fondo oscuro / fondo crema**; verde como color principal, ámbar para números, azul solo para una palabra o dos.
7. Texto en pantalla: **frases cortas en mayúsculas/negrita ancha**, etiquetas chiquitas en monoespaciada con la fuente ("Serrà · 2012").
8. Estructura de cada parte: *afirmación → "mucha gente cree..." → fuente con nombre y año → mecanismo con una analogía cotidiana → número traducido a algo tangible → giro ("pero eso no es lo más raro")*.
9. El final **vuelve a la imagen y a la frase del principio** (cierre circular) y deja una pregunta. Acá: pregunta + "all the info is in the README" (con su subtítulo en español).
10. Audio: voz a **-14/-15 LUFS integrados, rango de loudness 2–3 LU** (muy comprimida, pareja), música casi imperceptible debajo.

---------------------------------------------------------------------------

## 1. Qué medí en los tres videos

| | Balón | Torre de Pisa | Música |
|---|---|---|---|
| Duración | 2:17 | 2:21 | 2:59 |
| Resolución / fps | 720p / 60 | 360p / 30 | 360p / 30 |
| Palabras | 461 | 460 | 453 |
| Palabras por minuto | ~201 | ~196 | ~151 (incluye 15 s de sonificación sin voz) |
| Sonoridad integrada | ≈ -14 / -15 LUFS | ≈ -14 / -15 LUFS | ≈ -14 / -15 LUFS |
| Rango de loudness | 2–3 LU | 2–3 LU | 2–3 LU |
| Cortes duros detectados | casi ninguno | casi ninguno | casi ninguno (solo cambios de fondo) |
| Cantidad de "fuentes" nombradas | 5 (Adidas, Loughborough, FIFA, NASA, Ravi Meta) | 4 (Berland, Univ. de Pisa, gobierno italiano, Mussolini) | 3 (Serrà 2012, Mauch 2015, Spotify 2018) |

Lo importante: **las tres tienen casi la misma cantidad de palabras (~455)**. Es una receta, no un azar.
Si tu guion tiene 400–460 palabras y lo leés parejo, vas a caer en 2:15–2:50.

(Nota: la transcripción automática tiene errores de nombres propios, p. ej. "Joan Cera" = Joan Serrà,
"Matías Mouch" = Matthias Mauch, "hercilla/arsilla" = arcilla. El análisis no depende de eso.)

---------------------------------------------------------------------------

## 2. La psicología: por qué se recuerda

Lo que sigue está sacado de las transcripciones. Cada punto tiene el ejemplo real.

### 2.1 El arranque es una contradicción con un número
- "El balón **más redondo** que se había fabricado **volaba en zigzag**." (perfecto vs. zigzag)
- "La torre de Pisa **no se va a caer**, desde 2001 se está **enderezando sola**."
- "La música de antes **no era mejor**, aunque un estudio de **medio millón** de canciones diga otra cosa."

Patrón: **[creencia común negada] + [dato concreto que la desafía]** en menos de 8 segundos.
No hay saludo, no hay "hola", no hay "hoy vamos a ver". El cerebro recibe una brecha de curiosidad
("¿cómo?") y el resto del video es la respuesta. Es el título del Short y a la vez la primera frase hablada.

### 2.2 Nombran la creencia equivocada, para romperla
"Mucha gente cree que la torre se inclina más cada año." / "Tus papás juran que lo mejor fue lo suyo."
Al espectador le gusta que le confirmen lo que pensaba **y después descubrir que estaba un poco mal**. Genera la sensación de "casi lo sabía".

### 2.3 Toda afirmación viene con fuente con nombre, apellido, institución y año
"Ravi Meta, un ingeniero de la NASA", "John Burland, un ingeniero de suelos de Londres",
"Serrà y su equipo, 2012, Barcelona". En pantalla aparece lo mismo como etiqueta chiquita en
monoespaciada. Efecto: **credibilidad sin tono solemne**. Es la parte que más se puede copiar:
para Seña la "fuente" son tu propio README, el contrato, la regla de reembolso. Nunca inventes una fuente.

### 2.4 Cada concepto abstracto tiene una analogía de la vida cotidiana
- balón liso → "pelota de plástico del tianguis / de supermercado"
- arreglar la torre → "como se arregla una **mesa coja**, cortándole tantito a la pata larga"
- suelo blando → "como un **pastel húmedo**"
- paleta de timbres → "como los **colores de un pintor**"
- torre curva → "como un **plátano**"
Regla: **una analogía por idea**, con objeto doméstico, dicha en la misma frase que el concepto.

### 2.5 Los números se traducen a algo que podés imaginar
"38 metros cúbicos de tierra, **casi 4 pipas de agua**." "+9 dB, **casi el doble de fuerte para tu oído**."
"Más de 4 metros por fuera de la base." Nunca queda un número solo. En pantalla el número grande
se ve en ámbar, dentro de una caja con borde fino, con un contador que sube.

### 2.6 Bucles abiertos y giros cada 25–35 segundos
Frases-gancho a mitad del video, con función de "no te vayas":
- "**Pero eso no es lo más raro.**"
- "**Pero hay otro lado.**"
- "Y fue justo lo que midió la NASA." / "pero **lo más raro es cómo lo arreglaron**."
- "Y no es la primera vez que la torre se salva sola."
Son el mecanismo de retención del formato. En un guion de 2:30 poné **4 o 5**.

### 2.7 Contra-intuición como resolución
"Para arreglar el balón, lo hicieron **menos perfecto**." "Los ingenieros le quitaron tierra **para que bajara**."
La respuesta correcta siempre es lo opuesto de lo esperable. Eso es lo que la gente cuenta después.
**La frase que el espectador va a repetir** tiene que estar escrita y marcada en el guion (ver sección 4).

### 2.8 Cierre circular
- Balón: empieza "volaba en zigzag", termina "**y lo que veía era esto**" (se ve el zigzag).
- Torre: empieza "se está enderezando sola", termina "**y la torre entera sigue haciendo lo mismo**".
- Música: empieza "¿era mejor?", termina "**¿Era mejor la música de antes?**" con la espiral del principio reducida a un punto.
La última imagen es **la primera imagen, simplificada**. Eso da sensación de "completo" y de memoria visual.

### 2.9 Tono
- Inglés neutro (el subtítulo en español sigue el mismo tono), cálido y **deadpan**: dato curioso dicho como a un amigo, sin gritos.
- Sin signos de exclamación, sin "increíble", sin "impactante". El asombro lo pone el dato.
- Frases de 8–15 palabras, una idea por frase. Casi todo es sujeto-verbo-objeto.
- Humor mínimo y seco: "pelota del tianguis", "como un pastel húmedo".
- Palabras prohibidas: "revolucionario", "innovador", "disruptivo", "solución", "ecosistema", "web3". Para Seña usá: booking, deposit, refund, money, rule.

### 2.10 Lo que sí hay en el audio de la Música y conviene copiar
Hay **15 s sin voz** (1:41–1:56) donde "suena" el dato: la sonificación del estudio. Es una interrupción de patrón
(el cerebro vuelve a prestar atención). Para Seña la versión equivalente: 6–8 s sin voz con solo **el sonido de las reglas**
(un "tic" por cada regla que se aplica, una nota por cada devolución). Opcional pero muy efectivo.

---------------------------------------------------------------------------

## 3. Ficha de formato (lo que el editor tiene que copiar)

### 3.1 Lienzo
- 1080×1920 px, 30 fps (60 fps si querés fluidez extra; el de balón los usa). Márgenes de seguridad: 120 px arriba, 380 px abajo (la interfaz de Shorts tapa ahí), 60 px a los lados.
- Cuadro de texto principal centrado en el **tercio inferior** (y ≈ 1200–1500 px). El héroe y los gráficos van en el centro-superior.

### 3.2 Paleta = la del dashboard (`public/css/sena.css`)
Se copia tal cual de los tokens del producto, para que el video y la interfaz se reconozcan como lo mismo.
Escenas oscuras = tokens del modo oscuro. Escenas claras = tokens del modo claro.

| Rol | Oscuro | Claro | Token | Uso en el video |
|---|---|---|---|---|
| Fondo | `#141411` | `#F6F3EC` | `--bg` | fondo de escena |
| Superficie | `#1E1D19` | `#FFFFFF` | `--surface` | tarjetas, cajas de número |
| Superficie 2 | `#26251F` | `#FBF9F4` | `--surface-2` | paneles, marcos de esquina |
| Texto | `#F2EFE6` | `#1C1B18` | `--ink` | texto principal |
| Texto suave | `#ABA79B` | `#5C594F` | `--ink-muted` | subtítulo en español, etiquetas |
| Línea | `#36342D` | `#E2DDD0` | `--line` | ejes, bordes de 1–2 px |
| **Verde (héroe)** | `#5FB790` | `#1F6F54` | `--primary` | objeto héroe, trazos, palabra negada |
| Verde suave | `#1B2E26` | `#E4F1EA` | `--primary-soft` | rellenos, glow |
| **Ámbar (datos)** | `#F5CB6B` | `#7A4A00` | `--wait-fg` | números grandes, año/tramo activo |
| **Rojo (alerta)** | `#FFA79D` / `#FF8A80` | `#A3281D` / `#B3261E` | `--bad-fg` / `--danger` | sellos, "0 %", errores |
| **Azul (una palabra)** | `#9CC4F5` | `#1E4A7A` | `--info-fg` | una sola palabra de énfasis |

Regla: **nunca más de 3 colores a la vez en una escena** (fondo + verde + un acento). Estos colores reemplazan al naranja y al lima del formato original de Stupy Doo.
El "color del héroe" de este documento es siempre el verde `--primary`.

### 3.3 Tipografías
- **Mismas familias que el dashboard:** sans del sistema (`system-ui`) y monoespaciada del sistema (`ui-monospace`). Para renderizar igual en cualquier máquina usá **Inter** (pesos 600–800) y **JetBrains Mono**, que son sus equivalentes.
- **Frases clave en pantalla (inglés):** Inter 800, 64–84 px, interlineado 0,95, tracking −1 %. Mayúsculas solo en el gancho.
- **Etiquetas de fuente y ejes:** JetBrains Mono 22–28 px, minúsculas, tracking +2 %.
- **Subtítulos:** ver 3.6.

### 3.4 Elementos gráficos recurrentes
1. **Objeto héroe**: círculo/espiral verde con un punto, que se transforma (ver 6).
2. **Trazo verde** (la "cola" del héroe): línea de 3–4 px con glow suave que conecta una escena con la siguiente.
3. **Tarjeta-etiqueta de fuente**: rectángulo crema con borde de 2 px, sombra dura, **inclinada 3–5°**, texto mono dentro ("Serrà · 2012"). Entra con un pequeño rebote.
4. **Caja de número**: borde fino de 2 px, esquinas redondeadas 8 px, número en mono/grotesca 72 px, **superíndice** en el último dígito. Contador que sube en 0,8 s.
5. **Sello rojo** inclinado (rotación −8°), borde doble, texto en mayúsculas: "NO ES IA", "OJO".
6. **Ilustración con puntos de media tinta (halftone)** en las escenas crema: mapas, formas, siluetas.
7. **Ejes y curvas** muy finos (1,5 px), etiquetas mono, un punto verde que recorre la curva.
8. **Marcos de esquina**: cuatro "L" en las esquinas de un panel, para agrupar sets de gráficos (se ve en la rejilla de décadas de Música).
9. **Texto con onda**: en el cierre, las letras de la última palabra caen/ondulan ("a n t e s").

### 3.5 Ritmo visual
- **No hay cortes.** Un cambio de escena es una **transformación**: el héroe se deforma, o un elemento se vuelve el siguiente, o un fondo se barre.
- Entre escenas oscuras: transformación continua (0,6–1,0 s).
- Oscuro ↔ crema: el único "corte" aceptable; hacelo con **barrido horizontal rápido (0,25 s)** o con un círculo que se expande desde el héroe.
- Un elemento nuevo cada **1,5–3 s**. Si pasan 4 s sin que cambie nada, algo está mal.
- Easing: `ease-out-cubic` para entradas, `ease-in-out` para transformaciones. Rebotes cortos (overshoot 4–6 %) solo en tarjetas y sellos.
- 3D: el héroe tiene un volumen "blando" (esferas que se funden como gotas, "metaballs") en las escenas crema; en las oscuras es línea fina. Si no podés 3D, hacé las gotas con círculos y un filtro de "goo" (blur + umbral) en After Effects/Figma-Lottie.

### 3.6 Idioma y subtítulos (decisión nueva)
- **Voz: inglés.** **Subtítulos: inglés y español a la vez**, dos líneas.
- Posición: bloque centrado en el tercio inferior, y entre 380 y 520 px del borde de abajo (fuera de la zona que tapa la interfaz de Shorts).
- Línea 1 (inglés): Inter 700, 44 px, color `--ink`. Línea 2 (español): Inter 500, 34 px, color `--ink-muted`. Separación 10 px.
- Ancho máximo 880 px, máx. **2 líneas por idioma**, máx. ~42 caracteres por línea. Un subtítulo dura entre 1,6 y 4 s y cambia **en la pausa de la voz**, no a mitad de frase.
- Fondo: sin caja. Sombra suave `0 2px 12px rgba(0,0,0,.45)` en escenas oscuras; en las claras, texto `--ink` sin sombra.
- No es karaoke: aparece la frase entera cuando empieza a decirse. Las palabras de énfasis llevan el color verde (inglés) y se marcan igual en el español.
- **Frases clave grandes** (las de las escenas) van **solo en inglés**; su traducción va en el subtítulo en español. Así nunca hay tres textos compitiendo.
- Archivo: entregá también un `.srt` por idioma (`seña.en.srt`, `seña.es.srt`) para subirlos a YouTube como pistas de subtítulos, además de los quemados en el video.

**Glosario: el dashboard ya está en inglés. Usá EXACTAMENTE estas palabras en el video** (salen de `public/panel.js`, `public/reservar.js` y `public/decisiones-vista.js`):

| Español (subtítulo) | Inglés (voz + pantalla) | Dónde se ve en el producto |
|---|---|---|
| seña | **deposit** | "Deposit", "Pay the deposit" |
| turno | **slot** | "Slot", "Book your slot" |
| cancha | **court** | "Court 1", "Court 2" |
| reserva | **booking** | "My bookings", "Booking S-7K3M9Q" |
| comercio / local | **venue** | "Demo venue", "The venue cancels" |
| devolución / devolver | **refund** | "Refund", "Refunds today" |
| lista de espera | **waitlist** | "Join the waitlist" |
| Pendientes / Bloqueos | **Pending / Blocks** | menú del dashboard |
| Decisiones del agente | **Agent decisions** | menú y página pública |
| Cierre del día | **Daily close** | menú del dashboard |
| Esperando pago / Confirmada / Cancelada / Vencida / Jugada | **Awaiting payment / Confirmed / Cancelled / Expired / Played** | etiquetas de estado |
| MODO PRUEBA | **TEST MODE** | cartel azul |
| ticket NFT intransferible | **non-transferable NFT ticket** | "NFT ticket" |
| ver mis reservas con la billetera | **See my bookings with my wallet** | pantalla "My bookings" |
| regla | **rule** | "Rule TURNO_LIBRE" (los códigos de regla quedan en español: son identificadores) |

Frases clave grandes en pantalla (solo inglés; el español va en el subtítulo):

| Pantalla | Texto |
|---|---|
| Gancho | THIS AGENT HANDLES MONEY. IT DOESN'T IMPROVISE. |
| Problema | A FIGHT WAITING TO HAPPEN · NO RULE |
| Qué es | NOT A BOT / AN AGENT · BOOK · PAY · CANCEL · DECIDE |
| Regla | 100 % · 50 % · 0 % · if the slot is resold… you still get it back |
| Cita | NOBODY LOSES THE SLOT. NOBODY LOSES THE DEPOSIT. |
| Frenos | refunds alone up to here / asks the owner · IDEMPOTENT · DAILY CLOSE · decision · reason · time |
| Funciones | DO YOU NEED TO KNOW CRYPTO? / BARELY |
| Cierre | WOULD YOU LEAVE YOUR DEPOSIT WITH AN AGENT? · all the info is in the README |

---------------------------------------------------------------------------

## 4. El guion para Seña (locución en inglés)

Se lee a **~160 palabras/min**. Total: **~400 palabras ≈ 2:30**. Inglés neutro, tuteo natural, frases de 8–14 palabras.
Debajo de cada bloque va la traducción que se usa como **subtítulo en español** (no la inventes de nuevo al montar: copiala de acá).
Las marcas `[TURN]` son los bucles abiertos; `[QUOTE]` es la frase que se tiene que recordar.

> **Verificá antes de grabar:** que ninguna parte del cálculo del monto a devolver pase por un modelo de lenguaje
> (mirá `src/agent.js`), que los umbrales sean los de tu `negocio.json` (24 h / 6 h / 100 % / 50 %) y que el límite de
> aprobación sea el que tengas configurado ($20.000 por defecto). Si algo es distinto, el video dice lo que hace el código.

### Block 1 — Hook (0:00–0:12)
> **EN:** This agent handles real money, and it doesn't improvise a single cent.
> How much it refunds you when you cancel is decided by a written rule, not by a mood.
> It's called Seña. And it fixes something boring and expensive: the deposit.
>
> **ES:** Este agente maneja plata de verdad y no improvisa ni un centavo. Cuánto te devuelve al cancelar lo decide una regla escrita, no un humor. Se llama Seña. Y arregla algo aburrido y caro: la seña.

### Block 2 — The problem (0:12–0:32)
> **EN:** Most people think a deposit is paperwork. It's actually a fight waiting to happen.
> You book a court, you pay part of it, and when you cancel, nobody remembers what was agreed:
> the full amount, half, or nothing. The venue loses the slot. The customer loses the money. And the argument is free.
>
> **ES:** Casi todos creen que una seña es un trámite. En realidad es una pelea esperando a pasar. Reservás una mesa, pagás una parte, y cuando cancelás nadie recuerda qué se acordó: todo, la mitad o nada. El dueño pierde la mesa. El cliente pierde la plata. Y la discusión sale gratis.

### Block 3 — What it is (0:32–0:55)
> **EN:** Seña isn't a chatbot. It's an agent with one job: apply the same rule to everyone.
> It charges the deposit in wARS, a digital Argentine peso that runs on the Celo network.
> The customer signs with their wallet and pays no network fee. [✔ only if `npm run probe` confirms it]
> Four steps. Book. Pay. Cancel, or don't. And the agent decides.
>
> **ES:** Seña no es un chatbot. Es un agente con un solo trabajo: aplicar la misma regla a todos. Cobra la seña en wARS, un peso argentino digital que corre en la red Celo. El cliente firma con su billetera y no paga comisión de red. Cuatro pasos. Reservar. Pagar. Cancelar, o no. Y el agente decide.

### Block 4 — The rule (0:55–1:25)
> **EN:** The rule fits in one line. Cancel more than 24 hours ahead, and you get everything back.
> Between 24 and 6 hours, you get half. Under 6 hours, the deposit stays with the venue.
> And there's one exception you didn't expect: if the slot gets resold, you get your money back anyway.
> [TURN] And here's the strange part. Nobody decides that exception. The waitlist does.
>
> **ES:** La regla cabe en una línea. Si cancelás con más de 24 horas, te devuelve todo. Entre 24 y 6 horas, la mitad. Con menos de 6, la seña queda para el local. Y hay una excepción que no esperabas: si la mesa se revende, te devuelven igual. Y lo raro es esto: esa excepción no la decide nadie. La decide la lista de espera.

### Block 5 — Waitlist and resale (1:25–1:50)
> **EN:** When someone cancels, the agent offers the spot to the next person on the list. If that spot sells again,
> the money goes back to whoever cancelled, even late. [QUOTE] Nobody loses the slot, and nobody loses the deposit.
> It works for both sides, so nobody has to be convinced it's fair.
>
> **ES:** Cuando alguien cancela, el agente ofrece el lugar al siguiente de la lista. Si ese lugar se vende de nuevo, la plata vuelve a quien canceló, aunque haya sido tarde. Nadie pierde la mesa y nadie pierde la seña. Le sirve a los dos lados, así que nadie tiene que convencerse de que es justo.

### Block 6 — The brakes (1:50–2:15)
> **EN:** Now, what if something looks off? There are brakes. Up to twenty thousand pesos, the agent refunds on its own.
> Above that, it asks the owner. Every refund can be replayed without paying twice.
> And every night there's a daily close that matches what came in with what went out.
> [TURN] But the best part is this: everything stays in plain sight. A public page lists every decision the agent made, and why.
>
> **ES:** ¿Y si algo se ve raro? Hay frenos. Hasta veinte mil pesos, el agente devuelve solo. Por arriba, le pregunta al dueño. Cada devolución se puede repetir sin pagar dos veces. Y cada noche hay un cierre del día que cuadra lo que entró con lo que salió. Pero lo mejor: todo queda a la vista. Una página pública lista cada decisión del agente y por qué.

### Block 7 — What's inside (2:15–2:32)
> **EN:** Book on Telegram, on the web, or through an API. The owner gets a dashboard.
> With your wallet you sign without paying gas, and you see your bookings. Every paid booking also gets a digital ticket that can't be sold.
> Do you need to know crypto? Barely.
>
> **ES:** Reservá por Telegram, por la web o por API. El dueño tiene su panel. Con tu billetera firmás sin pagar gas y ves tus reservas. Cada reserva pagada también recibe un ticket digital que no se puede vender. ¿Hace falta saber de cripto? Casi nada.

### Block 8 — Close (2:32–2:45)
> **EN:** An agent that handles money is only worth trusting if you can see why it did what it did.
> That's Seña. Would you leave your deposit with an agent?
> All the info is in the README.
>
> **ES:** Un agente que maneja plata solo merece confianza si podés ver por qué hizo lo que hizo. Eso es Seña. ¿Le dejarías tu seña a un agente? En el README está toda la info.

Si la lectura pasa de 2:50, **sacá el bloque 7**, no aceleres la voz.

---------------------------------------------------------------------------

## 5. Escena por escena (director + editor + audio)

Convención: `T` tiempo, `FONDO`, `HÉROE`, `TEXTO EN PANTALLA`, `MOVIMIENTO`, `AUDIO`.
Todo es animación; nada es captura real.

### Escena 1 — Gancho (0:00–0:12) · fondo oscuro
- **HÉROE:** una moneda/seña = anillo verde fino con un punto central, 520 px de diámetro, centrada arriba (y≈780). Entra desde un punto y se "dibuja" girando en espiral (0–1,2 s), igual que la espiral de Música.
- **TEXTO:** en el tercio inferior, tres líneas que entran en secuencia con la voz:
  1. "ESTE AGENTE" (0:00)
  2. "MANEJA PLATA" (0:02)
  3. "Y NO IMPROVISA" → **"NO"** en verde (0:04)
  Tamaño 84 px, Archivo Black.
- **MOVIMIENTO:** el anillo "respira" (escala 100→103 %, 2 s), y el punto se desplaza como si fuera a rodar.
- **AUDIO:** voz entra en 0:00 (sin silencio previo). Pad grave sostenido a -30 LUFS. Un "tic" seco en la palabra "regla" (0:07).
- **Subtítulo en mono:** "seña · agente · wARS · celo" arriba, 24 px, 70 % de opacidad.

### Escena 2 — El problema (0:12–0:32) · transición a crema
- **Transición (0:12):** el anillo se expande en un círculo que barre el fondo oscuro a crema (0,6 s).
- **HÉROE:** se vuelve **una gota 3D soft** que se parte en dos (seña del cliente / lugar del dueño).
- **TEXTO:** tarjeta inclinada "una seña · hoy" (mono). Frase grande: "UNA PELEA ESPERANDO A PASAR" (0:17). Tres signos "?" que aparecen sobre las gotas con "100 %", "50 %", "0 %" mientras la voz dice "el cien por ciento, la mitad, o nada".
- **MOVIMIENTO:** las gotas se acercan y se separan nerviosamente (vibración 2 px).
- **AUDIO:** la música baja a -34 LUFS. Un "pop" suave por cada "?".
- **Sello rojo:** "SIN REGLA" rotado −8°, estampa en 0:28 (golpe seco, ver SFX).

### Escena 3 — Qué es (0:32–0:55) · oscuro
- **Transición:** las gotas vuelven a ser anillo y vuelven a oscuro.
- **HÉROE:** el anillo se abre y de él salen **4 nodos** conectados por una línea ámbar (los 4 pasos).
- **TEXTO:** "NO ES UN BOT" (0:34) → se tacha con una línea verde → "ES UN AGENTE" (0:37).
  Mono pequeño: "x402 · permit2 · celo".
- **Los 4 pasos (0:46–0:55):** cada nodo se ilumina en ámbar con su verbo: RESERVÁS · PAGÁS · CANCELÁS · DECIDE. Una vez por cada palabra que dice la voz.
- **AUDIO:** un "click" muy corto por nodo, afinado a la misma nota. Nada más.
- **Nota:** el "sin comisión" solo aparece si lo verificaste; si no, sacá esa frase y ese texto.

### Escena 4 — La regla (0:55–1:25) · el corazón del video
- **HÉROE:** el anillo se transforma en **una línea de tiempo horizontal** (como el eje 1960–2010 de Música) con los puntos "+24 h · 24 h · 6 h · la hora".
- **TEXTO + NÚMEROS:** tres cajas de número, una por tramo, con contador:
  - "100 %" ámbar (0:58)
  - "50 %" ámbar (1:05)
  - "0 %" rojo (1:11)
  Cada caja entra con rebote cuando la voz dice el tramo.
- **Línea de tiempo:** un punto verde recorre de izquierda a derecha, y el color de la curva pasa de ámbar a verde a rojo.
- **GIRO (1:17):** pausa de 0,4 s de voz, y el texto **"si la mesa se revende… te devuelven igual"** aparece con la palabra "igual" en azul. La curva "se levanta" de 0 % a 100 % con una flecha.
- **AUDIO:** una nota ascendente por cada caja (do, mi, sol). La excepción: **acorde completo** (do-mi-sol juntos) en 1:19.
- **SFX:** golpe grave en "SOLO PARA EL LOCAL" (1:12) y, 4 s después, un "whoosh" corto en la excepción.

### Escena 5 — Lista de espera y reventa (1:25–1:50) · crema
- **Transición:** barrido horizontal crema (0,25 s).
- **HÉROE:** una fila de **6 gotas** (personas) en la lista de espera; la primera se desprende (la que cancela), y la siguiente ocupa su lugar.
- **TEXTO:** tarjeta "lista de espera · 1.er lugar" y número "$ 0" → "$ 100 %" en ámbar cuando se revende.
- **CITA (1:42):** frase grande centrada: **"NADIE PIERDE LA MESA. NADIE PIERDE LA SEÑA."** Dos líneas, 76 px, con "NADIE" en verde las dos veces. Se queda 2,5 s completos en pantalla: es lo que se tiene que recordar.
- **AUDIO:** un "ding" cálido, no digital, cuando la plata vuelve. Después 0,6 s de música sola antes de seguir.

### Escena 6 — Los frenos (1:50–2:15) · oscuro
- **HÉROE:** el anillo se vuelve **un semáforo/tope**: una barra horizontal con una marca en "$20.000".
- **TEXTO:** caja de número "$20.000" (ámbar) con la etiqueta mono "devuelve solo hasta acá". Cuando la barra la pasa, cambia a rojo con la etiqueta "pregunta al dueño".
- **Tres iconos mini** (candado, dos flechas que se cruzan, luna): "IDEMPOTENTE", "CIERRE DEL DÍA" en mono.
- **GIRO (2:08):** pausa y luego "toda decisión queda a la vista": aparece un **registro público** como una lista de líneas finas que se escribe sola, con una etiqueta mono "decisión · motivo · hora".
- **AUDIO:** máquina de escribir muy suave (6 teclas), "tic" en cada línea. El golpe grave en la barra que pasa el tope.

### Escena 7 — Lo que trae (2:15–2:32) · rejilla (alterna crema/oscuro)
- **HÉROE:** el anillo se vuelve **rejilla de 8 casillas** (2×4) que se llenan una por una: TELEGRAM · WEB · API · PANEL · BILLETERA · TICKET NFT · DECISIONES · CIERRE.
- **TEXTO:** cada casilla es un ícono de línea + etiqueta mono. La del ticket lleva un candadito (soulbound).
- **Sello rojo:** "OJO" sobre "¿HACE FALTA SABER DE CRIPTO?" → debajo, en ámbar, "CASI NADA".
- **AUDIO:** música sube 3 dB en esta escena (es la única en la que sube). Un "click" por casilla.
- **No** muestres ni pantallas ni capturas ni el panel real: son íconos y rótulos.

### Escena 8 — Cierre (2:32–2:45) · oscuro, vuelve al principio
- **HÉROE:** todo se pliega de nuevo en el **anillo verde con punto** de la escena 1, y luego se reduce a **un punto** (como en Música).
- **TEXTO:**
  1. "UN AGENTE QUE MANEJA PLATA" / "TIENE QUE PODER EXPLICARSE" (2:32–2:38)
  2. Pregunta con **onda**: "¿LE DEJARÍAS TU SEÑA A UN AGENTE?" (2:38–2:42), las letras de "AGENTE" caen en cascada.
  3. Última pantalla (2:42–2:45), fondo crema: "**en el README está toda la info**" en mono grande + ruta `README.md` + QR al repo. Fondo quieto: **es la única pantalla estática del video**, 3 s, para que se lea.
- **AUDIO:** voz termina en 2:44. Música sostiene 1,5 s y se apaga con fade-out de 1,2 s. **Último "tic"** de la moneda al final.

---------------------------------------------------------------------------

## 6. El objeto héroe: cómo se transforma

| Escena | Forma | Color | Significado |
|---|---|---|---|
| 1 | anillo/espiral con punto | verde | la seña |
| 2 | dos gotas 3D que se tensan | verde sobre crema | cliente vs. dueño |
| 3 | 4 nodos unidos | verde + ámbar | los 4 pasos |
| 4 | línea de tiempo con punto | verde → ámbar → rojo | la regla |
| 5 | fila de 6 gotas | verde | lista de espera |
| 6 | barra con tope | ámbar / rojo | límite |
| 7 | rejilla de 8 casillas | verde | funciones |
| 8 | anillo → punto | verde | vuelta al inicio |

Regla de oro: **si el héroe desaparece más de 1 s, el video se siente cortado**. Siempre tiene que haber al menos un resto verde en pantalla.

---------------------------------------------------------------------------

## 7. Audio, en detalle

### 7.1 Voz
- **Idioma: inglés.** Quién: una voz de TTS buena en inglés (ElevenLabs, OpenAI TTS "ash"/"onyx") o la tuya si tu inglés es cómodo (acento latino está bien, la claridad importa más). Si es tuya: micrófono a un puño de distancia, habitación con ropa y cortinas, anti-pop. Pronunciá "Seña" como "SEN-ya" y "wARS" como "double-you-ARS" y sé consistente.
- **Estilo:** natural, algo grave, cercana, **sin entonación de locutor**. Subí al final de las frases de giro y bajá en las afirmaciones. Pausas de 0,2–0,4 s en comas, 0,5 s antes de los giros. **Casi no hay silencios más largos de 0,6 s.**
- **Velocidad:** ~160 palabras/min. Los originales van entre 150 y 200.
- **Edición:** cortá respiraciones fuertes, dejá las suaves. Nada de "eeeh". Sin reverb.

### 7.2 Procesado de voz (cadena)
1. High-pass 80 Hz.
2. EQ: -3 dB en 250 Hz si suena "cajoneado"; +2 dB en 3–4 kHz para presencia; +1,5 dB en shelf 10 kHz.
3. De-esser suave (5–7 kHz).
4. Compresor: ratio 4:1, ataque 10 ms, release 80 ms, 4–6 dB de reducción. Segundo compresor ligero (2:1) para dejarla **muy pareja**.
5. Limitador a -1 dBTP.

### 7.3 Música
- Pad/ambiente oscuro, sin melodía reconocible, sin batería, 60–80 bpm. A **-30/-34 LUFS** relativos a la voz, es decir: **casi no se oye**, se siente.
- Ducking: -3 dB más cuando entra un SFX o un número grande. Sube +3 dB solo en escena 7.
- Fuentes sin derechos: YouTube Audio Library, Pixabay Music, Free Music Archive (verificá licencia).

### 7.4 Efectos (SFX)
Pocos, secos, cortos. Lista: tic (moneda), click (nodos/casillas), pop (signos), golpe grave (tope, sello), whoosh corto (transiciones), ding cálido (reventa), tecleo (registro). Cada uno a -20/-22 LUFS máx., **ninguno compite con la voz**.

### 7.5 Master
- **-14 LUFS integrados** (aceptable -15 a -14), **LRA ≤ 3 LU**, true peak ≤ -1 dBTP.
- Comprobá con `ffmpeg -i final.mp4 -af loudnorm=I=-14:TP=-1:LRA=3:print_format=summary -f null -`.
- Mono compatible: escuchalo en un parlante de celular, que es como lo va a escuchar el 90 %.

### 7.6 ElevenLabs paso a paso (la versión simple)

Tiempo total: 15 minutos. Es para la voz en inglés.

1. Entrá a **elevenlabs.io** y creá una cuenta gratis (Sign up). El plan gratis alcanza para un video de 2:30; si se te acaban los créditos, el plan más barato por un mes lo resuelve.
2. Arriba, abrí **Text to Speech** (o "Speech"). Es la pantalla con una caja grande para escribir.
3. **Elegí la voz** (menú "Voice" a la izquierda o abajo): buscá en la librería (Voices → Explore) una voz **masculina o femenina, "conversational" o "narration", inglés neutro, tono cálido**. Escuchá 3 y quedate con la que suene como una persona contándote algo, no como un anuncio. Guardala con "Add to my voices".
4. **Modelo:** elegí el más nuevo que diga "v3" o "Multilingual v2" (el que te deje).
5. **Ajustes de voz** (el ícono de ruedita): Stability ~45 %, Similarity ~75 %, Style ~10 %, Speaker boost activado. Si suena muy plana, bajá Stability; si suena inestable, subila.
6. **Pegá el guion en inglés** (solo las líneas "EN:" de la sección 4, sin las marcas `[TURN]` ni `[QUOTE]`, sin la parte "ES:"). Hacelo **bloque por bloque** (8 bloques): un archivo por bloque es más fácil de sincronizar.
7. Apretá **Generate**, escuchá. Si una palabra sale mal ("Seña", "wARS"), escribila como suena: `Seña` → **"Sen-ya"**, `wARS` → **"w-A-R-S"** (con guiones o en minúsculas separadas) y generá de nuevo.
8. **Descargá** cada bloque (ícono de descarga, formato MP3 o WAV si puede). Nombralos `voz-01.mp3` … `voz-08.mp3`.
9. Pasalos al editor y poné cada uno donde empieza su escena. Dejá 0,3 s de aire entre bloques. Cortá cualquier silencio largo.
10. Exportá el audio final a **-14 LUFS** (sección 7.5). Si usás CapCut, subí la voz y bajá la música a ~15 % de volumen.

Qué NO hacer: no subas tu propia voz para "clonarla" a menos que quieras; no uses una voz "dramática" o de tráiler; no aceleres la lectura para que entre en el tiempo (sacá el bloque 7 si sobra).

Si no querés ElevenLabs: la voz de **OpenAI TTS (voz "ash")** o grabarla vos con el celular cerca de la boca dan un resultado parecido.

---------------------------------------------------------------------------

## 8. Herramientas y flujo de trabajo

**Opción A (recomendada, más control):** After Effects + Illustrator/Figma + DaVinci/Premiere.
**Opción B (gratis):** Figma (diseño) + Rive/Lottie o **Motion Canvas / Remotion** (animación en código) + Audacity/Reaper (voz) + DaVinci Resolve (montaje).
**Opción C (rápida):** Canva animado + CapCut. Menos fidelidad pero sale en una tarde.

Flujo:
1. **Grabá la voz primero** (sección 7). Todo el video se sincroniza con la voz, no al revés.
2. Exportá WAV limpio y sacá una **hoja de tiempos**: marcá en qué segundo empieza cada frase.
3. Diseñá los **8 fotogramas clave** (una por escena) en 1080×1920 con la paleta y las tipografías.
4. Animá escena por escena respetando 3.5 (nada de cortes, un elemento nuevo cada 1,5–3 s).
5. Armá las transiciones **después**, conectando los héroes.
6. Poné música y SFX. Recién ahí masterizá (7.5).
7. Revisión de lectura: en el celular, **sin sonido**, ¿se entiende de qué va? Con sonido, ¿se entiende sin mirar?
8. Exportá H.264 MP4, 1080×1920, 30 fps, 12–16 Mbps, AAC 192 kbps.

---------------------------------------------------------------------------

## 9. Publicación

- **Título (es el gancho, máx. 70 caracteres, en inglés con el español en la pista de subtítulos):** "This agent handles money and doesn't improvise" o "The deposit that refunds itself 🪙".
- **Descripción:** 2–3 líneas + "All the info is in the README / En el README está toda la info: <enlace>" (en los dos idiomas) + fuentes (README, contrato, `docs/`) + `#shorts #aiagents #celo #wARS #x402`.
- **Miniatura/primer cuadro:** el anillo verde sobre fondo oscuro con "NO IMPROVISA", sin carita ni flecha.
- **Comentario fijado:** la pregunta final ("¿le dejarías tu seña a un agente?").
- Subí **a una hora en que puedas contestar comentarios en la primera hora**.

---------------------------------------------------------------------------

## 10. Tabla de honestidad (claim → de dónde sale)

Solo decí lo que el repo hace hoy. Si algo no está verificado, no entra.

| Frase del video | Se apoya en | Estado |
|---|---|---|
| "no improvisa", regla fija | política determinista en `src/agent.js` / `negocio.json` | ✔ revisar que no pase por un LLM |
| +24 h 100 %, 6–24 h 50 %, −6 h retenida | configuración de la política | ✔ confirmar valores actuales |
| "si se revende, te devuelven" | lista de espera / reventa | ✔ |
| "hasta $20.000 devuelve solo" | límite de aprobación del dueño | ✔ configurable, confirmar número |
| "firmás sin gastar / sin comisión" | Permit2 / x402 | ⚠ depende de `npm run probe` |
| "cada decisión queda a la vista" | página pública `/decisiones` | ✔ |
| "ticket que no se puede vender" | contrato soulbound ERC-5192 | ⚠ ya está en Sepolia solo cuando hagas el deploy |
| "en el README está toda la info" | `README.md` | ✔ |

---------------------------------------------------------------------------

## 11. Checklist final

**Guion**
- [ ] Primera frase con contradicción + dato (≤ 8 s).
- [ ] 400–460 palabras.
- [ ] Una analogía doméstica por idea.
- [ ] Cada número traducido.
- [ ] 4–5 giros (`pero eso no es lo más raro`).
- [ ] Frase para recordar marcada y en pantalla 2,5 s.
- [ ] Cierre circular + pregunta + "en el README está toda la info".

**Imagen**
- [ ] 1080×1920, márgenes seguros.
- [ ] Héroe visible siempre.
- [ ] Máx. 3 colores por escena.
- [ ] Un elemento nuevo cada 1,5–3 s.
- [ ] Sin capturas reales.
- [ ] Una sola pantalla estática (el README).

**Audio**
- [ ] -14 LUFS, LRA ≤ 3, TP ≤ -1.
- [ ] Música casi inaudible.
- [ ] Silencios ≤ 0,6 s (excepto el opcional de 6–8 s).
- [ ] Probado en parlante de celular.

**Idioma y color**
- [ ] Voz en inglés, pronunciación de "Seña" y "wARS" consistente.
- [ ] Subtítulos EN + ES quemados, sin pisar la zona de la interfaz de Shorts; `.srt` por idioma.
- [ ] Todos los colores salen de los tokens de `public/css/sena.css`.

**Publicación**
- [ ] Título gancho, descripción con enlace, hashtags, pregunta fijada.

---------------------------------------------------------------------------

*Estado: el video está hecho (`npm run video`, código en `video/render/`). Los videos de referencia y las salidas del render no se suben al repo (`.gitignore`).*
