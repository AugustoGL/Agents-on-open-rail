# Mis deberes

Lo que **solo vos podés hacer**: necesita tus claves, tu plata de prueba, tus cuentas o tu gente. Todo lo demás ya está hecho (código, pruebas, interfaz en inglés, documentación, video).

**Fecha límite: lunes 9 de noviembre de 2026, 9:00 (Abidjan) = 6:00 en Córdoba.** Mandalo con un día de margen: **el domingo 8**. Las casillas **🔴** bloquean la entrega.

## Ya está hecho (no hace falta tocar)

- [x] Repo **público** en GitHub.
- [x] **Video** subido a YouTube.
- [x] **Entrega cargada** en Loops con el link del repo y el del video.
- [x] Código, **139 pruebas** y prueba de navegador real; interfaz, mensajes del agente y bot en **inglés** (el bot entiende inglés y español).
- [x] Verifiqué que el **modelo de lenguaje no decide plata**: Claude solo interpreta mensajes del bot (opcional, `src/nl.js`); los montos los calcula código fijo (`src/policy.js`). Lo que dice el video ("no improvisa") es cierto.
- [x] Textos de la entrega **en inglés** listos para pegar: `docs/ENTREGA.md` (sección 2, "English version").

**Lo único que no hice: los subtítulos como archivos `.srt`** (inglés y español). Están quemados en el video; si los querés aparte para YouTube, pedímelos.

---

## Orden recomendado

| Cuándo | Qué |
|---|---|
| **Hoy** | 0. Subir los cambios · 2. NFT en Sepolia · 3. Servidor fijo |
| **Esta semana** | 4. Mainnet y primeros pagos con tag · 5. Probar con billetera real · 6. Telegram |
| **Semana próxima** | 7. Uso real (comercio + compradores) · 8. Preguntas a Ripio/organizadores |
| **Hasta el sábado 7** | 9. Actualizar la entrega con las pruebas reales |
| **Domingo 8** | 10. Chequeo final y envío |

---

## 0. Hoy: subir los cambios 🔴

La entrega apunta a tu repo público, y ese repo todavía **no tiene** lo último (hay commits solo locales).

- [ ] `git push` (el commit con la interfaz en inglés, el video y el orden del repo ya lo hice yo).
- [ ] Verificá que se ve: `curl -s https://raw.githubusercontent.com/AugustoGL/Agents-on-open-rail/main/agent.json`
- [ ] Revisá que no haya secretos en el historial: `git log -p | grep -iE "private|secret|api_key"` (no debería salir ninguna clave).
- [ ] **Reiniciá el servidor de la demo pública** (ngrok): sigue sirviendo la versión anterior, en español, y es lo que va a abrir el jurado.
- [ ] **Resembrá la base de la demo**: la actual tiene decisiones viejas en español y canchas llamadas `Cancha 1`/`Cancha 2`. Usá `npm run seed -- --reset` (base de demo nueva, en inglés) o renombrá las canchas en **Settings** del panel. Las decisiones viejas no se traducen solas.
- [ ] Si la entrega en Loops tiene textos en español, **actualizala** con los de `docs/ENTREGA.md` (sección 2, "English version") usando el borrador de la sección 8 de ese archivo (`loops project update ...` sin `--confirm`, y después con `--confirm`).
- [ ] Mirá `Proyectos importantes/_archivo-sena/` (el zip viejo, el instalador de cloudflared y el guion anterior). Si no los querés, borrala.

## 1. Cosas del repo que ya hice

El repo está ordenado: guías en `docs/`, salidas del video fuera de git (`video/out/`), nada sensible. No tenés que hacer nada acá.

## 2. NFT en Celo Sepolia (≈ 10 minutos)

El contrato está compilado y probado en una EVM local. Falta desplegarlo con **una clave tuya de testnet** (distinta de la del agente del modo real).

- [ ] `npm run nft:clave` → te muestra una clave nueva y su dirección. Copiá `NFT_PRIVATE_KEY=...` al `.env`.
- [ ] Cargale fondos de prueba a esa dirección: https://faucet.celo.org/celo-sepolia
- [ ] `npm run nft:deploy` (simula: muestra saldo y gas, no manda nada).
- [ ] `npm run nft:deploy -- --send` → te da la dirección del contrato.
- [ ] Poné `NFT_CONTRACT=<dirección>` y `NFT_CHAIN=celoSepolia` en el `.env`, reiniciá `npm start`. Tiene que decir `Ticket NFT: Celo Sepolia (testnet) · contrato 0x…`.
- [ ] `npm run nft:probar -- --to 0xTuBilletera --quemar` (ciclo completo: emitido → jugado → quemado). Guardá los links del explorador.
- [ ] Agregá la red Celo Sepolia a MetaMask y mirá el ticket de `npm run nft:probar -- --to 0xTuBilletera` (sin `--quemar`).
- [ ] Anotá la dirección del contrato: va en `docs/ENTREGA.md`.

> **Ojo:** la puntuación del hackathon cuenta **solo Celo mainnet**. El NFT en Sepolia sirve para mostrar el flujo, pero no suma. Si querés que cada ticket sea una transacción tuya con tag en mainnet, mirá el punto 4.4.

## 3. Servidor fijo 🔴

El link de ngrok cambia y depende de tu PC prendida. El jurado va a probar la app durante varios días.

- [ ] Elegí dónde correrlo (cualquier servidor con Node 22.5+): una VPS chica, Fly.io, Railway, Render…
- [ ] Variables de entorno mínimas: `MODE`, `PORT`, `PUBLIC_BASE_URL` (la URL https final), `TRUST_PROXY=true`, `OWNER_DASHBOARD_PASSWORD`, `DB_PATH`.
- [ ] La base SQLite (`data/*.db`) tiene que estar en un **disco que persista** y con **respaldo** (copia diaria del archivo).
- [ ] Que se reinicie solo si se cae (systemd, el reinicio de la plataforma o `pm2`).
- [ ] HTTPS obligatorio (las billeteras y los pagos lo piden).
- [ ] **Decidí qué ve el jurado** (ver "Decisiones abiertas"): una instancia en MODO PRUEBA, una real con montos chicos, o las dos con dos URLs.
- [ ] Cambiá la clave del panel de la demo pública (la de ngrok es de prueba y está en tu terminal).
- [ ] Apagá el ngrok cuando tengas el servidor fijo (`pkill ngrok`).

## 4. Mainnet y primeros pagos con tag 🔴

Seguí la GUIA, pasos 6 a 10. Nada de esto lo probé yo: necesita tus claves y plata real.

### 4.1 Chequeos de solo lectura
- [ ] `npm run probe` → te dice si el facilitador acepta wARS, si wARS soporta `permit` (EIP-2612) y si Permit2 está en Celo. Si `permit` no está, el primer pago de cada billetera necesita un poco de gas: la página ya lo ofrece, pero **mirá cómo se ve**.
- [ ] `npm run address` → confirmá que la billetera del agente es la que esperás (la GUIA dice `0x84c6…67C8`).

### 4.2 Fondos y claves
- [ ] Cargá **CELO** a la billetera del agente (con 1 CELO sobra) o USA₮/USDC con `FEE_CURRENCY=USAT`.
- [ ] Creá la API key del facilitador en https://x402.celo.org (firmás con una billetera, sin gas) → `X402_API_KEY` en el `.env`.
- [ ] `OWNER_PAYOUT_ADDRESS` = tu dirección de depósito de wARS en Ripio (adonde va el retiro diario).

### 4.3 Identidad y tag
- [ ] `loops project get --event agents-on-open-rails` → copiá tu **tag** (formato `celo_xxxxxxxxxxxx`) a `ATTRIBUTION_TAG` en el `.env`.
- [ ] **Registrá la identidad ERC-8004** (necesita el paso 1): `npm run register` (simula) y después `npm run register -- --send`. Poné el `ERC8004_AGENT_ID` en el `.env`.
- [ ] Verificá que la transacción lleva el tag: `npm run verify-tag -- 0x<hash>`.

### 4.4 Primeros pagos reales
- [ ] `MODE=live npm start` (tiene que decir `modo live · wallet 0x84c6…`).
- [ ] Un pago real chico desde **otra** billetera tuya con wARS (comprás unos pesos en Ripio y los mandás por la red Celo). Si la página pide "Habilitar wARS", hacelo una vez.
- [ ] Cancelá esa reserva con más de 24 h → la devolución sale de la billetera del agente **con el tag**: `npm run verify-tag`.
- [ ] Guardá **todos los hashes** (pago, devolución, registro): son la prueba para el criterio 1.
- [ ] **Opcional pero recomendado:** desplegar el NFT en Celo mainnet para que **cada reserva genere una transacción tuya con tag**. `NFT_CHAIN=celo`, `NFT_PRIVATE_KEY` = la clave **del agente registrado** (la billetera que va en el formulario), `npm run nft:deploy -- --mainnet` (simula) y `-- --mainnet --send`. Cuesta centavos de CELO por ticket. Probalo antes en Sepolia (punto 2).

## 5. Probar con billetera real (tablet o celular) 🔴

Hasta ahora solo probé con billeteras simuladas. Hacé este recorrido en **MetaMask Mobile o MiniPay** (y si podés, también iPhone + Android):

- [ ] Reservar desde la web y pagar con la billetera.
- [ ] Cambio de red automático / "otra red" si estás en Ethereum.
- [ ] Sin saldo → botón de Ripio.
- [ ] Rechazar la firma → mensaje claro y se puede reintentar.
- [ ] Primer pago con la aprobación de Permit2 (si `probe` dijo que hace falta).
- [ ] **Ver mis reservas con mi billetera** desde otro dispositivo (firma sin gas).
- [ ] Cancelar con la billetera: la vista previa dice cuánto devuelve y la plata llega.
- [ ] El **ticket NFT** aparece en la billetera (red Celo Sepolia agregada) y "Agregar a mi billetera" funciona.
- [ ] Anotá qué falló o se vio raro: avisame y lo arreglo.

## 6. Telegram

Las respuestas del bot ahora están **en inglés** y entiende mensajes en inglés y español. Las pruebas pasan, pero **nunca se probó con un token real**.

- [ ] @BotFather → `/newbot` → token en `TELEGRAM_BOT_TOKEN`.
- [ ] `/quiensoy` al bot → tu chat id en `OWNER_CHAT_ID`.
- [ ] Probá: reservar, pagar (link https), cancelar, `/hoy`, `/decisiones`, `/pendientes`, `/aprobar`.
- [ ] Escribile en inglés ("is there a court tomorrow at 9 pm?") y en español ("¿hay cancha mañana a las 21?").
- [ ] Confirmá que llega el aviso "Your booking … is now in your wallet as an NFT".

## 7. Uso real 🔴 (pesa mucho en la nota)

Los criterios piden **un comercio real, personas reales y un camino para crecer**, no solo código.

- [ ] **Un comercio real** (una cancha, una peluquería, un consultorio) que acepte probarlo. Ponele nombre y cuántos turnos por semana maneja.
- [ ] **10 o más compradores reales**, **algunos que no conozcas**. Sumá repetición (que el mismo vuelva a reservar).
- [ ] Cargá el comercio real en el panel (nombre, canchas, horarios, precios) y cambiá `esDemostracion` en `config/negocio.json` **solo si ya no es una demo** (si sigue siendo demo, dejalo: el cartel es honesto).
- [ ] Anotá números: reservas, señas cobradas, devoluciones, cuántos fueron personas que no conocés, cuánto tiempo le ahorra al dueño.
- [ ] Pedile al dueño una frase o un audio corto para el video.
- [ ] Si los primeros compradores son conocidos, **decilo abiertamente** en la entrega (está previsto en `docs/ENTREGA.md`).

## 8. Preguntas a Ripio y organizadores (office hours)

- [ ] ¿Los cobros x402 que liquida el facilitador cuentan para la tabla aunque no lleven tu tag (se acreditan por la dirección PayTo)? ¿Puede PayTo ser la misma billetera del agente?
- [ ] ¿Cómo se verifica el "uso en mainnet con el tag" cuando los pagos los envía el facilitador y no el agente?
- [ ] ¿Cuentan para el criterio 1 los tickets NFT que manda el agente en mainnet?
- [ ] ¿La rampa de salida de Ripio acepta **wARS en Celo** como depósito para convertir a pesos? (en la documentación no lo encontré).
- [ ] ¿Los usuarios conocidos puntúan menos? ¿Hay un mínimo de compradores o de volumen?
- [ ] ¿Hay un faucet de CELO sin Self para cargar la billetera del agente?
- [ ] **Una consulta profesional** (abogado/contador) sobre recibir pesos o cripto de terceros en Argentina. El diseño evita que el agente toque pesos, pero conviene confirmarlo.

## 9. Video: ya está en YouTube

- [ ] Confirmá que el **link del video en la entrega** abre en una ventana de incógnito y que el audio suena.
- [ ] Si cambiaste algún número de la política (24 h, 6 h, 50 %, $20.000), **avisame** y regenero el video (`npm run video`).
- [ ] Si querés sumar la **demo en pantalla de 2 a 3 minutos** (guion en `docs/ENTREGA.md`, sección 5): el animado explica la idea; la demo real prueba que funciona.
- [ ] `npm run capturas` en el último momento, para que `docs/capturas/` muestre la versión final.

## 10. Chequeo final y envío (domingo 8)

Está todo en **`docs/ENTREGA.md`**, sección 9: textos, evidencia (hashes, comprobantes), comandos de Loops (borrador primero, `--confirm` después) y el chequeo final.

---

## Cosas que dejé anotadas

- El bot de Telegram **nunca se probó con un token real** (las pruebas usan uno simulado). Es el punto 6.
- "Ver mis reservas con la billetera" solo sirve con billeteras comunes (EOA), no con billeteras de contrato.
- Las **fuentes del video** salen de las que tenga la máquina que lo renderiza. Si lo vas a regenerar en otra compu, instalá Inter.
- El NFT de testnet no suma puntos (solo cuenta Celo mainnet).

---

## Decisiones abiertas (las tomás vos)

1. **¿Qué prueba el jurado?** (a) solo la demo en MODO PRUEBA (cero riesgo, sin plata); (b) una instancia real con montos chicos (más creíble, más riesgo); (c) las dos, con dos URLs. **Recomiendo (c)**: la demo para recorrer todo sin plata y la real para los hashes y los usuarios.
2. **NFT en mainnet o solo en Sepolia.** Mainnet suma transacciones con tag pero cuesta gas real y obliga a usar la clave del agente. Sepolia es gratis y no suma puntos.
3. **Privacidad del ticket.** Hoy queda público en la cadena que una billetera reservó tal cancha a tal hora. Si te preocupa, dejá el NFT apagado en la instancia real y activo solo en la demo.
4. **Comercio de demostración o real.** Mientras no haya un comercio real, mantené el cartel "comercio de demostración".

## Cosas para no olvidar

- Las claves (`AGENT_PRIVATE_KEY`, `NFT_PRIVATE_KEY`, `X402_API_KEY`, el token de Telegram) **solo en el `.env`** y nunca en chats, capturas ni commits.
- La clave del agente real y la del NFT de testnet **son distintas**, salvo que despliegues el NFT en mainnet a propósito.
- Antes de entregar, **rotá la clave del panel** de cualquier instancia pública que hayas mostrado.
- Dejá la instancia de demo corriendo **hasta que termine la evaluación**, no solo hasta la entrega.

## Si algo falla, pasame

- El mensaje de error completo (sin claves).
- La salida de `npm run probe`, `npm run balance` y `npm test`.
- Una captura de pantalla de lo que se vio raro.
