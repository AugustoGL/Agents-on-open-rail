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
src/        el agente (reglas, cobros x402, cadena, agenda/Google Calendar, bot de Telegram, API)
web/        código de la página de pago (se compila a public/pay.bundle.js, ya viene compilada)
public/     página /pagar/<reserva> que abre el cliente
config/     negocio.json: canchas, horarios, precio, política de cancelación
scripts/    herramientas: saldo, chequeos, registro ERC-8004, verificar tag, comprador de prueba, demo
test/       70 pruebas automáticas
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
npm test        # tiene que terminar con "pass 70" y "fail 0"
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

Te da algo como `https://palabras-raras.trycloudflare.com`. Ponelo en `.env` como `PUBLIC_BASE_URL` y reiniciá `npm start`. Ojo: **cambia cada vez** que reiniciás el túnel. Para la entrega final conviene un servidor fijo (lo vemos).

## 10. Cobros reales (MODE=live)

1. Entrá a **x402.celo.org**, conectá una wallet, firmá (no cuesta gas) y creá la API key. Ponela en `.env` como `X402_API_KEY=...`.
2. Si querés recibir el retiro diario en Ripio, poné tu dirección de depósito de wARS como `OWNER_PAYOUT_ADDRESS`.
3. En `.env`: `MODE=live`. Arrancá: `npm start`. Tiene que decir `modo live · wallet 0x84c6…`.
4. **Primer pago de prueba:** desde **otra** cuenta tuya de MetaMask (no la del agente) con algo de wARS (comprá unos pesos en Ripio y mandalos por la red Celo). Reservá desde el bot, abrí el link y pagá.
   - Si la página dice "habilitar wARS", tocá Habilitar (una sola vez, un poco de gas en CELO de esa cuenta).
5. Cancelá esa reserva desde el bot con más de 24 h de anticipación → el agente te devuelve todo. Esa devolución sale de la wallet del agente **con el tag**: verificala con `npm run verify-tag`.

Guardate todos los hashes: son la prueba para la entrega.

Si un pago falla con un error del facilitador sobre extensiones, probá `X402_BUILDER_CODE=false` en `.env`.

## 11. Cambiar el negocio

Todo está en `config/negocio.json`: nombre, canchas, horarios, precio (`precioTurnoArs`), porcentaje de seña, horas de la política de cancelación, topes de devoluciones automáticas. Reiniciá después de cambiarlo. Para no gastar mucho en pruebas podés bajar el precio (ej. `precioTurnoArs: 400` → seña de $100).

## 12. Conectar el Google Calendar del comercio (opcional)

Seña es la puerta de pago: el comercio sigue usando su calendario y Seña lo lee (qué está libre) y lo escribe (cada turno pagado). Sin esto, Seña usa su grilla propia y todo funciona igual que hasta acá.

**Una sola vez, en Google:**

1. Entrá a **console.cloud.google.com** y creá un proyecto (por ejemplo "Seña").
2. **APIs y servicios → Biblioteca →** buscá **Google Calendar API → Habilitar**.
3. **IAM y administración → Cuentas de servicio → Crear cuenta de servicio** (nombre: "sena"; no hace falta darle roles). Copiá el **email** de la cuenta (termina en `.iam.gserviceaccount.com`).
4. En esa cuenta: **Claves → Agregar clave → Crear clave nueva → JSON**. Se baja un archivo. **Es secreto**: guardalo en `secrets/` dentro del repo (esa carpeta ya está en `.gitignore`), por ejemplo `secrets/google-sena.json`. No lo pegues en ningún chat.
5. Abrí **Google Calendar** con la cuenta del comercio. En el calendario de las canchas: **Configuración y uso compartido → Compartir con personas específicas → Agregar personas** y pegá el email del paso 3 con el permiso **"Hacer cambios en los eventos"**.
6. En esa misma pantalla, bajá hasta **Integrar el calendario** y copiá el **ID del calendario** (algo como `abc123@group.calendar.google.com`, o el mail si es el calendario principal).

**En el `.env`:**

```
GOOGLE_SERVICE_ACCOUNT_JSON_PATH=secrets/google-sena.json
GOOGLE_CALENDAR_ID=abc123@group.calendar.google.com
```

Reiniciá `npm start`. Tiene que decir `Agenda: Google Calendar (...)` y después `Agenda: acceso al calendario verificado.` Si dice que no puede leerlo, casi siempre es el paso 5 (calendario sin compartir) o que la API del paso 2 no está habilitada. Si falta alguna de las dos variables, Seña usa la grilla propia.

**Cómo se interpreta el calendario:**

- **Un solo calendario para todas las canchas.** Cada evento tiene que **nombrar la cancha en el título o en el lugar**: `Cancha 1 - Pérez`. Un evento que no nombra ninguna cancha (`Torneo`, `Feriado`) ocupa **todas**.
- Los eventos "de día completo" ocupan todo el día. Los marcados como "Disponible" (transparentes) y los cancelados no cuentan.
- Los horarios que ofrece Seña siguen saliendo de `config/negocio.json` (grilla, duración, anticipación); el calendario solo dice qué está ocupado.
- Los turnos pagados aparecen como `Cancha 1 · Nombre (seña pagada)`. **No los muevas ni los borres a mano**: si cancelás desde el calendario, la seña no se devuelve (cancelá desde Telegram o la API).
- Si Google falla, Seña no confirma ni cobra, y te avisa. Si falla al cancelar, devuelve la seña igual y reintenta borrar el evento sola cada 10 minutos.

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
| "No puedo ver el calendario del comercio" | Falló Google Calendar: sección 12 (¿compartiste el calendario con la cuenta de servicio?). Mientras tanto no se confirma ni se cobra nada |
| Una transferencia quedó "dudosa" | No se reintenta sola a propósito: mirá el hash en Celoscan antes de aprobar |

## Para preguntar en office hours

1. ¿Los cobros x402 que liquida el facilitador cuentan para la tabla aunque no lleven el tag (se acreditan por la dirección PayTo)? ¿Puede PayTo ser la misma wallet del agente?
2. ¿La extensión `builder-code` en las respuestas 402 la acepta el facilitador de Celo?
3. ¿wARS soporta `permit` (EIP-2612)? Si no, ¿hay forma de evitar la aprobación con gas del primer pago?
4. ¿Hay un faucet sin Self para cargar unos centavos de CELO al agente?
