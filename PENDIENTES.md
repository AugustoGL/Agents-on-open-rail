# Pendientes — lo que tenés que hacer vos

Todo lo que falta es tuyo porque necesita **tus claves, tu plata de prueba, tu cuenta o tu gente**. El código, los tests (139), el panel, la web, el NFT y la documentación ya están hechos.

**Fecha límite de la entrega: lunes 9 de noviembre de 2026, 9:00 (Abidjan) = 6:00 de la mañana en Córdoba.** Mandalo con un día de margen: **el domingo 8**.

Marcá cada casilla a medida que avances. Las que dicen **🔴** bloquean la entrega.

---

## Orden recomendado

| Cuándo | Qué |
|---|---|
| **Hoy / mañana** | 1. Subir el código · 2. NFT en Sepolia · 3. Servidor fijo |
| **Esta semana** | 4. Mainnet y primeros pagos con tag · 5. Probar con billetera real · 6. Telegram |
| **Semana próxima** | 7. Uso real (comercio + compradores) · 8. Preguntas a Ripio/organizadores |
| **Hasta el sábado 7** | 9. Video y capturas finales · 10. Cargar la entrega en Loops (ver `ENTREGA.md`) |
| **Domingo 8** | 11. Chequeo final y envío |

---

## 1. Subir el código a GitHub 🔴

El `agent.json` tiene que estar público para registrar la identidad ERC-8004, y el repo tiene que ser público para la entrega.

- [ ] `git status` limpio y **`.env` sin aparecer** (está en `.gitignore`; si aparece, frená).
- [ ] `git push` (los commits están hechos, solo locales).
- [ ] Verificá que se ve: `curl -s https://raw.githubusercontent.com/AugustoGL/Agents-on-open-rail/main/agent.json`
- [ ] Opcional: sacar del repo `sena.zip` y `cloudflared.deb` (ya no hacen falta; el `.deb` ni está commiteado).
- [ ] Revisá que no haya secretos en el historial: `git log -p | grep -iE "private|secret|api_key"` (no debería salir ninguna clave).

## 2. NFT en Celo Sepolia (≈ 10 minutos)

El contrato está compilado y probado en una EVM local. Falta desplegarlo con **una clave tuya de testnet** (distinta de la del agente del modo real).

- [ ] `npm run nft:clave` → te muestra una clave nueva y su dirección. Copiá `NFT_PRIVATE_KEY=...` al `.env`.
- [ ] Cargale fondos de prueba a esa dirección: https://faucet.celo.org/celo-sepolia
- [ ] `npm run nft:deploy` (simula: muestra saldo y gas, no manda nada).
- [ ] `npm run nft:deploy -- --send` → te da la dirección del contrato.
- [ ] Poné `NFT_CONTRACT=<dirección>` y `NFT_CHAIN=celoSepolia` en el `.env`, reiniciá `npm start`. Tiene que decir `Ticket NFT: Celo Sepolia (testnet) · contrato 0x…`.
- [ ] `npm run nft:probar -- --to 0xTuBilletera --quemar` (ciclo completo: emitido → jugado → quemado). Guardá los links del explorador.
- [ ] Agregá la red Celo Sepolia a MetaMask y mirá el ticket de `npm run nft:probar -- --to 0xTuBilletera` (sin `--quemar`).
- [ ] Anotá la dirección del contrato: va en `ENTREGA.md`.

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

El bot **no se tocó** en esta etapa. Verificá que anda con el panel nuevo.

- [ ] @BotFather → `/newbot` → token en `TELEGRAM_BOT_TOKEN`.
- [ ] `/quiensoy` al bot → tu chat id en `OWNER_CHAT_ID`.
- [ ] Probá: reservar, pagar (link https), cancelar, `/hoy`, `/decisiones`, `/pendientes`, `/aprobar`.
- [ ] Confirmá que llega el aviso "tu reserva ya está en tu billetera como NFT".

## 7. Uso real 🔴 (pesa mucho en la nota)

Los criterios piden **un comercio real, personas reales y un camino para crecer**, no solo código.

- [ ] **Un comercio real** (una cancha, una peluquería, un consultorio) que acepte probarlo. Ponele nombre y cuántos turnos por semana maneja.
- [ ] **10 o más compradores reales**, **algunos que no conozcas**. Sumá repetición (que el mismo vuelva a reservar).
- [ ] Cargá el comercio real en el panel (nombre, canchas, horarios, precios) y cambiá `esDemostracion` en `config/negocio.json` **solo si ya no es una demo** (si sigue siendo demo, dejalo: el cartel es honesto).
- [ ] Anotá números: reservas, señas cobradas, devoluciones, cuántos fueron personas que no conocés, cuánto tiempo le ahorra al dueño.
- [ ] Pedile al dueño una frase o un audio corto para el video.
- [ ] Si los primeros compradores son conocidos, **decilo abiertamente** en la entrega (está previsto en `ENTREGA.md`).

## 8. Preguntas a Ripio y organizadores (office hours)

- [ ] ¿Los cobros x402 que liquida el facilitador cuentan para la tabla aunque no lleven tu tag (se acreditan por la dirección PayTo)? ¿Puede PayTo ser la misma billetera del agente?
- [ ] ¿Cómo se verifica el "uso en mainnet con el tag" cuando los pagos los envía el facilitador y no el agente?
- [ ] ¿Cuentan para el criterio 1 los tickets NFT que manda el agente en mainnet?
- [ ] ¿La rampa de salida de Ripio acepta **wARS en Celo** como depósito para convertir a pesos? (en la documentación no lo encontré).
- [ ] ¿Los usuarios conocidos puntúan menos? ¿Hay un mínimo de compradores o de volumen?
- [ ] ¿Hay un faucet de CELO sin Self para cargar la billetera del agente?
- [ ] **Una consulta profesional** (abogado/contador) sobre recibir pesos o cripto de terceros en Argentina. El diseño evita que el agente toque pesos, pero conviene confirmarlo.

## 9. Video y capturas finales

- [ ] Grabá la demo de 2 a 3 minutos siguiendo el guion de `ENTREGA.md` (sección 5).
- [ ] `npm run capturas` en el último momento, para que las capturas de `docs/capturas/` muestren la versión final.
- [ ] Subí el video (YouTube "no listado" o similar) y probá el link en una ventana de incógnito.

## 10 y 11. Entrega

Todo está en **`ENTREGA.md`**: textos para copiar, evidencia a juntar, comandos de Loops (borrador primero, `--confirm` después) y el chequeo final.

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
