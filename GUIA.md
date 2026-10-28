# Guía paso a paso — Seña

Todo en Linux, desde la terminal. Andá en orden: hasta el paso 6 **no se mueve plata real**.

> **Reglas de oro (no negociables)**
> - La clave privada, la frase de recuperación, el token de GitHub, la API key del facilitador y el contenido del `.env` **no se pegan en ningún lado**: ni chats, ni capturas, ni grupos, ni a mí.
> - La clave vive solo en `.env` (que ya está en `.gitignore`). Antes de cada `git push` mirá `git status`: si aparece `.env`, frená.
> - A los paneles (Loops House, faucet, Celoscan) solo va la **dirección pública** `0x84c6…67C8`.
> - La wallet del agente es solo para esto, con saldos chicos.

---

## 0. Qué hay en el zip

```
src/        el agente (reglas, cobros x402, cadena, configuración, panel, bot de Telegram, API)
web/        código de la página de pago (se compila a public/pay.bundle.js, ya viene compilada)
public/     web de reservas (/), registro público (/decisiones), panel (/panel) y página de pago /pagar/<reserva>
config/     negocio.json: valores INICIALES del negocio (después se editan desde el panel)
scripts/    herramientas: saldo, chequeos, registro ERC-8004, verificar tag, comprador de prueba, demo, prueba de navegador (e2e)
test/       139 pruebas automáticas
agent.json  ficha de identidad ERC-8004 (se publica en GitHub)
```

No trae `node_modules`, `.env` ni `data/` (se generan solos o ya los tenés).

## 1. Poner el código en tu repo

Suponiendo que el zip quedó en `~/Descargas` y tu repo es `~/Agents-on-open-rail` (cambiá las rutas si no):

```bash
cd ~/Descargas
rm -rf /tmp/sena && unzip -q sena.zip -d /tmp/sena
cp -r /tmp/sena/sena/. ~/Agents-on-open-rail/
cd ~/Agents-on-open-rail
ls
```

Tu `.env` no se toca (el zip no trae uno). El `README.md` y el `.gitignore` se reemplazan por los nuevos, está bien.

## 2. Node y dependencias

```bash
node -v
```

Tiene que decir **v22.5 o más** (v22.x, v24.x). Si es más viejo:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.bashrc
nvm install 22
```

Después:

```bash
npm install
npm test        # tiene que terminar con "pass 139" y "fail 0"
npm run demo    # cuenta la historia completa con plata simulada
```

En la demo vas a ver: reserva y pago por x402, alguien en lista de espera, cancelación tardía (retiene), el turno se revende, devuelve la seña, una reserva que vence sin pagar y el cierre del día con el retiro.

## 3. El `.env`

Agregá a tu `.env` las variables nuevas sin pisar lo que ya tenías:

```bash
touch .env && chmod 600 .env
for k in $(grep -o '^[A-Z0-9_]*=' .env.example); do grep -q "^$k" .env || grep "^$k" .env.example >> .env; done
```

Revisá que la clave del agente esté cargada (sin mostrarla):

```bash
npm run address
```

Tiene que decir `Dirección del agente: 0x84c67d2cB87C7f8EA1355B8F0914A2a3Df0367C8`. Si dice que falta, cargala así (no se ve lo que pegás, y no queda en el historial):

```bash
read -s -p "Pegá la clave privada y Enter: " K && sed -i '/^AGENT_PRIVATE_KEY=/d' .env && echo "AGENT_PRIVATE_KEY=$K" >> .env && unset K && echo && npm run address
```

Sirve con o sin `0x` adelante (MetaMask la da sin `0x`).

Para editar el resto: `nano .env` (guardar: Ctrl+O, Enter; salir: Ctrl+X).

## 4. Probarlo en tu compu (modo prueba, sin plata)

```bash
npm start
```

Dejalo corriendo y en otra terminal:

```bash
curl -s localhost:8402/health
curl -s localhost:8402/api/turnos
```

La página de pago se ve en `http://localhost:8402/pagar/<id-de-reserva>`. Con `MODE=mock` dice **MODO PRUEBA**: podés firmar con MetaMask y no se mueve nada.

Cortar el servidor: Ctrl+C.

## 5. El bot de Telegram

1. En Telegram abrí **@BotFather** → `/newbot` → nombre (ej. "Seña Pádel Demo") → usuario terminado en `bot` (ej. `sena_padel_demo_bot`).
2. Te da un token. Ponelo en `.env` como `TELEGRAM_BOT_TOKEN=...` (es secreto).
3. `npm start`, abrí tu bot y mandale `/quiensoy`. Te responde tu número de chat.
4. Ponelo en `.env` como `OWNER_CHAT_ID=...` y reiniciá (Ctrl+C y `npm start`).

Probá como cliente: `/reservar`, o escribí "quiero cancha mañana a las 20". Elegí turno → te da el link de pago → `/cancelar` → `/espera`.

Como dueño (solo vos): `/hoy`, `/decisiones`, `/pendientes`, `/saldo`, `/cierre`, `/aprobar <n>`, `/rechazar <n>`.

> Con `PUBLIC_BASE_URL=http://localhost...` el link de pago sale como texto (Telegram solo hace botones con https). Para que funcione desde el celular hace falta el paso 9.

Opcional: con `ANTHROPIC_API_KEY` el bot entiende frases más raras; sin eso funciona igual con reglas.

## 6. Chequeos de mainnet (solo lectura, no gasta nada)

```bash
npm run probe
```

Responde: si el facilitador de Celo acepta wARS, si el contrato de wARS es el esperado, si wARS soporta `permit` (si **sí**, el primer pago del cliente no necesita gas; si **no**, la primera vez hay que "habilitar" con un poco de gas) y si Permit2 está en Celo. **Mandame el resultado** (no tiene nada secreto).

## 7. Cargar la wallet del agente

El agente necesita gas para devolver señas, retirar y registrarse:

- **Opción A:** un poco de **CELO** (con 1 CELO sobra para todo el hackathon).
- **Opción B:** algo de **USA₮** o **USDC** en Celo y en `.env` poné `FEE_CURRENCY=USAT` (o `USDC`): el agente paga el gas con eso.

Formas de conseguirlo: el faucet de la hackathon (pide verificar con Self), que alguien te mande unos centavos a `0x84c6…67C8`, o comprar CELO en un exchange y retirarlo **por la red Celo** a esa dirección.

```bash
npm run balance
```

## 8. Identidad ERC-8004 (primera transacción real, con tag)

1. Subí el código a GitHub, así `agent.json` queda público:

   ```bash
   git status            # .env NO tiene que aparecer
   git add .
   git commit -m "Seña: agente de señas en wARS"
   git push
   curl -s https://raw.githubusercontent.com/AugustoGL/Agents-on-open-rail/main/agent.json
   ```

   (Si tu rama no es `main` o el repo tiene otro nombre, poné en `.env` `AGENT_URI=` con el link raw correcto.)

2. Simulá (no manda nada):

   ```bash
   npm run register
   ```

3. Si la simulación dio bien, mandala de verdad:

   ```bash
   npm run register -- --send
   ```

   Te muestra el hash, el **agentId** y verifica el tag. Poné `ERC8004_AGENT_ID=<número>` en `.env`.

4. Cuando quieras comprobar el tag de cualquier transacción:

   ```bash
   npm run verify-tag -- 0x<hash>
   ```

## 9. Una dirección pública con https

Telegram y los celulares necesitan llegar a tu servidor. Lo más rápido es un túnel de Cloudflare (gratis, sin cuenta):

```bash
curl -L -o cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb
cloudflared tunnel --url http://localhost:8402
```

Te da algo como `https://palabras-raras.trycloudflare.com`. Ponelo en `.env` como `PUBLIC_BASE_URL`, agregá `TRUST_PROXY=true` y reiniciá `npm start`. Ojo: **cambia cada vez** que reiniciás el túnel. Para la entrega final conviene un servidor fijo (lo vemos).

## 10. Cobros reales (MODE=live)

1. Entrá a **x402.celo.org**, conectá una wallet, firmá (no cuesta gas) y creá la API key. Ponela en `.env` como `X402_API_KEY=...`.
2. Si querés recibir el retiro diario en Ripio, poné tu dirección de depósito de wARS como `OWNER_PAYOUT_ADDRESS`.
3. En `.env`: `MODE=live`. Arrancá: `npm start`. Tiene que decir `modo live · wallet 0x84c6…`.
4. **Primer pago de prueba:** desde **otra** cuenta tuya de MetaMask (no la del agente) con algo de wARS (comprá unos pesos en Ripio y mandalos por la red Celo). Reservá desde el bot, abrí el link y pagá.
   - Si la página dice "habilitar wARS", tocá Habilitar (una sola vez, un poco de gas en CELO de esa cuenta).
5. Cancelá esa reserva desde el bot con más de 24 h de anticipación → el agente te devuelve todo. Esa devolución sale de la wallet del agente **con el tag**: verificala con `npm run verify-tag`.

Guardate todos los hashes: son la prueba para la entrega.

Si un pago falla con un error del facilitador sobre extensiones, probá `X402_BUILDER_CODE=false` en `.env`.

## 11. Panel del comercio y configuración del negocio

1. En `.env` poné una clave para el panel (mínimo 8 caracteres) y reiniciá:

   ```
   OWNER_DASHBOARD_PASSWORD=una-clave-larga-que-solo-sepas-vos
   ```

   Sin esa variable el panel queda **deshabilitado** (la página `/panel` lo dice). Si lo publicás por un túnel o proxy, poné también `TRUST_PROXY=true` para que el límite de intentos cuente la IP real de cada persona.
2. Abrí `http://localhost:8402/panel` (o tu dirección https) e ingresá con la clave. Tras 5 intentos fallidos desde una misma IP se bloquea el ingreso por 15 minutos.
3. Secciones: **Hoy**, **Calendario** (día y semana), **Reservas** (cancelar con vista previa), **Pendientes** (aprobar o rechazar), **Bloqueos**, **Decisiones del agente**, **Configuración** y **Cierre del día**. En el celular las cuatro primeras están en el menú inferior y el resto en "Más"; en pantallas grandes hay una barra lateral.

**La configuración vive en la base de datos.** `config/negocio.json` se importa **una sola vez**, cuando la base está vacía; cambiarlo después no tiene efecto. Todo se edita en **Configuración**: nombre y descripción, canchas (agregar, renombrar y desactivar; no se borran), horarios base, por día de la semana y por cancha (dejá vacío para usar los base, o marcá "Cerrado"), duración, anticipación, precio, % de seña, minutos para pagar, política de cancelación, topes del agente y hora del cierre. Cada valor se valida al guardar y el panel marca el campo con el problema. Para no gastar mucho en pruebas podés bajar el precio (ej. 400 → seña de $100).

- **Los cambios valen para reservas nuevas.** Las reservas ya hechas conservan la seña y la política con las que se pagaron.
- Cada cambio queda en el **Historial de cambios** (quién, cuándo, antes y después) y en Decisiones.
- **Solo se cambian en `.env`** (por seguridad): la dirección de retiro, las claves, `PAY_TO` y el modo.

**Bloqueos** (feriados, mantenimiento, un turno puntual): en la sección Bloqueos elegí un día entero, una cancha (uno o varios días) o un turno, con un motivo (**lo ven los clientes**). Si ya hay reservas pagadas adentro, el panel te avisa y te ofrece "Cancelar esas reservas y devolver todo": pasa por el agente (con sus topes: si supera el tope automático queda en Pendientes para que la apruebes) y queda en Decisiones. También podés bloquear un turno tocándolo en el Calendario.

## 12. Datos de demostración y capturas

- `npm run seed` carga reservas ficticias en todos los estados (esperando pago, confirmada, cancelada, vencida, jugada), cancelaciones de cada tipo, reventa, lista de espera, bloqueos, un pendiente de aprobación y decisiones variadas. **Solo funciona con MODE=mock** y se niega a tocar `data/sena.db` (la base real). Es en la base de prueba `data/sena-demo.db`; si ya tiene reservas, usá `npm run seed -- --reset` (borra esa base de prueba y la rehace).
- `npm run capturas` abre Chrome y guarda una captura de cada pantalla (celular 390x844 y escritorio 1280x800, claro y oscuro) en `docs/capturas/`, incluidos los estados de la página de pago con una billetera simulada. Avisa si detecta desbordes o errores de consola. Con `OUT=/carpeta` las guarda en otro lado.
- La guía de estilos está en `/guia-estilos`.

## 13. Probar la web y el panel en el navegador

- A mano, en modo prueba: `npm start` (con `OWNER_DASHBOARD_PASSWORD` en `.env`), abrí `/`, reservá un turno y mirá la página de pago (dice **MODO PRUEBA**). Para ver todo el flujo sin plata, `npm run demo`.
- Automática: `npm run e2e` abre Chrome (o el navegador que indiques con `CHROME_BIN=/ruta/al/navegador`) en una base temporal y simulada, y recorre la reserva web (reservar → pagar → mis reservas → cancelar → lista de espera) y el panel (ingreso, calendario, configuración, bloqueos, cierre). No usa tu `.env` ni mueve plata. Con `SHOTS=/carpeta npm run e2e` guarda capturas.

## 14. Ticket NFT de la reserva (Celo Sepolia, una testnet)

Al pagar la seña, el agente le manda a la billetera que pagó un **NFT intransferible** con la imagen y los datos de la reserva (`contracts/SenaTicket.sol`). No cuesta plata real: se despliega y se usa en una **testnet**. El contrato ya está compilado y probado en una EVM local; **falta desplegarlo con una clave tuya de testnet**.

1. **Una clave de testnet para el NFT** (distinta de la del agente del modo real). `npm run nft:clave` genera una nueva, te muestra la dirección y la línea para el `.env`. Copiá `NFT_PRIVATE_KEY=...` al `.env`.
2. **Fondos de prueba**: pedíselos a la dirección que te mostró en el faucet de Celo Sepolia (https://faucet.celo.org/celo-sepolia).
3. **Simular el despliegue**: `npm run nft:deploy`. Muestra la red, quién despliega, el saldo y el gas, y no manda nada.
4. **Desplegar**: `npm run nft:deploy -- --send`. Te da la dirección del contrato y el link del explorador.
5. **Activarlo**: en el `.env` poné `NFT_CONTRACT=<la dirección>` (y `NFT_CHAIN=celoSepolia`, que es el valor por defecto) y reiniciá `npm start`. Tiene que decir `Ticket NFT: Celo Sepolia (testnet) · contrato 0x…`.
6. **Probarlo sin pagar nada**: `npm run nft:probar -- --to 0xTuBilletera` emite un ticket de prueba a tu billetera (y con `--quemar` hace el ciclo completo: jugado y quemado). Lo ves en el explorador, y en MetaMask agregando la red Celo Sepolia.

Cómo se usa en la app:
- **Pagar con tu billetera:** el ticket va a la billetera con la que pagaste. En la confirmación aparece la imagen del ticket, su estado, "Ver en el explorador" y "Agregar a mi billetera".
- **MODO PRUEBA con "Pagar de prueba":** si conectás tu billetera antes, el ticket va a ella aunque el pago lo firme una billetera de prueba.
- **Sin `NFT_CONTRACT`:** el NFT queda apagado. Con `NFT_SIMULADO=true` (solo en `MODE=mock`) se simula en memoria, y la pantalla dice "Simulación": sirve para mostrar el flujo sin cadena.
- **Si la cadena falla:** la reserva queda confirmada igual y el ticket se reintenta solo (hasta 5 veces). Después aparece en el panel con "Reintentar el ticket NFT".
- **Otras redes:** `NFT_CHAIN=sepolia` (Ethereum Sepolia) o `celo` (mainnet: `nft:deploy` exige `--mainnet` y cuesta plata real).

Para volver a compilar el contrato (solo si lo cambiás): `npm install --no-save solc@0.8.24` y `npm run nft:compile`. La prueba del contrato en una EVM local: `contracts/probar/SenaTicket.ganache.mjs`.

## Problemas comunes

| Mensaje | Qué hacer |
|---|---|
| `fail` en `npm test` | Mandame la salida |
| `Falta AGENT_PRIVATE_KEY` | Paso 3 |
| `En MODE=live faltan: ...` | Completá esas variables en `.env` |
| `ATTRIBUTION_TAG inválido` | Tiene que ser `celo_aa27de260db7` |
| `insufficient funds` | La wallet del agente no tiene gas (paso 7) |
| El link de pago sale como texto | Falta https (paso 9) |
| "No te alcanza el saldo de wARS" | La wallet que paga necesita wARS (Ripio) |
| Una devolución quedó "pendiente" | Superó un tope: `/pendientes` y `/aprobar <n>` |
| "El panel está deshabilitado" | Falta `OWNER_DASHBOARD_PASSWORD` en `.env` (sección 11) |
| "Demasiados intentos" en el panel | Esperá 15 minutos; son 5 fallos por IP |
| Una transferencia quedó "dudosa" | No se reintenta sola a propósito: mirá el hash en Celoscan antes de aprobar |

## Para preguntar en office hours

1. ¿Los cobros x402 que liquida el facilitador cuentan para la tabla aunque no lleven el tag (se acreditan por la dirección PayTo)? ¿Puede PayTo ser la misma wallet del agente?
2. ¿La extensión `builder-code` en las respuestas 402 la acepta el facilitador de Celo?
3. ¿wARS soporta `permit` (EIP-2612)? Si no, ¿hay forma de evitar la aprobación con gas del primer pago?
4. ¿Hay un faucet sin Self para cargar unos centavos de CELO al agente?
